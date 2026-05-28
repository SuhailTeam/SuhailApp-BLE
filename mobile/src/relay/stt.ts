import type { Language } from "../i18n/messages";
import { postJson } from "./client";

export interface SttResult {
  text: string;
  /** Language Scribe detected (e.g. "en", "ar"). May be undefined. */
  languageCode?: string;
  /** Scribe's language-detection probability 0-1, if returned. */
  confidence?: number;
}

/**
 * POST a base64-encoded PCM (16 kHz / 16-bit / mono / s16le) buffer to the
 * relay's STT endpoint. Returns the transcribed text plus optional metadata.
 */
export function transcribe(
  audioBase64: string,
  language: Language,
  signal?: AbortSignal,
): Promise<SttResult> {
  return postJson<SttResult>("/api/stt", { audio: audioBase64, language }, { signal, timeoutMs: 30_000 });
}
