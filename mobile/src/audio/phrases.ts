import { messages, BUNDLED_PHRASE_KEYS, LANGUAGES } from "../i18n/messages";

/**
 * Pre-bundled audio for the hot, static spoken phrases. Lets `speak()` play
 * them instantly with no `/api/tts` round-trip or ElevenLabs credit spend.
 *
 * `require()` returns a Metro asset id (number) that expo-audio accepts as an
 * AudioSource. Metro needs literal require() calls, so the map is written out
 * one line per bundled file. Keep this in sync with BUNDLED_PHRASE_KEYS and the
 * committed `assets/phrases/*.mp3` — re-run `scripts/generate-phrases.ts` after
 * adding/removing a phrase or changing its text.
 */
const ASSETS: Record<string, number> = {
  "didntCatch.ar": require("../../assets/phrases/didntCatch.ar.mp3"),
  "didntCatch.en": require("../../assets/phrases/didntCatch.en.mp3"),
  "generalError.ar": require("../../assets/phrases/generalError.ar.mp3"),
  "generalError.en": require("../../assets/phrases/generalError.en.mp3"),
  "unknownCommand.ar": require("../../assets/phrases/unknownCommand.ar.mp3"),
  "unknownCommand.en": require("../../assets/phrases/unknownCommand.en.mp3"),
  "repeatNoHistory.ar": require("../../assets/phrases/repeatNoHistory.ar.mp3"),
  "repeatNoHistory.en": require("../../assets/phrases/repeatNoHistory.en.mp3"),
  "glassesDisconnected.ar": require("../../assets/phrases/glassesDisconnected.ar.mp3"),
  "glassesDisconnected.en": require("../../assets/phrases/glassesDisconnected.en.mp3"),
  "enrollPrompt.ar": require("../../assets/phrases/enrollPrompt.ar.mp3"),
  "enrollPrompt.en": require("../../assets/phrases/enrollPrompt.en.mp3"),
  "enrollFailed.ar": require("../../assets/phrases/enrollFailed.ar.mp3"),
  "enrollFailed.en": require("../../assets/phrases/enrollFailed.en.mp3"),
};

/**
 * Reverse lookup: exact localized phrase string → bundled asset id. Built from
 * the same `messages` data the generator read, so a hit is byte-exact with what
 * was synthesized.
 */
const BY_TEXT = new Map<string, number>();
for (const key of BUNDLED_PHRASE_KEYS) {
  for (const lang of LANGUAGES) {
    const asset = ASSETS[`${key}.${lang}`];
    if (asset != null) BY_TEXT.set(messages[key][lang], asset);
  }
}

/**
 * Returns the bundled asset id for an exact static phrase, or null when the
 * text isn't one of the pre-generated phrases (the caller then uses live TTS).
 */
export function bundledPhraseAsset(text: string): number | null {
  return BY_TEXT.get(text) ?? null;
}
