import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { ocr } from "../relay/vision";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Read");

/**
 * Hard cap on the spoken OCR result. The cloud version uses 400 — same value
 * here so behaviour matches. Long OCR runs (street signs full of legalese,
 * dense menus) lock the user into 30s+ of dictation otherwise.
 */
const OCR_MAX_CHARS = 400;

const TRUNCATION_SUFFIX = {
  ar: " وغيره. اسحب للأمام للإيقاف.",
  en: " ...and more. Swipe forward to stop.",
} as const;

const NO_TEXT_MESSAGE = {
  ar: "ما قدرت ألاقي نص في الصورة.",
  en: "I couldn't find any text in the image.",
} as const;

/**
 * OCR / read-text command — mirrors src/commands/ocr-read-text.ts in the
 * cloud app. Captures a photo, extracts visible text via the vision LLM,
 * collapses whitespace so TTS reads it as continuous prose, truncates to
 * 400 chars with the localised "...and more. Swipe forward to stop." tail.
 *
 * The `context` param is the original transcription — passed to OCR so the
 * vision model can scope to the object the user actually asked about (e.g.
 * "read this menu" → only the menu, not surrounding signage).
 */
export async function executeRead(opts: {
  language: Language;
  context?: string;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, context, signal, preCapture } = opts;

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const { text } = await ocr({ photoToken: photo.photoToken }, language, context, signal);
  if (signal?.aborted) throw new Error("aborted");

  const cleaned = (text ?? "").replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  logger.info(`OCR result (${cleaned.length} chars)`);

  if (cleaned.length === 0) {
    return NO_TEXT_MESSAGE[language];
  }

  return cleaned.length > OCR_MAX_CHARS
    ? cleaned.slice(0, OCR_MAX_CHARS).trim() + TRUNCATION_SUFFIX[language]
    : cleaned;
}
