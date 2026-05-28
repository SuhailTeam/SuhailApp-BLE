import BluetoothSdk, { type BluetoothSdkSubscription, type MicPcmEvent } from "@mentra/bluetooth-sdk";
import { Logger } from "../utils/logger";

const logger = new Logger("BLE.Mic");

/**
 * End-of-utterance: stop capture this many ms after the last mic_pcm event.
 * With VAD enabled on the glasses, silence chunks are gated out — so "no chunk
 * arrived" effectively means "no speech." 1500ms tracks the cloud version's
 * LISTENING_GRACE_MS instinct: snappy enough to feel responsive, long enough
 * to ride out word-internal pauses.
 */
const SILENCE_TIMEOUT_MS = 1_500;

/**
 * Reject buffers shorter than this — they're almost always accidental taps,
 * cue echo, or VAD false-positives that won't transcribe to anything useful.
 * 300ms = 9600 bytes of 16 kHz / 16-bit / mono PCM.
 */
const MIN_DURATION_MS = 300;
const MIN_BYTES = Math.ceil((MIN_DURATION_MS / 1000) * 16_000 * 2);

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;

type Resolver = (result: { audioBase64: string; durationMs: number } | null) => void;

let captureSub: BluetoothSdkSubscription | null = null;
let buffers: Uint8Array[] = [];
let totalBytes = 0;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Resolver | null = null;

export interface CaptureResult {
  /** Base64-encoded PCM s16le @ 16 kHz mono. */
  audioBase64: string;
  /** Approximate audio duration in ms (totalBytes / 2 / 16kHz × 1000). */
  durationMs: number;
}

/**
 * Starts capturing mic audio from the glasses. Resolves with the buffered
 * audio either when end-of-utterance silence fires (~1.5s of no chunks) or
 * when the caller invokes `stopCapture()` explicitly. Resolves with `null`
 * if no meaningful audio was captured (< 300ms).
 *
 * Only one capture can be active at a time. Calling start while another is
 * pending rejects.
 *
 * VAD is left on (`bypassVad: false`) so the glasses silence-gate audio
 * before sending — what arrives is already roughly "voice." We don't ask the
 * SDK to transcribe (`sendTranscript: false`) because we send the audio
 * through our own /api/stt relay endpoint.
 */
export async function startCapture(): Promise<CaptureResult | null> {
  if (captureSub || pending) {
    throw new Error("mic capture already in progress");
  }

  buffers = [];
  totalBytes = 0;

  logger.info("startCapture");
  try {
    await BluetoothSdk.setMicState(
      true,   // enabled
      true,   // useGlassesMic — prefer the glasses mic over phone mic
      false,  // bypassVad — use the glasses' VAD to silence-gate
      false,  // sendTranscript — we transcribe via our own relay
      false,  // sendLc3Data — we want raw PCM, not LC3-encoded
    );
  } catch (err) {
    logger.error("setMicState(true) failed:", err);
    throw err;
  }

  return new Promise<CaptureResult | null>((resolve) => {
    pending = (result) => {
      pending = null;
      resolve(result);
    };

    captureSub = BluetoothSdk.addListener("mic_pcm", (event: MicPcmEvent) => {
      const chunk = new Uint8Array(event.pcm);
      buffers.push(chunk);
      totalBytes += chunk.length;

      // Reset the silence timer on every chunk. When it finally fires it
      // means we've gone SILENCE_TIMEOUT_MS without hearing anything new.
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        logger.info(`silence timeout (${SILENCE_TIMEOUT_MS}ms) → finalising capture`);
        void finalise();
      }, SILENCE_TIMEOUT_MS);
    });
  });
}

/**
 * Stops the current capture early (e.g. on interrupt). Returns whatever was
 * buffered so far, or null if too little to be useful.
 */
export async function stopCapture(): Promise<CaptureResult | null> {
  if (!captureSub) return null;
  logger.info("stopCapture (explicit)");
  return finalise();
}

/**
 * Aborts the current capture and discards any buffered audio. Used on
 * cancel paths where we don't want to round-trip to STT.
 */
export async function cancelCapture(): Promise<void> {
  if (!captureSub) return;
  logger.info("cancelCapture (discard buffer)");
  await teardown();
  if (pending) pending(null);
}

async function finalise(): Promise<CaptureResult | null> {
  await teardown();

  if (totalBytes === 0) {
    logger.info("finalise: no audio captured");
    if (pending) pending(null);
    return null;
  }

  if (totalBytes < MIN_BYTES) {
    logger.info(`finalise: too short (${totalBytes}B < ${MIN_BYTES}B) — discarding`);
    buffers = [];
    totalBytes = 0;
    if (pending) pending(null);
    return null;
  }

  // Merge chunks into one contiguous buffer.
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.length;
  }
  buffers = [];
  const captured = totalBytes;
  totalBytes = 0;

  const durationMs = Math.round((captured / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000);
  const audioBase64 = uint8ToBase64(merged);
  logger.info(`finalise: ${captured}B = ~${durationMs}ms audio, ${audioBase64.length} base64 chars`);

  const result: CaptureResult = { audioBase64, durationMs };
  if (pending) pending(result);
  return result;
}

async function teardown(): Promise<void> {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (captureSub) {
    try { captureSub.remove(); } catch {}
    captureSub = null;
  }
  try {
    await BluetoothSdk.setMicState(false);
  } catch (err) {
    // Non-fatal — the glasses may already have disabled the mic, or BLE
    // dropped mid-capture. Logging only.
    logger.debug(`setMicState(false) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True if a capture is currently in progress. */
export function isCapturing(): boolean {
  return captureSub !== null;
}

/* ── base64 encoding (no node Buffer in RN) ──────────────────────────────── */

function uint8ToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack blowups on large buffers (10s of audio is
  // ~320KB, well past the safe direct apply() limit).
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return globalThis.btoa(binary);
}
