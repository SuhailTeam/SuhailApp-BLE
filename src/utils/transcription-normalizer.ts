import { config } from "./config";
import { Logger } from "./logger";
import { needsScriptNormalization } from "./transcription-filter";
import type { Language } from "../types";

const logger = new Logger("Normalizer");

/** Timeout for the normalization LLM call (ms).
 *  Matches CLASSIFY_TIMEOUT_MS — same cold-start concern (see command-router.ts). */
const NORMALIZE_TIMEOUT_MS = 3_000;

const NORMALIZE_PROMPT = `You receive Arabic-script text that may be a phonetic transliteration of English speech (e.g., "واتس ان فرونت أوف مي" = "what's in front of me").

If the text is English words written phonetically in Arabic script, output ONLY the equivalent English text.
If the text is genuine Arabic (not a transliteration of English), output it unchanged.
Output ONLY the converted/original text. No explanation, no quotes, no JSON.`;

/**
 * Normalizes a transcription if it appears to be in the wrong script.
 * Returns the original text unchanged if no normalization is needed or on any failure.
 */
export async function normalizeTranscription(
  text: string,
  lang: Language
): Promise<string> {
  if (!needsScriptNormalization(text, lang)) {
    return text;
  }

  logger.info(`Script mismatch detected, normalizing: "${text}"`);

  if (!config.openRouterApiKey) {
    logger.warn("No OpenRouter API key — skipping normalization");
    return text;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NORMALIZE_TIMEOUT_MS);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.classificationModel,
          max_tokens: 60,
          temperature: 0,
          messages: [
            { role: "system", content: NORMALIZE_PROMPT },
            { role: "user", content: text },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn(`Normalization API failed: HTTP ${response.status}`);
        return text;
      }

      const data = await response.json();
      const normalized = data.choices?.[0]?.message?.content?.trim();

      if (!normalized || normalized.length === 0) {
        logger.warn("Normalization returned empty — using original");
        return text;
      }

      logger.info(`Normalized: "${text}" -> "${normalized}"`);
      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      logger.warn("Normalization timed out — using original text");
    } else {
      logger.warn("Normalization error — using original text:", error);
    }
    return text;
  }
}
