import { Logger } from "../utils/logger";
import * as visionService from "./vision-service";

const logger = new Logger("OCRService");

/**
 * Extracts text from an image using the vision LLM (via OpenRouter).
 */
export async function extractText(imageBase64: string, context?: string): Promise<string> {
  logger.info("Routing OCR to vision LLM for text extraction...");
  return visionService.extractText(imageBase64, context);
}
