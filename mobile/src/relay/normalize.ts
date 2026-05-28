import type { Language } from "../i18n/messages";
import { postJson } from "./client";

/**
 * Normalises Arabic-script-English transliterations via the relay's
 * `/api/normalize` endpoint (LLM-backed). Returns the original text on any
 * failure path — server-side `normalizeTranscription` is no-op-safe and
 * never throws by design.
 *
 * Callers SHOULD pre-check with `needsScriptNormalization` before calling
 * this to avoid an unnecessary HTTP round-trip + OpenRouter spend on text
 * that's already in the right script.
 */
export async function normalize(
  text: string,
  language: Language,
  signal?: AbortSignal,
): Promise<string> {
  const result = await postJson<{ text: string }>(
    "/api/normalize",
    { text, language },
    { signal, timeoutMs: 5_000 },
  );
  return result.text || text;
}
