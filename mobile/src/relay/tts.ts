import type { VoicePreset } from "../state/settings";
import { postBinary, type RelayBinaryResponse } from "./client";

export type AudioFormat =
  | "mp3_44100_128"
  | "mp3_44100_64"
  | "mp3_22050_32"
  | "pcm_16000"
  | "pcm_22050"
  | "pcm_24000"
  | "pcm_44100"
  | "ulaw_8000";

export interface TtsOptions {
  text: string;
  voicePreset?: VoicePreset;
  voiceId?: string;
  speed?: number;
  format?: AudioFormat;
  signal?: AbortSignal;
}

/**
 * Synthesises text → audio bytes via the relay's /api/tts endpoint.
 * Returns the raw audio plus its Content-Type (audio/mpeg, audio/L16; rate=...; channels=1, etc.).
 * The X-Audio-Format response header echoes the chosen format string.
 */
export async function synthesize(opts: TtsOptions): Promise<RelayBinaryResponse> {
  const { text, voicePreset, voiceId, speed, format, signal } = opts;
  return postBinary("/api/tts", { text, voicePreset, voiceId, speed, format }, { signal, timeoutMs: 30_000 });
}
