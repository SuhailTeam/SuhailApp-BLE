import { create } from "zustand";
import { playCue } from "../audio/cues";
import { speak } from "../audio/tts";
import { stopAll as stopAllAudio } from "../audio/playback";
import { cancelCapture, startCapture } from "../ble/mic";
import { transcribe as sttTranscribe } from "../relay/stt";
import { classifyIntent, type CommandType } from "../relay/intent";
import { normalize } from "../relay/normalize";
import { executeDescribe } from "../commands/describe";
import { executeRead } from "../commands/read";
import { executeColor } from "../commands/color";
import { executeFind } from "../commands/find";
import { executeWho } from "../commands/who";
import { executeVqa } from "../commands/vqa";
import { executeMoney } from "../commands/money";
import { RelayError } from "../relay/client";
import { messages, type Language } from "../i18n/messages";
import { useActivity } from "./activity";
import { getLastResponse, setLastResponse, clearLastResponse } from "./lastResponse";
import { getSettings } from "./settings";
import { isValidTranscription, needsScriptNormalization } from "../utils/transcription-filter";
import { Logger } from "../utils/logger";

const logger = new Logger("Listening");

/* ── Constants — port from src/app.ts ────────────────────────────────────── */

/** Failsafe: if nothing happens, force-stop the mic after this long. */
export const LISTENING_TIMEOUT_MS = 10_000;

/** Ignore transcriptions for this long after activation (stale audio). */
export const LISTENING_GRACE_MS = 1_000;

/** TTS echo guard — keep "speaking" true for this long after audio finishes. */
export const TTS_ECHO_BUFFER_MS = 1_500;

/** Minimum confidence to accept a transcription. */
export const MIN_CONFIDENCE = 0.55;

export type ListeningState = "idle" | "active" | "processing";

interface ListeningStore {
  state: ListeningState;
  activatedAt: number;
  /** True for the TTS echo guard window (during speech + buffer afterwards). */
  speaking: boolean;
}

const useListening = create<ListeningStore>(() => ({
  state: "idle",
  activatedAt: 0,
  speaking: false,
}));

/* ── Internal handles ────────────────────────────────────────────────────── */

let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
let sttAbort: AbortController | null = null;
/** Token incremented on every cancel — long-running async work checks it before
 *  taking side effects so we don't act on stale captures after an interrupt. */
let activationToken = 0;

function clearFailsafe(): void {
  if (failsafeTimer) {
    clearTimeout(failsafeTimer);
    failsafeTimer = null;
  }
}

function logActivity(event: string): void {
  useActivity.getState().log({ type: "system", command: "listening", event });
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Activates listening (forward swipe / left short press / Test button).
 *   - idle → active (play listening cue, start mic capture)
 *   - active → cancel + cancelled cue (user changed mind)
 *   - processing → silence in-flight audio + STT, re-listen with no cue
 */
export async function activate(): Promise<void> {
  const current = useListening.getState();

  if (current.state === "processing") {
    logger.info("forward swipe during processing — interrupting");
    activationToken++;
    sttAbort?.abort();
    sttAbort = null;
    await cancelCapture().catch(() => {});
    await stopAllAudio().catch(() => {});
    useListening.setState({ speaking: false });
    logActivity("interrupted during processing → listening");
    void runListenSession(/* withCue */ true);
    return;
  }

  if (current.state === "active") {
    logger.info("activate while active — cancelling");
    await cancelInternal(/* withCue */ true);
    return;
  }

  void runListenSession(/* withCue */ true);
}

/**
 * Cancel + return to listening (left short press during active/processing).
 * Same as activate() but never plays the cancelled cue — the listening
 * chime is the user's confirmation that the interrupt worked.
 */
export async function interruptAndListen(): Promise<void> {
  logger.info("interrupt-and-listen (left short press)");
  activationToken++;
  sttAbort?.abort();
  sttAbort = null;
  await cancelCapture().catch(() => {});
  await stopAllAudio().catch(() => {});
  useListening.setState({ speaking: false });
  logActivity("interrupted → listening");
  void runListenSession(/* withCue */ true);
}

/**
 * Repeat the last spoken response (backward swipe / left long press).
 * Works from any state. If nothing to repeat, speaks the `repeatNoHistory`
 * bilingual message.
 */
export async function repeatLast(): Promise<void> {
  const text = getLastResponse();
  const language = getSettings().language;
  const toSay = text ?? messages.repeatNoHistory[language];
  logger.info(text ? `repeat: "${snippet(text)}"` : "repeat — no history");
  logActivity(text ? "repeat last response" : "repeat — no history");
  await speakWithEchoGuard(toSay);
}

export function getListeningState(): ListeningState {
  return useListening.getState().state;
}

export { useListening };

export function isSpeaking(): boolean {
  return useListening.getState().speaking;
}

/**
 * External entry point for transcribed text. The internal STT pipeline calls
 * this with `sttAbort.signal`-routed cancellation, but external callers (tests,
 * debug buttons) can call it directly without a signal.
 *
 * Flow:
 *   1. Filter / grace / confidence checks
 *   2. Optional script normalization (Arabic-script English → Latin) via /api/normalize
 *   3. Intent classification via /api/intent
 *   4. Speak the routed-command preview (slice 3a)  — slice 3b dispatches.
 */
export async function processTranscription(text: string, confidence: number): Promise<void> {
  const language = getSettings().language;

  if (useListening.getState().speaking) {
    logger.info(`ignored (TTS echo guard): "${snippet(text)}"`);
    return;
  }
  if (confidence < MIN_CONFIDENCE) {
    logger.info(`ignored (low confidence ${confidence.toFixed(2)}): "${snippet(text)}"`);
    await finishProcessing(messages.didntCatch[language]);
    return;
  }
  if (!isValidTranscription(text, language)) {
    logger.info(`ignored (filter rejected): "${snippet(text)}"`);
    await finishProcessing(messages.didntCatch[language]);
    return;
  }

  // Step 2: normalize (no-op when not needed; saves an HTTP hop by checking client-side first).
  let normalised = text;
  if (needsScriptNormalization(text, language)) {
    try {
      const result = await normalize(text, language, sttAbort?.signal);
      if (result && result !== text) {
        normalised = result;
        logger.info(`normalised: "${snippet(text)}" → "${snippet(normalised)}"`);
        logActivity(`normalised → "${snippet(normalised)}"`);
      }
    } catch (err) {
      // Non-fatal — server-side normalize is also no-op-safe; falling back to
      // the original text just means the intent classifier sees Arabic-script
      // text it may or may not handle well.
      logger.warn(`normalize failed, using original: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 3: classify intent.
  let route;
  try {
    route = await classifyIntent(normalised, language, sttAbort?.signal);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message === "interrupted")) {
      return;
    }
    logger.error("intent classification failed:", err);
    logActivity("intent classification failed");
    await finishProcessing(messages.generalError[language]);
    return;
  }

  const paramSummary = route.params && Object.keys(route.params).length
    ? ` ${JSON.stringify(route.params)}`
    : "";
  logger.info(`routed: "${snippet(normalised)}" → ${route.command}${paramSummary}`);
  logActivity(`routed → ${route.command}${paramSummary}`);

  // Step 4: dispatch to a real command handler (slice 3b — describe-scene
  // only) OR fall through to the bilingual "would do" preview stub for
  // commands that haven't been ported yet.
  if (route.command === "unknown") {
    await finishProcessing(messages.unknownCommand[language]);
    return;
  }

  try {
    const reply = await dispatchCommand(route.command, route.params, language);
    await finishProcessing(reply);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message === "aborted" || err.message === "interrupted")) {
      return;
    }
    logger.error(`command ${route.command} failed:`, err);
    logActivity(`${route.command} failed`);
    await finishProcessing(messages.generalError[language]);
  }
}

/**
 * Dispatches a routed command to its handler. Real implementations return
 * the text to speak; unported commands fall through to the slice-3a preview
 * stub ("I'd <verb> ... — coming soon").
 *
 * Slice 3b: scene-summarize.
 * Slice 3c: ocr-read-text, color-detect, find-object, face-recognize,
 *           visual-qa, currency-recognize.
 * Slice 3d: face-enroll (stateful 2-step — different shape, ships separately).
 */
async function dispatchCommand(
  command: CommandType,
  params: Record<string, string> | undefined,
  language: Language,
): Promise<string> {
  const signal = sttAbort?.signal;
  switch (command) {
    case "scene-summarize":
      return executeDescribe({ language, signal });

    case "ocr-read-text":
      return executeRead({ language, context: params?.context, signal });

    case "color-detect":
      return executeColor({ language, signal });

    case "find-object":
      return executeFind({ language, objectName: params?.objectName, signal });

    case "face-recognize":
      return executeWho({ language, signal });

    case "currency-recognize":
      return executeMoney({ language, signal });

    case "visual-qa":
      return executeVqa({ language, question: params?.question, signal });

    // Stateful 2-step (capture → ask for name → save) — slice 3d will replace
    // this with a real handler. Until then, speak the preview so users get
    // explicit "coming soon" feedback instead of silence.
    case "face-enroll":
      return describeRoutedCommand(command, params, language);

    case "unknown":
    default:
      // Caller filters "unknown" before reaching here; this is defense in
      // depth so a future type addition gets flagged loudly.
      throw new Error(`dispatchCommand called with unsupported command: ${command}`);
  }
}

/**
 * Bilingual preview of "what we would do" for a routed command. Pure
 * presentation — replaced in slice 3b when real execution lands.
 */
function describeRoutedCommand(
  command: CommandType,
  params: Record<string, string> | undefined,
  language: Language,
): string {
  const objectName = params?.objectName;
  const question = params?.question;

  if (language === "ar") {
    switch (command) {
      case "scene-summarize":     return "سأصف ما حولك (قريبًا).";
      case "ocr-read-text":       return "سأقرأ النص (قريبًا).";
      case "face-recognize":      return "سأتعرف على الوجه (قريبًا).";
      case "face-enroll":         return "سأسجل الوجه (قريبًا).";
      case "find-object":         return `سأبحث عن ${objectName || "الشيء"} (قريبًا).`;
      case "currency-recognize":  return "سأعدّ النقود (قريبًا).";
      case "color-detect":        return "سأحدد اللون (قريبًا).";
      case "visual-qa":           return `سأجيب عن: ${question || "سؤالك"} (قريبًا).`;
      default:                    return "تم تصنيف الأمر.";
    }
  }
  switch (command) {
    case "scene-summarize":     return "I'd describe your surroundings — coming soon.";
    case "ocr-read-text":       return "I'd read the text — coming soon.";
    case "face-recognize":      return "I'd recognize the face — coming soon.";
    case "face-enroll":         return "I'd enroll the face — coming soon.";
    case "find-object":         return `I'd find your ${objectName || "object"} — coming soon.`;
    case "currency-recognize":  return "I'd count the money — coming soon.";
    case "color-detect":        return "I'd detect the color — coming soon.";
    case "visual-qa":           return `I'd answer: ${question || "your question"} — coming soon.`;
    default:                    return "Command routed.";
  }
}

/* ── Internals ───────────────────────────────────────────────────────────── */

/**
 * Single listening session: cue → mic capture → STT → text routing.
 * Each session has its own activationToken; if it gets bumped (interrupt),
 * we abandon all subsequent side effects.
 */
async function runListenSession(withCue: boolean): Promise<void> {
  const myToken = ++activationToken;

  // Enter "active" state immediately so the UI updates while the cue plays.
  clearFailsafe();
  useListening.setState({ state: "active", activatedAt: Date.now() });
  logActivity("listening active");

  if (withCue) {
    try {
      await playCue("listening");
    } catch (err) {
      logger.debug(`listening cue failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (myToken !== activationToken) return; // interrupted while cue played
  if (useListening.getState().state !== "active") return;

  // Grace window starts AFTER the cue (so the chime doesn't eat into it).
  useListening.setState({ activatedAt: Date.now() });

  // Failsafe: if neither silence-end nor an explicit stop fires, force cancel.
  failsafeTimer = setTimeout(() => {
    if (myToken !== activationToken) return;
    logger.info(`failsafe timeout (${LISTENING_TIMEOUT_MS}ms) — cancelling capture`);
    void cancelCapture().catch(() => {});
  }, LISTENING_TIMEOUT_MS);

  // Start mic capture. Resolves with audio when silence detection fires,
  // or null if too little audio captured / explicitly cancelled.
  let capture;
  try {
    capture = await startCapture();
  } catch (err) {
    logger.error("startCapture failed:", err);
    clearFailsafe();
    if (myToken !== activationToken) return;
    useListening.setState({ state: "idle" });
    await finishProcessing(messages.generalError[getSettings().language]);
    return;
  }

  clearFailsafe();
  if (myToken !== activationToken) {
    logger.debug("capture finished but session was interrupted — dropping result");
    return;
  }

  if (!capture) {
    logger.info("no audio captured → didn't catch that");
    useListening.setState({ state: "idle" });
    await finishProcessing(messages.didntCatch[getSettings().language]);
    return;
  }

  logger.info(`captured ${capture.durationMs}ms of audio → STT`);
  useListening.setState({ state: "processing" });
  logActivity(`captured ${capture.durationMs}ms → STT`);

  // Got-it cue runs in parallel with the STT round-trip — feels responsive.
  void playCue("got-it").catch(() => {});

  // STT + normalize + intent all live under the same AbortController so an
  // interrupt at any point in the processing phase aborts the in-flight HTTP
  // call. Not nulled until the whole session finishes (or the catch fires).
  sttAbort = new AbortController();
  try {
    const result = await sttTranscribe(capture.audioBase64, getSettings().language, sttAbort.signal);
    if (myToken !== activationToken) return;

    const confidence = result.confidence ?? 1.0;
    const text = result.text?.trim() ?? "";
    if (text.length === 0) {
      logger.info("STT returned empty text");
      useListening.setState({ state: "idle" });
      await finishProcessing(messages.didntCatch[getSettings().language]);
      return;
    }
    logger.info(`STT: "${snippet(text)}" (lang=${result.languageCode}, conf=${confidence.toFixed(2)})`);
    logActivity(`STT: "${snippet(text)}"`);

    await processTranscription(text, confidence);
  } catch (err) {
    if (myToken !== activationToken) return; // we got interrupted
    if (err instanceof Error && err.message === "interrupted") return;
    logger.error("STT failed:", err);
    const lang = getSettings().language;
    const detail = err instanceof RelayError ? ` (HTTP ${err.status})` : "";
    logActivity(`STT failed${detail}`);
    useListening.setState({ state: "idle" });
    await finishProcessing(messages.generalError[lang]);
  } finally {
    if (myToken === activationToken) sttAbort = null;
  }
}

/** Speaks `reply` with echo guard, then drops back to idle. */
async function finishProcessing(reply: string): Promise<void> {
  useListening.setState({ state: "idle" });
  await speakWithEchoGuard(reply);
}

async function cancelInternal(withCue: boolean): Promise<void> {
  activationToken++;
  sttAbort?.abort();
  sttAbort = null;
  clearFailsafe();
  await cancelCapture().catch(() => {});
  useListening.setState({ state: "idle" });
  logActivity("listening cancelled");
  if (withCue) {
    try {
      await playCue("cancelled");
    } catch {}
  }
}

/**
 * speak() + TTS echo guard. Stores the spoken text as last-response for repeat.
 */
async function speakWithEchoGuard(text: string): Promise<void> {
  setLastResponse(text);
  useListening.setState({ speaking: true });
  try {
    await speak(text);
  } catch (err) {
    logger.warn(`speak failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setTimeout(() => {
      useListening.setState({ speaking: false });
      logger.debug("TTS echo guard lifted");
    }, TTS_ECHO_BUFFER_MS);
  }
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/** Clears state on logout / disconnect / app reset. */
export function reset(): void {
  activationToken++;
  sttAbort?.abort();
  sttAbort = null;
  clearFailsafe();
  void cancelCapture().catch(() => {});
  clearLastResponse();
  useListening.setState({ state: "idle", activatedAt: 0, speaking: false });
}
