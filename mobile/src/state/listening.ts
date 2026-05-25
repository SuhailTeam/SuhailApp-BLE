import { create } from "zustand";
import { playCue } from "../audio/cues";
import { speak } from "../audio/tts";
import { stopAll as stopAllAudio } from "../audio/playback";
import { cancelCapture, startCapture } from "../ble/mic";
import { transcribe as sttTranscribe } from "../relay/stt";
import { RelayError } from "../relay/client";
import { messages } from "../i18n/messages";
import { useActivity } from "./activity";
import { getLastResponse, setLastResponse, clearLastResponse } from "./lastResponse";
import { getSettings } from "./settings";
import { isValidTranscription } from "../utils/transcription-filter";
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
 * External entry point for transcribed text. Currently only called by tests
 * and by the internal STT pipeline below — Phase C slice 3+ will also use
 * it for the in-flight intent routing.
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

  // TODO Phase C slice 3: normalize via /api/normalize, then route via
  // /api/intent + dispatch to a command handler. For now we just echo.
  logger.info(`would route: "${snippet(text)}" (language=${language}) — stub`);
  logActivity(`heard: "${snippet(text)}" (routing not yet wired)`);
  const reply = language === "ar"
    ? `سمعتك تقول: ${text}`
    : `I heard you say: ${text}`;
  await finishProcessing(reply);
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

  // STT round-trip, abortable so an interrupt can cancel mid-flight.
  sttAbort = new AbortController();
  try {
    const result = await sttTranscribe(capture.audioBase64, getSettings().language, sttAbort.signal);
    if (myToken !== activationToken) return;
    sttAbort = null;

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
    sttAbort = null;
    if (err instanceof Error && err.message === "interrupted") return;
    logger.error("STT failed:", err);
    const lang = getSettings().language;
    const detail = err instanceof RelayError ? ` (HTTP ${err.status})` : "";
    logActivity(`STT failed${detail}`);
    useListening.setState({ state: "idle" });
    await finishProcessing(messages.generalError[lang]);
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
