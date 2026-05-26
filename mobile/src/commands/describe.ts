import { capturePhoto } from "../ble/camera";
import { describeScene, type ImageSource } from "../relay/vision";
import { recognizeAllFaces } from "../relay/faces";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Describe");

/**
 * Confidence threshold for "this is a known face" — matches the cloud server's
 * CONFIDENCE_THRESHOLD default (0.5). When the server adds a per-request
 * override or we expose it via settings, wire it through here.
 */
const KNOWN_FACE_MIN_CONFIDENCE = 0.5;

/** Soft cap on the final spoken text so OCR-ish runaway descriptions don't drone. */
const MAX_SCENE_CHARS = 350;

const TRUNCATION_SUFFIX = {
  ar: " وغيره. اسحب للأمام للإيقاف.",
  en: " ...and more. Swipe forward to stop.",
} as const;

function namesPrefix(names: string[], language: Language): string {
  if (names.length === 0) return "";
  const joiner = language === "ar" ? "، " : ", ";
  return `${names.join(joiner)}. `;
}

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBoundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (lastBoundary > maxChars * 0.5) return slice.slice(0, lastBoundary + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return slice.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trim();
}

/**
 * Scene-summarize command (mirrors src/commands/scene-summarize.ts in the
 * cloud app): capture a photo, run scene description + multi-face recognition
 * in parallel, prepend recognised names, truncate if long, return the spoken
 * text. Caller speaks the result + updates lastResponse.
 *
 * Throws on capture or vision failure; caller catches and speaks the
 * generalError message.
 */
export async function executeDescribe(opts: { language: Language; signal?: AbortSignal }): Promise<string> {
  const { language, signal } = opts;

  // Step 1: trigger the BLE photo capture. Resolves with a server-side
  // photoToken once glasses have uploaded successfully.
  const photo = await capturePhoto({ signal });
  if (signal?.aborted) throw new Error("aborted");

  const source: ImageSource = { photoToken: photo.photoToken };

  // Step 2: scene + faces in parallel. Both use the same photoToken; the
  // server-side photo cache is non-evicting (TTL handles cleanup) so both
  // reads succeed.
  logger.info(`vision parallel: scene + recognize-all (token=${photo.photoToken.slice(0, 8)}...)`);
  const [sceneSettled, facesSettled] = await Promise.allSettled([
    describeScene(source, language, signal),
    recognizeAllFaces(source, signal),
  ]);

  if (signal?.aborted) throw new Error("aborted");

  // Scene is required — if it failed there's nothing to say. Faces are
  // optional decoration; if recognition errored we just skip names.
  if (sceneSettled.status !== "fulfilled") {
    logger.error("describeScene failed:", sceneSettled.reason);
    throw sceneSettled.reason;
  }

  let knownNames: string[] = [];
  if (facesSettled.status === "fulfilled") {
    knownNames = facesSettled.value.faces
      .filter(f => f.isKnown && f.name && f.confidence >= KNOWN_FACE_MIN_CONFIDENCE)
      .map(f => f.name!) // safe: filter above asserts f.name is truthy
      .filter((n, i, arr) => arr.indexOf(n) === i); // dedupe (multi-face same person)
    if (knownNames.length > 0) {
      logger.info(`recognized: ${knownNames.join(", ")}`);
    }
  } else {
    logger.warn("face recognition failed (continuing without names):", facesSettled.reason);
  }

  const raw = `${namesPrefix(knownNames, language)}${sceneSettled.value.description}`;
  const final = raw.length > MAX_SCENE_CHARS
    ? truncateAtBoundary(raw, MAX_SCENE_CHARS) + TRUNCATION_SUFFIX[language]
    : raw;

  logger.info(`scene (${raw.length}→${final.length} chars): ${final.slice(0, 80)}${final.length > 80 ? "…" : ""}`);
  return final;
}
