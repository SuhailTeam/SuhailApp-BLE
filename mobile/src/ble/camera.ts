import BluetoothSdk, { type PhotoResponseEvent } from "@mentra/bluetooth-sdk";
import { mintPhotoUploadUrl } from "../relay/photo";
import { Logger } from "../utils/logger";

const logger = new Logger("BLE.Camera");

const APP_ID = "com.suhail.assistant.ble";

/** Per-capture timeout. Glasses-side capture is usually < 3s but BLE adds latency. */
const CAPTURE_TIMEOUT_MS = 15_000;

/**
 * End-to-end photo capture against the Mentra Live glasses:
 *   1. mint a one-shot upload URL via /api/photo/upload-url
 *   2. BluetoothSdk.requestPhoto(...) — glasses take photo + upload to that URL
 *   3. await the photo_response BLE event matching our requestId
 *   4. resolve with the photoToken, which the caller passes to any
 *      /api/vision/* or /api/faces/* endpoint as `{ photoToken }`
 *
 * Resolves: { photoToken } once glasses confirm upload success
 * Rejects:  on photo_response error, glasses-side failure, or 15s timeout
 */
export interface CapturedPhoto {
  photoToken: string;
  /** BLE SDK requestId for cross-referencing in logs. */
  requestId: string;
  /** Upload URL the glasses POSTed to (for debug). */
  uploadUrl: string;
}

export async function capturePhoto(opts: { signal?: AbortSignal; size?: "small" | "medium" | "large"; compress?: "none" | "medium" | "heavy" } = {}): Promise<CapturedPhoto> {
  const size = opts.size ?? "large";
  const compress = opts.compress ?? "medium";

  // Step 1: mint upload URL. Server caches an empty entry under photoToken
  // and returns a public URL the glasses can POST to.
  const { photoToken, uploadUrl } = await mintPhotoUploadUrl(opts.signal);
  if (opts.signal?.aborted) throw new Error("aborted");

  // Use the photoToken as the requestId so logs across mobile+server line up.
  const requestId = photoToken;
  logger.info(`capture requested: token=${photoToken.slice(0, 8)}... size=${size} compress=${compress}`);

  return new Promise<CapturedPhoto>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;

    const cleanup = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
      if (opts.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
    };

    const sub = BluetoothSdk.addListener("photo_response", (event: PhotoResponseEvent) => {
      // requestPhoto echoes our requestId back on the event — filter to ours so
      // we don't react to other in-flight captures (cloud SDK app, debug tools).
      if (event.requestId !== requestId) return;
      if (settled) return;

      if (event.state === "success") {
        cleanup();
        logger.info(`capture ok: ${photoToken.slice(0, 8)}... → ${event.uploadUrl}`);
        resolve({ photoToken, requestId, uploadUrl });
      } else {
        cleanup();
        logger.warn(`capture error: ${event.errorMessage} (${event.errorCode ?? "no code"})`);
        reject(new Error(`photo_response error: ${event.errorMessage}`));
      }
    });

    timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      logger.warn(`capture timeout after ${CAPTURE_TIMEOUT_MS}ms`);
      reject(new Error(`photo capture timed out after ${CAPTURE_TIMEOUT_MS}ms`));
    }, CAPTURE_TIMEOUT_MS);

    if (opts.signal) {
      onAbort = () => {
        if (settled) return;
        cleanup();
        reject(new Error("aborted"));
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Fire the actual capture request. Glasses will:
    //   1. take the photo
    //   2. POST multipart/form-data { photo, requestId } to uploadUrl
    //   3. emit photo_response (success or error) via BLE
    BluetoothSdk.requestPhoto(
      requestId,
      APP_ID,
      size,
      uploadUrl,
      /* authToken */ null,   // our endpoint uses the URL-path token as auth
      compress,
      /* sound */ false,
    ).catch((err) => {
      if (settled) return;
      cleanup();
      logger.error("requestPhoto failed:", err);
      reject(err);
    });
  });
}
