import { create } from "zustand";
import { playCue } from "../audio/cues";
import { speak } from "../audio/tts";
import { stopAll as stopAllAudio } from "../audio/playback";
import { messages } from "../i18n/messages";
import { useActivity } from "./activity";
import { getLastResponse, setLastResponse, clearLastResponse } from "./lastResponse";
import { getSettings } from "./settings";
import { Logger } from "../utils/logger";

const logger = new Logger("Listening");

/* ── Constants — port from src/app.ts ────────────────────────────────────── */

/** How long the listening window stays open after activation. */
export const LISTENING_TIMEOUT_MS = 10_000;

/** Ignore transcriptions for this long after activation (stale audio). */
export const LISTENING_GRACE_MS = 1_000;

/**
 * TTS echo guard — keep "speaking" true for this long after audio finishes so
 * the mic doesn't pick up the tail of our own speech as a command.
 */
export const TTS_ECHO_BUFFER_MS = 1_500;

/** Minimum confidence to accept a transcription. */
export const MIN_CONFIDENCE = 0.55;

export type ListeningState = "idle" | "active" | "processing";

interface ListeningStore {
  state: ListeningState;
  /** Wall-clock ms when we entered "active" (used for the grace window). */
  activatedAt: number;
  /** True for the TTS echo guard window (during speech + buffer afterwards). */
  speaking: boolean;
}

const useListening = create<ListeningStore>(() => ({
  state: "idle",
  activatedAt: 0,
  speaking: false,
}));

/* ── Internal helpers ────────────────────────────────────────────────────── */

let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;

function clearTimer(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

function logActivity(event: string): void {
  useActivity.getState().log({ type: "system", command: "listening", event });
}

/* ── Public API — call these from button/swipe handlers ──────────────────── */

/**
 * Activates listening (forward swipe / left short press).
 * Behaviour mirrors src/app.ts `activateListening` exactly:
 *   - idle → active (play listening cue, start 10s timeout)
 *   - active → cancel (user changed their mind) + play cancelled cue
 *   - processing → silence in-flight TTS + cancel + immediately re-listen (no cue)
 */
export async function activate(): Promise<void> {
  const current = useListening.getState();

  if (current.state === "processing") {
    // "Shut up and listen again" — silence current TTS, no cue, just re-listen.
    logger.info("forward swipe during processing — interrupting");
    abortController?.abort();
    abortController = null;
    clearTimer();
    await stopAllAudio().catch(() => {});
    // Drop the echo guard now so the next transcription isn't dropped during
    // the 1500ms buffer the cancelled handler would otherwise schedule.
    useListening.setState({ speaking: false });
    logActivity("interrupted during processing → listening");
    await enterActive(/* withCue */ true);
    return;
  }

  if (current.state === "active") {
    // Already listening — user changed their mind. Cancel with feedback.
    logger.info("activate while active — cancelling");
    await cancelInternal(/* withCue */ true);
    return;
  }

  await enterActive(/* withCue */ true);
}

/**
 * Cancel + return to listening (left short press during active/processing).
 * Same as activate() except never plays the cancelled cue — the listening
 * chime is the user's confirmation that the interrupt worked.
 */
export async function interruptAndListen(): Promise<void> {
  logger.info("interrupt-and-listen (left short press)");
  abortController?.abort();
  abortController = null;
  clearTimer();
  await stopAllAudio().catch(() => {});
  useListening.setState({ speaking: false });
  logActivity("interrupted → listening");
  await enterActive(/* withCue */ true);
}

/**
 * Repeat the last spoken response (backward swipe / left long press).
 * Works from any state; if there's nothing to repeat, speaks the
 * `repeatNoHistory` bilingual message.
 */
export async function repeatLast(): Promise<void> {
  const text = getLastResponse();
  const language = getSettings().language;
  const toSay = text ?? messages.repeatNoHistory[language];
  logger.info(text ? `repeat: "${snippet(text)}"` : "repeat — no history");
  logActivity(text ? "repeat last response" : "repeat — no history");
  await speakWithEchoGuard(toSay);
}

/** Returns the current listening state (for non-React contexts). */
export function getListeningState(): ListeningState {
  return useListening.getState().state;
}

/** Hook for screens to react to state changes. */
export { useListening };

/** True during TTS playback + 1.5s buffer afterwards. */
export function isSpeaking(): boolean {
  return useListening.getState().speaking;
}

/* ── Stubs for the not-yet-wired pieces (Phase C slice 2+) ───────────────── */

/**
 * Phase C slice 2 entry point: called when a final transcription arrives from
 * STT. Performs filtering, normalization, intent routing, and command
 * dispatch — currently stubbed to just log + transition back to idle so the
 * state machine is exercise-able end-to-end before STT lands.
 */
export async function onTranscription(text: string, confidence: number): Promise<void> {
  const language = getSettings().language;

  // TTS echo guard
  if (useListening.getState().speaking) {
    logger.info(`ignored (TTS echo guard): "${snippet(text)}"`);
    return;
  }

  // Only process when we're actively listening
  const s = useListening.getState();
  if (s.state !== "active") {
    logger.info(`ignored (not listening): "${snippet(text)}"`);
    return;
  }

  // Grace period
  const elapsed = Date.now() - s.activatedAt;
  if (elapsed < LISTENING_GRACE_MS) {
    logger.info(`ignored (stale, ${elapsed}ms after activation): "${snippet(text)}"`);
    return;
  }

  // Confidence filter
  if (confidence < MIN_CONFIDENCE) {
    logger.info(`ignored (low confidence ${confidence.toFixed(2)}): "${snippet(text)}"`);
    return;
  }

  // TODO Phase C slice 2: isValidTranscription, normalize, routeIntent, dispatch.
  // For now we just acknowledge so the state machine is exercise-able.
  logger.info(`would route: "${snippet(text)}" (language=${language})`);
  logActivity(`heard: "${snippet(text)}" (routing not yet wired)`);

  clearTimer();
  abortController = new AbortController();
  useListening.setState({ state: "processing" });
  try {
    await playCue("got-it");
    await speakWithEchoGuard(language === "ar"
      ? `سمعتك تقول: ${text}`
      : `I heard you say: ${text}`);
  } finally {
    useListening.setState({ state: "idle" });
    abortController = null;
  }
}

/* ── Internals ───────────────────────────────────────────────────────────── */

async function enterActive(withCue: boolean): Promise<void> {
  clearTimer();
  useListening.setState({ state: "active", activatedAt: Date.now() });
  logActivity("listening active");

  if (withCue) {
    try {
      await playCue("listening");
    } catch (err) {
      // Cue failures are non-fatal — Phase B confirmed the speaker just works,
      // but we may interrupt our own cue if the user double-swipes.
      logger.debug(`listening cue failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reset activatedAt AFTER the cue so the grace window starts when the user
  // could plausibly start talking — not while the chime is still playing.
  if (useListening.getState().state === "active") {
    useListening.setState({ activatedAt: Date.now() });
  }

  // Schedule the timeout. If a transcription arrives first, onTranscription
  // clears this and transitions to "processing".
  timeoutHandle = setTimeout(async () => {
    if (useListening.getState().state !== "active") return;
    useListening.setState({ state: "idle" });
    logger.info("listening timed out");
    logActivity("listening timed out");
    await speakWithEchoGuard(messages.didntCatch[getSettings().language]);
  }, LISTENING_TIMEOUT_MS);
}

async function cancelInternal(withCue: boolean): Promise<void> {
  abortController?.abort();
  abortController = null;
  clearTimer();
  useListening.setState({ state: "idle" });
  logActivity("listening cancelled");
  if (withCue) {
    try {
      await playCue("cancelled");
    } catch {}
  }
}

/**
 * Wraps speak() with the TTS echo guard: set speaking=true before playback,
 * keep it true for TTS_ECHO_BUFFER_MS after playback finishes (regardless of
 * outcome), then clear. Also stores the spoken text as the last-response for
 * later repeat.
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
  clearTimer();
  abortController?.abort();
  abortController = null;
  clearLastResponse();
  useListening.setState({ state: "idle", activatedAt: 0, speaking: false });
}
