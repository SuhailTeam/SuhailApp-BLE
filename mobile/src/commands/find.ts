import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { detectObject } from "../relay/vision";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Find");

/**
 * Find-object command — mirrors src/commands/find-object.ts.
 * Captures a photo, looks for the object the intent classifier extracted,
 * returns the spatial location ("on the desk to your right") or a localised
 * "I couldn't find X" if not present.
 */
export async function executeFind(opts: {
  language: Language;
  objectName?: string;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;
  const objectName = (opts.objectName ?? "").trim() || "object";

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const result = await detectObject({ photoToken: photo.photoToken }, objectName, language, signal);
  logger.info(`find "${objectName}": found=${result.found} location="${result.location}"`);

  if (result.found && result.location) {
    return result.location;
  }
  return language === "ar"
    ? `ما قدرت ألاقي ${objectName} في الصورة.`
    : `I couldn't find ${objectName} in the image.`;
}
