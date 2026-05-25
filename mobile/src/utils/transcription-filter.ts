import type { Language } from "../i18n/messages";

// Ported verbatim from src/utils/transcription-filter.ts so cloud + mobile
// reject the same garbage. Update both halves when changing thresholds.

const ARABIC_SCRIPT = /[؀-ۿ]/;
const SPECIAL_CHARS = /[^\p{L}\p{N}\s]/gu;
const REPEATED_WORD = /\b(\w+)\s+(\1\s+){3,}/i;

/**
 * Validates a transcription before it reaches the command router.
 * Returns false for garbled, junk, or wrong-script text.
 */
export function isValidTranscription(text: string, lang: Language): boolean {
  const trimmed = text.trim();

  // Reject very short text (shortest valid command is "من", 2 chars)
  if (trimmed.length < 2) return false;

  // Reject if > 40% special characters (garbled STT output)
  const specialCount = (trimmed.match(SPECIAL_CHARS) || []).length;
  if (trimmed.length > 0 && specialCount / trimmed.length > 0.4) return false;

  // Reject excessive word repetition (STT stutter artifacts)
  if (REPEATED_WORD.test(trimmed)) return false;

  // Script mismatch: reject if zero characters of the expected script (and text is non-trivial).
  // Note: when lang="en", Arabic-script text is allowed through — it may be a
  // phonetic transliteration of English that the normalizer will handle downstream.
  if (trimmed.length > 3) {
    if (lang === "ar" && !ARABIC_SCRIPT.test(trimmed)) return false;
  }

  return true;
}

/**
 * True if the text appears to be in a mismatched script for the configured
 * language, suggesting it should be sent through LLM normalization before
 * being routed.
 */
export function needsScriptNormalization(text: string, lang: Language): boolean {
  if (lang !== "en") return false;
  const trimmed = text.trim();
  if (trimmed.length <= 3) return false;
  return ARABIC_SCRIPT.test(trimmed) && !/[a-zA-Z]/.test(trimmed);
}
