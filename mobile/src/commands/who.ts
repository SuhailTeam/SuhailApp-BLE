import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { recognizeAllFaces } from "../relay/faces";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Who");

/** Mirror cloud's CONFIDENCE_THRESHOLD default (0.5). */
const KNOWN_FACE_MIN_CONFIDENCE = 0.5;

const NO_ONE_MESSAGE = {
  ar: "ما أشوف أحد قدامك.",
  en: "I don't see anyone in front of you.",
} as const;

/**
 * Face-recognize command — mirrors src/commands/face-recognize.ts.
 * Captures a photo, runs multi-face recognition, speaks a localised summary
 * of who's in front of the user and how many strangers there are.
 *
 * Examples:
 *   1 known, 0 unknown:  "I see Abdullah"
 *   2 known, 0 unknown:  "I see Abdullah and Sara"
 *   1 known, 1 unknown:  "I see Abdullah, and one person I don't recognize"
 *   0 known, 3 unknown:  "3 people I don't recognize"
 *   0 known, 0 detected: "I don't see anyone in front of you."
 */
export async function executeWho(opts: {
  language: Language;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const result = await recognizeAllFaces({ photoToken: photo.photoToken }, signal);
  const known = result.faces
    .filter(f => f.isKnown && f.name && f.confidence >= KNOWN_FACE_MIN_CONFIDENCE)
    .map(f => f.name!)
    .filter((n, i, arr) => arr.indexOf(n) === i); // dedupe — multi-face same person
  const unknownCount = Math.max(0, result.totalDetected - known.length);

  logger.info(`who: ${result.totalDetected} detected, ${known.length} known, ${unknownCount} unknown`);

  if (result.totalDetected === 0) {
    return NO_ONE_MESSAGE[language];
  }

  const parts: string[] = [];
  if (language === "ar") {
    if (known.length > 0) parts.push(`أشوف ${known.join(" و ")}`);
    if (unknownCount === 1) parts.push("شخص واحد ما أعرفه");
    else if (unknownCount > 1) parts.push(`${unknownCount} أشخاص ما أعرفهم`);
    return parts.join("، و");
  } else {
    if (known.length > 0) parts.push(`I see ${known.join(" and ")}`);
    if (unknownCount === 1) parts.push("one person I don't recognize");
    else if (unknownCount > 1) parts.push(`${unknownCount} people I don't recognize`);
    return parts.join(", and ");
  }
}
