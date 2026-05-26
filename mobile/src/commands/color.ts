import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { detectColor } from "../relay/vision";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Color");

/**
 * Color-detect command — mirrors src/commands/color-detect.ts.
 * Captures a photo, identifies the dominant colour in the centre region,
 * returns "The color is X" / "اللون هو X".
 */
export async function executeColor(opts: {
  language: Language;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const result = await detectColor({ photoToken: photo.photoToken }, language, signal);
  logger.info(`color: ${result.colorName} (${result.hex})`);

  return language === "ar"
    ? `اللون هو ${result.colorName}`
    : `The color is ${result.colorName}`;
}
