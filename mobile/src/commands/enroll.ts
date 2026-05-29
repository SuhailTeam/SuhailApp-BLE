import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { enrollFace } from "../relay/faces";
import { messages, type Language } from "../i18n/messages";
import {
  setPendingPhoto,
  consumePendingPhoto,
  markProcessing,
  unmarkProcessing,
  takeInterruptedFlag,
} from "../state/enrollment";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Enroll");

/**
 * Substrings that mean "this transcription is the app's own speech bleeding
 * back into the mic during the echo-guard window." Reject them so a user
 * who happens to swipe + speak the name immediately after the prompt
 * doesn't end up enrolling someone as "Photo captured please say the…".
 *
 * Mirrors the cloud version's echoPatterns (face-enroll.ts:49) byte-for-byte
 * plus the two bilingual prompt strings this slice ships.
 */
const ECHO_PATTERNS = [
  "photo captured", "please say", "person's name",
  "تم التقاط", "من فضلك", "اسم الشخص",
  "capturing face", "جاري التقاط",
];

// PROMPT + FAILURE live in i18n/messages.ts (messages.enrollPrompt /
// messages.enrollFailed) so they can be pre-bundled as audio. SUCCESS stays
// here because it embeds the name and so can't be a static asset.
const SUCCESS = (name: string, language: Language): string =>
  language === "ar" ? `تم تسجيل ${name} بنجاح.` : `${name} has been enrolled successfully.`;

/**
 * Step 1: capture a photo and stash it as the pending enrollment. Returns
 * the bilingual "say the name" prompt for the listening state machine to
 * speak. listening.ts schedules a 30s timeout immediately after — if no
 * name arrives, the timeout fires the cancel speech and clears the pending
 * state.
 */
export async function executeEnrollStep1(opts: {
  language: Language;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  setPendingPhoto(photo.photoToken);
  logger.info(`step 1: photo ${photo.photoToken.slice(0, 8)}... captured; awaiting name`);
  return messages.enrollPrompt[language];
}

/**
 * Step 2: complete the enrollment with the name the user just said.
 *
 * Returns:
 *   - a success/failure string to speak when enrollment ran
 *   - null when the input should be SILENTLY IGNORED:
 *     - text matched an echo pattern (mic picked up our own prompt)
 *     - another completion is already in flight (concurrent guard)
 *     - the enrollment was interrupted between request and response
 *
 * Caller (listening.ts) speaks the return value via speakWithEchoGuard.
 * On null, the pending state may or may not still be set — caller checks
 * hasPending() to decide whether to restart the 30s timeout (echo case
 * leaves state intact; concurrent + interrupted clear it).
 */
export async function completeEnrollment(opts: {
  name: string;
  language: Language;
  signal?: AbortSignal;
}): Promise<string | null> {
  const cleaned = opts.name.trim();
  if (cleaned.length === 0) return null;

  const lower = cleaned.toLowerCase();
  if (ECHO_PATTERNS.some(p => lower.includes(p))) {
    logger.info(`ignored as TTS echo: "${cleaned}"`);
    return null;
  }

  if (!markProcessing()) {
    logger.warn(`concurrent enrollment ignored: "${cleaned}"`);
    return null;
  }

  try {
    const photoToken = consumePendingPhoto();
    if (!photoToken) {
      // Pending was cleared between hasPending() check and here (e.g.
      // a cancel landed). Nothing to enroll.
      logger.warn("pending photo gone — completion aborted");
      return null;
    }

    logger.info(`step 2: enrolling "${cleaned}" with photo ${photoToken.slice(0, 8)}...`);
    const result = await enrollFace({ photoToken }, cleaned, opts.signal);

    if (takeInterruptedFlag()) {
      logger.info("interrupted mid-enrollment — suppressing success speech");
      return null;
    }

    if (!result?.faceId) {
      logger.warn("enrollFace returned no faceId");
      return messages.enrollFailed[opts.language];
    }

    logger.info(`enrolled "${cleaned}" → faceId ${result.faceId.slice(0, 8)}...`);
    return SUCCESS(cleaned, opts.language);
  } catch (err) {
    if (takeInterruptedFlag()) return null;
    logger.error("enrollment failed:", err);
    return messages.enrollFailed[opts.language];
  } finally {
    unmarkProcessing();
  }
}
