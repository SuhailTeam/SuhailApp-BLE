import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { answerVisualQuestion } from "../relay/vision";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.VQA");

/**
 * Visual-question-answering command — mirrors src/commands/visual-qa.ts.
 * Catches any user utterance that doesn't fit the other 7 intents; captures
 * a photo and asks the vision LLM the user's question against it.
 *
 * If the intent classifier failed to extract a clean question, fall back to
 * the generic "what do you see?" prompt.
 */
export async function executeVqa(opts: {
  language: Language;
  question?: string;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;
  const question = (opts.question ?? "").trim() || (language === "ar" ? "ماذا ترى؟" : "What do you see?");

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const result = await answerVisualQuestion({ photoToken: photo.photoToken }, question, language, signal);
  logger.info(`vqa "${question.slice(0, 40)}..." → ${result.description.slice(0, 60)}...`);

  return result.description;
}
