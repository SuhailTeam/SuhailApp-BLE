import BluetoothSdk, { type PhotoResponseEvent } from "@mentra/bluetooth-sdk";
import { mintPhotoUploadUrl, waitForPhotoUpload } from "../relay/photo";
import { Logger } from "../utils/logger";

const logger = new Logger("BLE.Camera");

const APP_ID = "com.suhail.assistant.ble";

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
export async function capturePhoto(opts: { signal?: AbortSignal; size?: "small" | "medium" | "large"; compress?: "none" | "medium" | "heavy" } = {}): Promise<CapturedPhoto> {
  const size = opts.size ?? "large";
  const compress = opts.compress ?? "medium";

  // Step 1: mint upload URL.
  const { photoToken, uploadUrl } = await mintPhotoUploadUrl(opts.signal);
  if (opts.signal?.aborted) throw new Error("aborted");

  const requestId = photoToken; // use the photoToken so server+mobile logs cross-reference
  logger.info(`capture requested: token=${photoToken.slice(0, 8)}... size=${size} compress=${compress}`);

  // Race three signals:
  //   A) wait endpoint resolves on successful upload   → return photoToken
  //   B) photo_response fires with state="error"       → fail fast
  //   C) outer timeout / external abort                → fail with timeout/abort
  type Outcome =
    | { kind: "uploaded"; bytes: number }
    | { kind: "ble-error"; message: string; code?: string }
    | { kind: "wait-failed"; err: unknown }
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
    const outcome = await Promise.race([waitPromise, errorPromise, timeoutPromise]);

    if (outcome.kind === "uploaded") {
      logger.info(`capture ok: ${photoToken.slice(0, 8)}... (${outcome.bytes} bytes)`);
      return { photoToken, requestId, uploadUrl, bytes: outcome.bytes };
    }
    if (outcome.kind === "ble-error") {
      logger.warn(`capture error from glasses: ${outcome.message} (${outcome.code ?? "no code"})`);
      throw new Error(`glasses photo error: ${outcome.message}`);
    }
    if (outcome.kind === "wait-failed") {
      logger.warn("upload wait failed:", outcome.err);
      throw new Error(`photo upload timed out or failed: ${outcome.err instanceof Error ? outcome.err.message : String(outcome.err)}`);
    }
    logger.warn(`capture outer timeout after ${CAPTURE_TIMEOUT_MS}ms`);
    throw new Error(`photo capture timed out after ${CAPTURE_TIMEOUT_MS}ms`);
  } finally {
    errorSub.remove();
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (opts.signal && abortHandler) opts.signal.removeEventListener("abort", abortHandler);
  }
}
