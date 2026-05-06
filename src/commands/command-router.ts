import { config } from "../utils/config";
import { Logger } from "../utils/logger";
import type { CommandType, IntentType, ClassificationResult, RouteResult } from "../types";

const logger = new Logger("CommandRouter");

/** Timeout for the LLM classification call (ms) */
const CLASSIFY_TIMEOUT_MS = 2_000;

/** Maps LLM intent names to CommandType values */
const intentToCommand: Record<Exclude<IntentType, "unknown">, CommandType> = {
  scene_summarize: "scene-summarize",
  ocr_read_text: "ocr-read-text",
  face_recognize: "face-recognize",
  face_enroll: "face-enroll",
  find_object: "find-object",
  currency_recognize: "currency-recognize",
  color_detect: "color-detect",
  visual_qa: "visual-qa",
};

/** Valid intent values for validation */
const validIntents = new Set<string>([
  "scene_summarize", "ocr_read_text", "face_recognize", "face_enroll",
  "find_object", "currency_recognize", "color_detect", "visual_qa", "unknown",
]);

/**
 * System prompt for the LLM intent classifier.
 */
const CLASSIFIER_PROMPT = `You are a voice command classifier for smart glasses that help visually impaired users.
Given the user's spoken command, classify it into exactly one intent.

Intents:
- scene_summarize: User wants to know what's around them, describe surroundings, or what they're looking at
- ocr_read_text: User wants text read aloud from a sign, document, screen, paper, etc.
- face_recognize: User wants to identify a person in front of them
- face_enroll: User wants to save/remember a new person's face
- find_object: User is looking for, searching for, or has lost a specific object (extract ONLY the object name as param, e.g. "keys", "phone", "bag" — not the full sentence)
- currency_recognize: User wants to identify money, bills, or coins
- color_detect: User wants to know the color of something
- visual_qa: User is asking a visual question that doesn't fit the above categories (extract the full question as param)
- unknown: Not a visual command at all (e.g., "what time is it", "tell me a joke")

The user may speak in Arabic or English. Classify based on meaning regardless of language.
Respond with ONLY valid JSON: {"intent": "...", "param": "..."}
The "param" field is optional. Include it for find_object (just the object name, e.g. "keys" not "find my keys") and visual_qa (the full question).
Do NOT include filler words, verbs, or possessives in the param for find_object — just the bare object noun.`;

// ─── Keyword-based fallback ─────────────────────────────────────────────

const commandMap: Array<{ words: string[]; command: CommandType }> = [
  { words: ["describe", "وصف"], command: "scene-summarize" },
  { words: ["read", "اقرأ"], command: "ocr-read-text" },
  { words: ["who", "من"], command: "face-recognize" },
  { words: ["enroll", "سجل"], command: "face-enroll" },
  { words: ["find", "وين"], command: "find-object" },
  { words: ["money", "فلوس"], command: "currency-recognize" },
  { words: ["color", "لون"], command: "color-detect" },
];

/**
 * Keyword-based command routing (fallback).
 * Matches the first word of the transcription against known trigger words.
 */
function routeCommandByKeyword(transcription: string): RouteResult | null {
  const text = transcription.toLowerCase().trim();
  if (text.length === 0) return null;

  const firstWord = text.split(/\s+/)[0];

  for (const entry of commandMap) {
    if (entry.words.includes(firstWord)) {
      logger.info(`[Keyword] Matched: ${entry.command} (trigger: "${firstWord}")`);

      let params: Record<string, string> | undefined;
      if (entry.command === "find-object") {
        const rest = text.slice(firstWord.length).trim();
        params = { objectName: rest || "object" };
      } else if (entry.command === "ocr-read-text") {
        params = { context: transcription };
      }

      return { command: entry.command, params, rawText: transcription };
    }
  }

  // Default: treat as visual question answering
  logger.info("[Keyword] No match — defaulting to Visual QA");
  return {
    command: "visual-qa",
    params: { question: transcription },
    rawText: transcription,
  };
}

// ─── LLM-based classification ───────────────────────────────────────────

/**
 * Classifies a transcription into an intent using an LLM call via OpenRouter.
 * Returns null on any failure (timeout, parse error, network error).
 */
async function classifyIntent(
  transcription: string,
  signal?: AbortSignal
): Promise<ClassificationResult | null> {
  if (!config.openRouterApiKey) {
    logger.warn("No OpenRouter API key — skipping LLM classification");
    return null;
  }

  try {
    // Combine the external abort signal with a timeout
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), CLASSIFY_TIMEOUT_MS);

    // If the external signal aborts, also abort our controller
    const onExternalAbort = () => timeoutController.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.classificationModel,
          max_tokens: 80,
          messages: [
            { role: "system", content: CLASSIFIER_PROMPT },
            { role: "user", content: transcription },
          ],
        }),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        logger.warn(`LLM classification failed: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) {
        logger.warn("LLM returned empty response");
        return null;
      }

      // Strip markdown code fences if present (e.g., ```json ... ```)
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

      const parsed = JSON.parse(cleaned) as ClassificationResult;

      if (!parsed.intent || !validIntents.has(parsed.intent)) {
        logger.warn(`LLM returned invalid intent: "${parsed.intent}"`);
        return null;
      }

      logger.info(`[LLM] Classified as: ${parsed.intent}${parsed.param ? ` (param: "${parsed.param}")` : ""}`);
      return parsed;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      logger.warn("LLM classification aborted/timed out");
    } else {
      logger.warn("LLM classification error:", error);
    }
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Routes a transcription to the correct command.
 * Tries LLM-based intent classification first, falls back to keyword matching.
 *
 * Returns a RouteResult with command "unknown" if the LLM determines the
 * transcription is not a visual command. The caller should handle this
 * by speaking a help message.
 */
export async function routeCommand(
  transcription: string,
  signal?: AbortSignal
): Promise<RouteResult | null> {
  const text = transcription.trim();
  logger.info(`Routing transcription: "${text}"`);

  if (text.length === 0) {
    logger.info("Empty transcription — ignoring");
    return null;
  }

  // Try LLM classification first
  const classification = await classifyIntent(text, signal);

  if (classification) {
    // Handle "unknown" — not a visual command
    if (classification.intent === "unknown") {
      logger.info("[LLM] Intent is unknown — will show help");
      return { command: "unknown" as CommandType, rawText: transcription };
    }

    const command = intentToCommand[classification.intent];
    const params: Record<string, string> = {};

    if (classification.intent === "find_object" && classification.param) {
      params.objectName = classification.param;
    } else if (classification.intent === "visual_qa") {
      params.question = classification.param || transcription;
    } else if (classification.intent === "ocr_read_text") {
      params.context = transcription;
    }

    return {
      command,
      params: Object.keys(params).length > 0 ? params : undefined,
      rawText: transcription,
    };
  }

  // Fallback to keyword matching
  logger.info("LLM classification unavailable — falling back to keyword matching");
  return routeCommandByKeyword(transcription);
}
