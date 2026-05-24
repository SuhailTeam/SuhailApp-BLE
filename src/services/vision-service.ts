import { config } from "../utils/config";
import { Logger } from "../utils/logger";
import { getSettings } from "./settings-store";
import type { VisionResponse, CurrencyResult, CurrencyBill, Language } from "../types";

const logger = new Logger("VisionService");

/** Resolves an optional language override to a concrete value (falls back to current settings). */
function resolveLanguage(language?: Language): Language {
  return language ?? getSettings().language;
}

/** Returns the language instruction for the prompt. */
function langInstruction(language: Language): string {
  return language === "ar" ? "Respond in Arabic." : "Respond in English.";
}

/** Returns the language's English name (used inside prompts as a literal). */
function langName(language: Language): string {
  return language === "ar" ? "Arabic" : "English";
}

/* ── Shared OpenRouter vision helper ─────────────────────── */

interface VisionCallOptions {
  prompt: string;
  imageBase64: string;
  maxTokens?: number;
}

/**
 * Sends an image + text prompt to the OpenRouter vision API and returns the
 * model's text response. All exported functions delegate to this helper.
 */
async function callVisionAPI(options: VisionCallOptions): Promise<string> {
  const { prompt, imageBase64, maxTokens } = options;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.visionModel,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Strips markdown code fences from LLM JSON output. */
function cleanJSON(raw: string): string {
  return raw.replace(/```json/g, "").replace(/```/g, "").trim();
}

/* ── Exported vision functions ───────────────────────────── */

/**
 * Sends a photo to OpenRouter for a scene description.
 */
export async function describeScene(imageBase64: string, language?: Language): Promise<VisionResponse> {
  const lang = resolveLanguage(language);
  logger.info("Sending image to OpenRouter API...");
  try {
    const description = await callVisionAPI({
      prompt: `You are describing a scene to a blind person wearing smart glasses. In 2-3 short sentences (~50 words total), describe what they're facing: the setting or space they're in, the main objects in view, and where things are positioned relative to them (e.g., "on the desk in front of you", "to your right"). Mention people you see but don't try to identify them. Skip minor details like brand names or text on screens. Use natural spoken language — no markdown, lists, or symbols. ${langInstruction(lang)}`,
      imageBase64,
      maxTokens: 200,
    });
    logger.info(`Received scene description: ${description}`);
    return {
      description: description || (lang === "ar"
        ? "عذرًا، لم أتمكن من الحصول على وصف للصورة."
        : "Sorry, I couldn't get a description of the image."),
      confidence: 0.90,
    };
  } catch (error) {
    logger.error("Failed to connect to OpenRouter API", error);
    throw error;
  }
}

/**
 * Sends a photo and a question to a vision LLM for visual question answering.
 */
export async function answerVisualQuestion(
  imageBase64: string,
  question: string,
  language?: Language,
): Promise<VisionResponse> {
  const lang = resolveLanguage(language);
  logger.info(`Sending image + question to OpenRouter: "${question}"`);
  try {
    const description = await callVisionAPI({
      prompt: `${question}\n\nAnswer briefly in 1-2 sentences based on the image. Be direct. Your response will be read aloud by text-to-speech, so use plain spoken language only — no markdown, no LaTeX, no special symbols. Write math as spoken words (e.g. "x equals 37 over 5" not "$x = 37/5$"). ${langInstruction(lang)}`,
      imageBase64,
      maxTokens: 200,
    });
    logger.info(`Received VQA answer: ${description}`);
    return {
      description: description || (lang === "ar"
        ? "عذرًا، لم أتمكن من الإجابة على السؤال."
        : "Sorry, I couldn't answer the question."),
      confidence: 0.90,
    };
  } catch (error) {
    logger.error("Failed to connect to OpenRouter API for VQA", error);
    throw error;
  }
}

/**
 * Parses the LLM's JSON currency response into a CurrencyResult.
 * Defensive: malformed or empty responses become an empty result, never throws.
 * Groups bills by currency, picks the largest-total currency as dominant.
 */
function parseCurrencyResponse(raw: string): CurrencyResult {
  let parsed: any;
  try {
    parsed = JSON.parse(cleanJSON(raw) || "{}");
  } catch {
    return { bills: [], total: 0, currency: "UNKNOWN", confidence: 0.90 };
  }

  const rawBills = Array.isArray(parsed?.bills) ? parsed.bills : [];

  type Entry = { denomination: number; count: number; currency: string };
  const valid: Entry[] = [];
  for (const b of rawBills) {
    const denom = Number(b?.denomination);
    const count = Number(b?.count);
    const curr = typeof b?.currency === "string" ? b.currency.toUpperCase().trim() : "UNKNOWN";
    if (
      Number.isFinite(denom) && denom > 0 &&
      Number.isFinite(count) && count > 0 && count < 1000
    ) {
      valid.push({ denomination: denom, count: Math.floor(count), currency: curr || "UNKNOWN" });
    }
  }

  if (valid.length === 0) {
    return { bills: [], total: 0, currency: "UNKNOWN", confidence: 0.90 };
  }

  const byCurrency = new Map<string, Entry[]>();
  for (const e of valid) {
    if (!byCurrency.has(e.currency)) byCurrency.set(e.currency, []);
    byCurrency.get(e.currency)!.push(e);
  }

  const buckets = Array.from(byCurrency.entries())
    .map(([c, entries]) => ({
      currency: c,
      entries,
      total: entries.reduce((s, e) => s + e.denomination * e.count, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const mergeBucket = (entries: Entry[]): CurrencyBill[] => {
    const merged = new Map<number, number>();
    for (const e of entries) {
      merged.set(e.denomination, (merged.get(e.denomination) ?? 0) + e.count);
    }
    return Array.from(merged.entries())
      .map(([denomination, count]) => ({ denomination, count }))
      .sort((a, b) => b.denomination - a.denomination);
  };

  const dominant = buckets[0];
  const others = buckets.slice(1);

  return {
    bills: mergeBucket(dominant.entries),
    total: dominant.total,
    currency: dominant.currency,
    confidence: 0.90,
    ...(others.length > 0 && {
      otherCurrencies: others.map(o => ({
        currency: o.currency,
        bills: mergeBucket(o.entries),
        total: o.total,
      })),
    }),
  };
}

/**
 * Sends a photo to OpenRouter for currency/money recognition.
 * Counts each denomination separately so the caller can speak a full summary
 * (e.g. "3 bills of 500 Riyal, total 1500") rather than picking a single bill.
 */
export async function recognizeCurrency(imageBase64: string): Promise<CurrencyResult> {
  logger.info("Sending image to OpenRouter for currency recognition...");
  try {
    const raw = await callVisionAPI({
      prompt: `You are looking at a photo through smart glasses worn by a blind user who is trying to count their cash.

Carefully count EVERY paper bill (banknote) and coin visible in the image. Group them by denomination — do NOT just describe the most prominent bill.

For each denomination present, return an entry with:
- "denomination": the numeric face value as a number (e.g. 500, 100, 50, not "500 SAR")
- "count": how many bills/coins of that exact denomination you see as a number
- "currency": the 3-letter ISO code ("SAR" for Saudi Riyal, "USD" for US Dollar, "EUR" for Euro, "AED" for UAE Dirham, etc.)

Stacked, overlapping, or partially visible bills still count if you can identify their denomination. Do NOT count the same physical bill twice. Do NOT invent bills you cannot actually see.

Respond ONLY with a raw JSON object (no markdown, no commentary) in this exact shape:
{"bills": [{"denomination": 500, "count": 3, "currency": "SAR"}], "notes": ""}

If no money is visible, respond with: {"bills": [], "notes": "no money visible"}
If you can see bills but cannot identify the denomination, respond with: {"bills": [], "notes": "denomination unclear"}`,
      imageBase64,
      maxTokens: 300,
    });
    const result = parseCurrencyResponse(raw);
    logger.info(`Currency recognized: ${result.bills.length} denomination(s), total ${result.total} ${result.currency}`);
    return result;
  } catch (error) {
    logger.error("Failed to recognize currency via OpenRouter API", error);
    throw error;
  }
}

/**
 * Sends a photo to OpenRouter for object detection/location.
 */
export async function detectObject(
  imageBase64: string,
  targetObject: string,
  language?: Language,
): Promise<{ found: boolean; location: string; confidence: number }> {
  const lang = resolveLanguage(language);
  logger.info(`Searching for "${targetObject}" via OpenRouter...`);
  try {
    const raw = await callVisionAPI({
      prompt: `You are helping a visually impaired person find "${targetObject}" using their smart glasses camera.

Look carefully at the entire image for "${targetObject}" or anything that closely resembles it.

If found, describe its location using spatial directions relative to the person wearing the glasses:
- Use directions like "to your left", "to your right", "straight ahead", "above you", "below you", "on the table in front of you", "on the floor to your left", etc.
- Include distance cues when possible: "nearby", "at arm's reach", "far away"
- Mention what it's near or on top of for context (e.g., "on the desk next to the laptop")

Respond ONLY with a raw JSON object (no markdown):
{"found": true/false, "location": "spatial description in ${langName(lang)}, or empty string if not found"}`,
      imageBase64,
      maxTokens: 150,
    });
    const parsed = JSON.parse(cleanJSON(raw) || "{}");
    return {
      found: !!parsed.found,
      location: parsed.location || "",
      confidence: 0.90,
    };
  } catch (error) {
    logger.error("Failed to detect object via OpenRouter API", error);
    throw error;
  }
}

/**
 * Extracts all visible text from an image using the vision LLM.
 */
export async function extractText(
  imageBase64: string,
  context?: string,
  language?: Language,
): Promise<string> {
  const lang = resolveLanguage(language);
  logger.info("Sending image to OpenRouter for text extraction (vision OCR)...");
  try {
    const prompt = context
      ? `The user asked: "${context}". Read ONLY the text from the specific object or area they are referring to. Return the text exactly as written, preserving the reading order. Do not include text from other objects, screens, or surfaces in the scene. Do not describe the image or add any commentary. If no text is found on that object, respond with an empty string. ${langInstruction(lang)}`
      : `Read and extract ALL visible text from this image. Return ONLY the text you can see, exactly as written, preserving the reading order. Do not describe the image or add any commentary. If no text is found, respond with an empty string. ${langInstruction(lang)}`;

    const extractedText = await callVisionAPI({
      prompt,
      imageBase64,
      maxTokens: 500,
    });
    logger.info(`Vision OCR result: ${extractedText.substring(0, 100)}...`);
    return extractedText;
  } catch (error) {
    logger.error("Failed to extract text via OpenRouter API", error);
    throw error;
  }
}

/**
 * Analyzes the center region of an image to detect the dominant color.
 */
export async function detectColor(imageBase64: string, language?: Language): Promise<{
  colorName: string;
  hex: string;
}> {
  const lang = resolveLanguage(language);
  logger.info("Analyzing image for dominant color via OpenRouter...");
  try {
    const raw = await callVisionAPI({
      prompt: `Identify the dominant color in the center of this image. Respond ONLY with a raw JSON object (no markdown) containing 'colorName' (the name of the color in ${langName(lang)}) and 'hex' (the hex code of the color).`,
      imageBase64,
      maxTokens: 80,
    });
    const parsed = JSON.parse(cleanJSON(raw) || "{}");
    return {
      colorName: parsed.colorName || (lang === "ar" ? "غير معروف" : "unknown"),
      hex: parsed.hex || "#000000",
    };
  } catch (error) {
    logger.error("Failed to detect color via OpenRouter API", error);
    throw error;
  }
}
