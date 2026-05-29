import * as FileSystem from "expo-file-system";
import { synthesize, type AudioFormat } from "../relay/tts";
import { getSettings } from "../state/settings";
import { Logger } from "../utils/logger";
import { play } from "./playback";
import { bundledPhraseAsset } from "./phrases";

const logger = new Logger("Audio.TTS");

/** Counter for unique temp filenames, avoids collisions across rapid calls. */
let ttsCounter = 0;

/** Picks the file extension for a given ElevenLabs output format. */
function extensionFor(format: AudioFormat): string {
  if (format.startsWith("mp3_")) return "mp3";
  if (format.startsWith("pcm_")) return "pcm";
  if (format === "ulaw_8000") return "ulaw";
  return "bin";
}

/**
 * Synthesizes `text` via the relay's /api/tts and plays it through the active
 * audio output (Bluetooth A2DP → Mentra Live speaker once paired). Returns when
 * playback finishes. Rejects with Error("interrupted") if stopAll() races.
 *
 * Speed + voice preset come from settings. Default format is mp3 — universal
 * decoder support and small enough to write a temp file fast.
 */
export async function speak(text: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const settings = getSettings();
  const t0 = Date.now();

  // Pre-bundled phrase fast path: the hot static phrases (errors, "didn't
  // catch", enrollment prompt, etc.) ship as committed audio assets, so they
  // play instantly with no /api/tts round-trip and zero ElevenLabs spend. Only
  // taken at DEFAULT voice + speed — a user who picked a different voice/speed
  // still hears their choice via live TTS for these phrases too. Volume is
  // applied at playback, so it's honored either way. See audio/phrases.ts +
  // scripts/generate-phrases.ts.
  if (settings.voicePreset === "default" && Math.abs(settings.speechSpeed - 1.0) < 0.001) {
    const asset = bundledPhraseAsset(text);
    if (asset != null) {
      logger.debug(`bundled phrase: "${snippet(text)}"`);
      await play(asset, { volume: settings.volume, label: `phrase:${snippet(text)}` });
      return;
    }
  }

  const response = await synthesize({
    text,
    voicePreset: settings.voicePreset,
    speed: settings.speechSpeed,
    signal: opts.signal,
  });

  // Header echoes what the server actually used; fall back to mp3 default
  // if it's missing for any reason.
  const format = (response.headers.get("X-Audio-Format") ?? "mp3_44100_128") as AudioFormat;
  const ext = extensionFor(format);

  ttsCounter += 1;
  const path = `${FileSystem.cacheDirectory}tts-${Date.now()}-${ttsCounter}.${ext}`;

  // base64-encode the bytes for FileSystem.writeAsStringAsync. RN doesn't have
  // a great way to write a binary buffer directly; base64 is the cross-platform
  // path that expo-file-system supports today.
  const b64 = arrayBufferToBase64(response.bytes);
  await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });

  logger.debug(`synth ${text.length}ch → ${response.bytes.byteLength}B in ${Date.now() - t0}ms`);

  try {
    await play({ uri: path }, { volume: settings.volume, label: `tts:${snippet(text)}` });
  } finally {
    // Best-effort cleanup; on iOS the cache is auto-cleared so this is belt-and-braces.
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Encode in 8KB chunks to avoid call-stack blowups on large payloads.
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // btoa is available in Hermes / modern RN runtimes.
  return globalThis.btoa(binary);
}

function snippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed;
}
