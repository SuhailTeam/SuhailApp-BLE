import { createAudioPlayer, setAudioModeAsync, type AudioSource, type AudioStatus } from "expo-audio";
import BluetoothSdk from "@mentra/bluetooth-sdk";
import { Logger } from "../utils/logger";

const logger = new Logger("Audio.Playback");

let audioModeSet = false;

/**
 * Configure the audio session once per app launch. iOS needs this so we play
 * out the active output (which is the Mentra Live speaker once A2DP pairs).
 * Setting `playsInSilentMode: true` matches the cloud version's behavior —
 * voice responses must reach the user even when the phone is on silent.
 */
async function ensureAudioMode(): Promise<void> {
  if (audioModeSet) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    allowsRecording: true,
    interruptionMode: "duckOthers",
    interruptionModeAndroid: "duckOthers",
  });
  audioModeSet = true;
}

/* ── Single serialized queue ─────────────────────────────────────────────── */

interface QueueItem {
  source: AudioSource;
  volume: number;
  label: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

const queue: QueueItem[] = [];
let isProcessing = false;

/**
 * Plays an audio source through the active output (Bluetooth A2DP → Mentra Live
 * speaker when paired). Serialized — multiple calls queue and play one after
 * another. The returned promise resolves when playback finishes naturally OR
 * rejects if interrupted by `stopAll()`.
 *
 * `setOwnAppAudioPlaying` is toggled around playback so the BLE SDK arbitrates
 * mic-vs-speaker correctly (it should attenuate / pause mic capture while we
 * speak).
 */
export function play(source: AudioSource, opts: { volume?: number; label?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push({
      source,
      volume: opts.volume ?? 1.0,
      label: opts.label ?? "audio",
      resolve,
      reject,
    });
    void processQueue();
  });
}

/**
 * Aborts the currently-playing item and clears the queue. The current item's
 * promise rejects with an "interrupted" error so callers can ignore the chain.
 *
 * Returns a promise that resolves once teardown completes — fine to fire and
 * forget if you don't care about ordering.
 */
export async function stopAll(): Promise<void> {
  const drained = queue.splice(0, queue.length);
  for (const item of drained) {
    item.reject(new Error("interrupted"));
  }
  if (currentPlayer) {
    try {
      currentPlayer.pause();
      currentPlayer.remove();
    } catch (err) {
      logger.warn("error tearing down player:", err);
    }
    currentPlayer = null;
  }
  if (currentReject) {
    currentReject(new Error("interrupted"));
    currentReject = null;
    currentResolve = null;
  }
  await safeSetAppAudioPlaying(false);
  isProcessing = false;
}

let currentPlayer: ReturnType<typeof createAudioPlayer> | null = null;
let currentResolve: (() => void) | null = null;
let currentReject: ((reason?: unknown) => void) | null = null;

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  const next = queue.shift();
  if (!next) return;
  isProcessing = true;

  try {
    await ensureAudioMode();
    await safeSetAppAudioPlaying(true);
    logger.debug(`▶ ${next.label}`);

    await new Promise<void>((resolve, reject) => {
      currentResolve = resolve;
      currentReject = reject;
      const player = createAudioPlayer(next.source);
      currentPlayer = player;
      player.volume = next.volume;

      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        if (status.didJustFinish) {
          sub.remove();
          try { player.remove(); } catch {}
          if (currentPlayer === player) {
            currentPlayer = null;
            currentResolve = null;
            currentReject = null;
          }
          resolve();
        }
      });

      // Some assets may already be loaded when createAudioPlayer returns;
      // calling play() in any case starts playback.
      try {
        player.play();
      } catch (err) {
        sub.remove();
        try { player.remove(); } catch {}
        reject(err);
      }
    });

    next.resolve();
    logger.debug(`✓ ${next.label}`);
  } catch (err) {
    next.reject(err);
    logger.debug(`✗ ${next.label} — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    isProcessing = false;
    if (queue.length > 0) {
      void processQueue();
    } else {
      await safeSetAppAudioPlaying(false);
    }
  }
}

/* ── Mic / speaker arbitration ───────────────────────────────────────────── */

async function safeSetAppAudioPlaying(playing: boolean): Promise<void> {
  try {
    await BluetoothSdk.setOwnAppAudioPlaying(playing);
  } catch (err) {
    // Best-effort — BLE SDK may not be ready yet (no glasses connected). Don't
    // let playback fail just because we couldn't notify the SDK.
    logger.debug(`setOwnAppAudioPlaying(${playing}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
