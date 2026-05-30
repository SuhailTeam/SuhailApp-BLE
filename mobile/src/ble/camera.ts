import BluetoothSdk, { type PhotoResponseEvent } from "@mentra/bluetooth-sdk";
import { mintPhotoUploadUrl, waitForPhotoUpload } from "../relay/photo";
import { isGlassesConnected, onGlassesDisconnected } from "./connection";
import { Logger } from "../utils/logger";

const logger = new Logger("BLE.Camera");

const APP_ID = "com.suhail.assistant.ble";

/**
 * Thrown when a capture is aborted by a glasses BLE drop (either already gone
 * when the capture starts, or dropped mid-flight). The listening state machine
 * treats this like a cancellation — it does NOT speak the generic error,
 * because the disconnect handler speaks its own "lost connection" message.
 */
export const GLASSES_DISCONNECTED_ERROR = "glasses disconnected";

/**
 * Per-capture outer timeout. Photo capture + upload over BLE is usually 3-8s.
 * The actual completion signal comes from /api/photo/wait (server long-poll,
 * 20s server-side timeout). This is the outer ceiling.
 */
const CAPTURE_TIMEOUT_MS = 25_000;

export interface CapturedPhoto {
  photoToken: string;
  /** BLE SDK requestId for cross-referencing in logs. */
  requestId: string;
  /** Upload URL the glasses POSTed to (for debug). */
  uploadUrl: string;
  /** Photo size in bytes as reported by the server. */
  bytes: number;
}

/**
 * End-to-end photo capture against the Mentra Live glasses:
 *   1. mint a one-shot upload URL via /api/photo/upload-url
 *   2. BluetoothSdk.requestPhoto(...) — glasses take photo + upload
 *   3. wait for upload completion via GET /api/photo/wait/<token> (long-poll
 *      against the server cache). The BLE photo_response event's success
 *      variant is NOT wired in @mentra/bluetooth-sdk@0.1.6's iOS bridge —
 *      see src/services/photo-cache.ts waitForBytes() for the full story.
 *   4. resolve with the photoToken, which the caller passes to any
 *      /api/vision/* or /api/faces/* endpoint as `{ photoToken }`
 *
 * We still subscribe to photo_response for the ERROR case — that variant
 * IS wired (Bridge.swift line 261 → sendPhotoError) and lets us fail fast
 * when the glasses can't take a photo (camera busy, hardware issue, etc.)
 * rather than waiting out the long-poll.
 */
/**
 * Resolves a CapturedPhoto from either a pre-capture in flight (started on the
 * user's swipe, before STT+intent finish) OR a fresh capture if there was no
 * pre-capture / it failed.
 *
 * IMPORTANT: when a pre-capture is in flight we AWAIT it rather than racing a
 * fresh capture against a budget. Mentra Live can only service ONE photo at a
 * time — firing a second `requestPhoto` while the pre-capture is still pending
 * makes the glasses deliver NEITHER (both server long-polls time out, HTTP 408).
 * The pre-capture is already bounded by capturePhoto's own racers (BLE-error
 * fast-fail, disconnect fast-fail, 25s outer timeout), so awaiting it is safe;
 * we only fall back to a single fresh capture if it actually REJECTS. This keeps
 * the swipe-time latency win (photo captured in parallel with STT+intent) while
 * never running two captures at once.
 */
export async function resolvePhoto(opts: {
  preCapture?: Promise<CapturedPhoto> | null;
  signal?: AbortSignal;
  size?: "small" | "medium" | "large";
  compress?: "none" | "medium" | "heavy";
}): Promise<CapturedPhoto> {
  if (opts.preCapture) {
    try {
      const photo = await opts.preCapture;
      logger.info(`using pre-captured photo ${photo.photoToken.slice(0, 8)}...`);
      return photo;
    } catch (err) {
      logger.info(`pre-capture failed (${err instanceof Error ? err.message : String(err)}) — capturing fresh`);
      // fall through to a single fresh capture
    }
  }
  return capturePhoto({ signal: opts.signal, size: opts.size, compress: opts.compress });
}

/**
 * Module-level single-flight chain: guarantees only ONE BLE photo request is
 * ever in flight at a time. Two concurrent `requestPhoto` calls make the glasses
 * deliver neither (both time out), so every capture queues behind the previous
 * one. A failed/aborted capture doesn't poison the chain (aborted pre-captures
 * reject promptly via their signal, so the chain drains fast).
 */
let captureChain: Promise<unknown> = Promise.resolve();

export function capturePhoto(opts: { signal?: AbortSignal; size?: "small" | "medium" | "large"; compress?: "none" | "medium" | "heavy" } = {}): Promise<CapturedPhoto> {
  const run = captureChain.then(() => doCapturePhoto(opts), () => doCapturePhoto(opts));
  captureChain = run.then(() => undefined, () => undefined);
  return run;
}

async function doCapturePhoto(opts: { signal?: AbortSignal; size?: "small" | "medium" | "large"; compress?: "none" | "medium" | "heavy" } = {}): Promise<CapturedPhoto> {
  const size = opts.size ?? "large";
  const compress = opts.compress ?? "medium";

  // Fail fast if the glasses are already gone — no point minting an upload URL
  // the glasses can't POST to, or waiting out the 25s outer timeout. Mid-flight
  // drops are caught by the disconnect racer below.
  if (!isGlassesConnected()) {
    logger.warn("capture requested but glasses are disconnected — failing fast");
    throw new Error(GLASSES_DISCONNECTED_ERROR);
  }

  // Step 1: mint upload URL.
  const { photoToken, uploadUrl } = await mintPhotoUploadUrl(opts.signal);
  if (opts.signal?.aborted) throw new Error("aborted");

  const requestId = photoToken; // use the photoToken so server+mobile logs cross-reference
  logger.info(`capture requested: token=${photoToken.slice(0, 8)}... size=${size} compress=${compress}`);

  // Race four signals:
  //   A) wait endpoint resolves on successful upload   → return photoToken
  //   B) photo_response fires with state="error"       → fail fast
  //   C) glasses drop off BLE mid-capture              → fail fast
  //   D) outer timeout / external abort                → fail with timeout/abort
  type Outcome =
    | { kind: "uploaded"; bytes: number }
    | { kind: "ble-error"; message: string; code?: string }
    | { kind: "wait-failed"; err: unknown }
    | { kind: "disconnected" }
    | { kind: "timeout" };

  const waitPromise: Promise<Outcome> = waitForPhotoUpload(photoToken, opts.signal).then(
    (result) => ({ kind: "uploaded", bytes: result.bytes }),
    (err) => ({ kind: "wait-failed", err }),
  );

  // Subscribe synchronously so TS sees the resulting type, then capture the
  // resolver for the listener to fire — assignment-inside-Promise doesn't
  // narrow cleanly.
  let resolveError!: (outcome: Outcome) => void;
  const errorPromise = new Promise<Outcome>((resolve) => { resolveError = resolve; });
  const errorSub = BluetoothSdk.addListener("photo_response", (event: PhotoResponseEvent) => {
    if (event.requestId !== requestId) return;
    if (event.state === "error") {
      resolveError({ kind: "ble-error", message: event.errorMessage, code: event.errorCode });
    }
    // The success variant never fires in 0.1.6 — we ignore it intentionally.
  });

  // Glasses dropping mid-capture would otherwise leave us waiting out the 25s
  // outer timeout (the BLE requestPhoto call fails silently, and the server
  // long-poll just times out). Race a disconnect signal so we fail in <1s.
  let resolveDisconnect!: (outcome: Outcome) => void;
  const disconnectPromise = new Promise<Outcome>((resolve) => { resolveDisconnect = resolve; });
  const offDisconnect = onGlassesDisconnected(() => resolveDisconnect({ kind: "disconnected" }));

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const timeoutPromise = new Promise<Outcome>((resolve, reject) => {
    timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), CAPTURE_TIMEOUT_MS);
    if (opts.signal) {
      abortHandler = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(new Error("aborted"));
      };
      if (opts.signal.aborted) abortHandler();
      else opts.signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  // Fire the BLE request. Glasses take the photo + upload to our server.
  BluetoothSdk.requestPhoto(
    requestId,
    APP_ID,
    size,
    uploadUrl,
    /* authToken */ null,
    compress,
    /* sound */ false,
  ).catch((err) => {
    // SDK call itself failed (rare — usually means glasses are disconnected).
    // The race will time out or surface the ble-error path; this log makes it
    // visible during debugging.
    logger.error("requestPhoto SDK call failed:", err);
  });

  try {
    const outcome = await Promise.race([waitPromise, errorPromise, disconnectPromise, timeoutPromise]);

    if (outcome.kind === "uploaded") {
      logger.info(`capture ok: ${photoToken.slice(0, 8)}... (${outcome.bytes} bytes)`);
      return { photoToken, requestId, uploadUrl, bytes: outcome.bytes };
    }
    if (outcome.kind === "ble-error") {
      logger.warn(`capture error from glasses: ${outcome.message} (${outcome.code ?? "no code"})`);
      throw new Error(`glasses photo error: ${outcome.message}`);
    }
    if (outcome.kind === "disconnected") {
      logger.warn(`capture aborted: glasses disconnected mid-capture (${photoToken.slice(0, 8)}...)`);
      throw new Error(GLASSES_DISCONNECTED_ERROR);
    }
    if (outcome.kind === "wait-failed") {
      logger.warn("upload wait failed:", outcome.err);
      throw new Error(`photo upload timed out or failed: ${outcome.err instanceof Error ? outcome.err.message : String(outcome.err)}`);
    }
    logger.warn(`capture outer timeout after ${CAPTURE_TIMEOUT_MS}ms`);
    throw new Error(`photo capture timed out after ${CAPTURE_TIMEOUT_MS}ms`);
  } finally {
    errorSub.remove();
    offDisconnect();
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (opts.signal && abortHandler) opts.signal.removeEventListener("abort", abortHandler);
  }
}
