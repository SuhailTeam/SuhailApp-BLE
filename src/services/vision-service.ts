import { config } from "../utils/config";
import { Logger } from "../utils/logger";
import type { VisionResponse } from "../types";

const logger = new Logger("VisionService");

/** Returns the language instruction based on config */
function langInstruction(): string {
  return config.defaultLanguage === "ar"
    ? "Respond in Arabic."
    : "Respond in English.";
}

function langName(): string {
  return config.defaultLanguage === "ar" ? "Arabic" : "English";
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
export async function describeScene(imageBase64: string): Promise<VisionResponse> {
  logger.info("Sending image to OpenRouter API...");
  try {
    const description = await callVisionAPI({
      prompt: `You are the eyes of a blind person. Describe what's in front of them in 2-3 short sentences. Focus on people, obstacles, and key objects. Skip minor details. ${langInstruction()}`,
      imageBase64,
      maxTokens: 150,
    });
    logger.info(`Received scene description: ${description}`);
    return {
      description: description || (config.defaultLanguage === "ar"
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
 * Sends a photo to OpenRouter for a scene description, with known face names
 * injected into the prompt so the LLM uses them naturally.
 */
export async function describeSceneWithFaces(
  imageBase64: string,
  knownNames: string[],
): Promise<VisionResponse> {
  logger.info(`Sending image to OpenRouter API with ${knownNames.length} known face(s)...`);
  try {
    const namesContext = knownNames.length > 0
      ? `The following people have been identified in this image: ${knownNames.join(", ")}. Use their names when describing them.`
      : "";

    const description = await callVisionAPI({
      prompt: `You are the eyes of a blind person. Describe what's in front of them in 2-3 short sentences. Focus on people, obstacles, and key objects. Skip minor details. ${namesContext} ${langInstruction()}`,
      imageBase64,
      maxTokens: 200,
    });
    logger.info(`Received face-aware scene description: ${description}`);
    return {
      description: description || (config.defaultLanguage === "ar"
        ? "عذرًا، لم أتمكن من الحصول على وصف للصورة."
        : "Sorry, I couldn't get a description of the image."),
      confidence: 0.90,
    };
  } catch (error) {
    logger.error("Failed to connect to OpenRouter API for face-aware scene description", error);
    throw error;
  }
}

/**
 * Sends a photo and a question to a vision LLM for visual question answering.
 */
export async function answerVisualQuestion(
  imageBase64: string,
  question: string
): Promise<VisionResponse> {
  logger.info(`Sending image + question to OpenRouter: "${question}"`);
  try {
    const description = await callVisionAPI({
      prompt: `${question}\n\nAnswer briefly in 1-2 sentences based on the image. Be direct. Your response will be read aloud by text-to-speech, so use plain spoken language only — no markdown, no LaTeX, no special symbols. Write math as spoken words (e.g. "x equals 37 over 5" not "$x = 37/5$"). ${langInstruction()}`,
      imageBase64,
      maxTokens: 200,
    });
    logger.info(`Received VQA answer: ${description}`);
    return {
      description: description || (config.defaultLanguage === "ar"
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
 * Sends a photo to OpenRouter for currency/money recognition.
 */
export async function recognizeCurrency(imageBase64: string): Promise<{
  denomination: string;
  currency: string;
  confidence: number;
}> {
  logger.info("Sending image to OpenRouter for currency recognition...");
  try {
    const raw = await callVisionAPI({
      prompt: "Identify the currency and denomination of the money in this image. Respond ONLY with a raw JSON object (no markdown) containing 'denomination' (string, e.g. '50') and 'currency' (string, e.g. 'SAR').",
      imageBase64,
      maxTokens: 100,
    });
    const parsed = JSON.parse(cleanJSON(raw) || "{}");
    return {
      denomination: parsed.denomination || "0",
      currency: parsed.currency || "UNKNOWN",
      confidence: 0.90,
    };
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
  targetObject: string
): Promise<{ found: boolean; location: string; confidence: number }> {
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
{"found": true/false, "location": "spatial description in ${langName()}, or empty string if not found"}`,
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
export async function extractText(imageBase64: string, context?: string): Promise<string> {
  logger.info("Sending image to OpenRouter for text extraction (vision OCR)...");
  try {
    const prompt = context
      ? `The user asked: "${context}". Read ONLY the text from the specific object or area they are referring to. Return the text exactly as written, preserving the reading order. Do not include text from other objects, screens, or surfaces in the scene. Do not describe the image or add any commentary. If no text is found on that object, respond with an empty string. ${langInstruction()}`
      : `Read and extract ALL visible text from this image. Return ONLY the text you can see, exactly as written, preserving the reading order. Do not describe the image or add any commentary. If no text is found, respond with an empty string. ${langInstruction()}`;

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
export async function detectColor(imageBase64: string): Promise<{
  colorName: string;
  hex: string;
}> {
  logger.info("Analyzing image for dominant color via OpenRouter...");
  try {
    const raw = await callVisionAPI({
      prompt: `Identify the dominant color in the center of this image. Respond ONLY with a raw JSON object (no markdown) containing 'colorName' (the name of the color in ${langName()}) and 'hex' (the hex code of the color).`,
      imageBase64,
      maxTokens: 80,
    });
    const parsed = JSON.parse(cleanJSON(raw) || "{}");
    return {
      colorName: parsed.colorName || (config.defaultLanguage === "ar" ? "غير معروف" : "unknown"),
      hex: parsed.hex || "#000000",
    };
  } catch (error) {
    logger.error("Failed to detect color via OpenRouter API", error);
    throw error;
  }
}
