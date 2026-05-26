import type { Language } from "../types";

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
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

  // Script mismatch: reject if zero characters of the expected script (and text is non-trivial)
  // Note: when lang="en", Arabic-script text is allowed through — it may be a
  // phonetic transliteration of English that the normalizer will handle downstream.
  if (trimmed.length > 3) {
    if (lang === "ar" && !ARABIC_SCRIPT.test(trimmed)) return false;
  }

  return true;
}

/**
 * Returns true if the text appears to be in a mismatched script for the
 * configured language, indicating it may need LLM normalization.
 * Specifically: Arabic-script-only text when lang="en".
 */
export function needsScriptNormalization(text: string, lang: Language): boolean {
  if (lang !== "en") return false;
  const trimmed = text.trim();
  if (trimmed.length <= 3) return false;
  return ARABIC_SCRIPT.test(trimmed) && !/[a-zA-Z]/.test(trimmed);
}

/**
 * Strips parenthetical annotations from STT output. ElevenLabs Scribe inserts
 * non-verbal sound events like "(clicks tongue)", "(coughs)", "(laughs)"
 * inline with transcribed speech. They confuse the intent classifier and can
 * be the entire short utterance ("(coughs)") if the user only made a sound.
 *
 * Surfaced in PR #7 hardware test:
 *   "Describe my surroundings (clicks tongue)."
 *
 * Three-pass cleanup so we don't leave orphan whitespace or punctuation
 * (the original single-regex version produced "Describe my surroundings ."
 * with a stray space before the period — PR #10 review finding #4):
 *
 *   1. replace "(...)" + surrounding whitespace with a single space
 *      (keep word separation when annotation is mid-sentence)
 *   2. drop any space that ended up before a sentence-final mark
 *      (.,!?;:) — fixes "surroundings ." → "surroundings."
 *   3. collapse runs of whitespace + trim ends
 */
export function stripAnnotations(text: string): string {
  return text
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
