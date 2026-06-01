/**
 * Drives the REAL listening state machine (src/state/listening.ts) under test by
 * mocking its behavioural dependencies (audio, BLE, relay, command handlers,
 * settings) with controllable stubs. The state machine itself, the transcription
 * filter, the enrollment state, the activity store, and the timeline are all the
 * real modules.
 *
 * mock.module runs at import time (before the test dynamically imports listening),
 * so the mocks are in place when the module graph loads.
 */
import { mock } from "bun:test";

export interface ListeningMocks {
  language: "ar" | "en";
  capture: { audioBase64: string; durationMs: number } | null;
  stt: { text: string; confidence?: number; languageCode?: string };
  route: { command: string; params?: Record<string, string>; rawText: string };
  classifyError: Error | null;
  reply: string;
  speakCalls: string[];
  cues: string[];
  dispatched: string[];
  lastResponse: string | null;
  /** Texts passed to the mocked runStreamedAnswer (merged /api/answer path). */
  streamedCalls: string[];
  /** When set, the mocked runStreamedAnswer returns this instead of deriving an
   *  outcome from `route.command` — lets a test force fallback/aborted. */
  forceStreamOutcome:
    | { kind: "spoke"; fullText: string }
    | { kind: "dispatch"; command: string; params?: Record<string, string> }
    | { kind: "unknown" }
    | { kind: "aborted" }
    | { kind: "fallback" }
    | null;
}

/** Commands the merged endpoint streams; everything else is client-dispatched. */
const STREAMED = ["scene-summarize", "ocr-read-text", "visual-qa"];

export const mocks: ListeningMocks = {} as ListeningMocks;

export function resetMocks(): void {
  mocks.language = "en";
  mocks.capture = { audioBase64: "AAAA", durationMs: 1200 };
  mocks.stt = { text: "describe the room", confidence: 0.9 };
  mocks.route = { command: "scene-summarize", rawText: "describe the room" };
  mocks.classifyError = null;
  mocks.reply = "a tidy room";
  mocks.speakCalls = [];
  mocks.cues = [];
  mocks.dispatched = [];
  mocks.lastResponse = null;
  mocks.streamedCalls = [];
  mocks.forceStreamOutcome = null;
}
resetMocks();

mock.module("../../src/audio/tts", () => ({
  speak: async (t: string) => {
    mocks.speakCalls.push(t);
  },
}));
mock.module("../../src/audio/cues", () => ({
  playCue: async (n: string) => {
    mocks.cues.push(n);
  },
}));
mock.module("../../src/audio/playback", () => ({ stopAll: async () => {} }));
mock.module("../../src/audio/thinkingCue", () => ({
  startThinkingCue: async () => {
    mocks.cues.push("working");
  },
  stopThinkingCue: async () => {},
}));
// Merged streaming endpoint: derive an outcome from route.command (so most
// existing tests "just work") unless a test forces one via forceStreamOutcome.
mock.module("../../src/audio/streamingTts", () => ({
  runStreamedAnswer: async (opts: any) => {
    mocks.streamedCalls.push(opts.text);
    if (mocks.forceStreamOutcome) {
      const o = mocks.forceStreamOutcome;
      if (o.kind === "spoke") {
        opts.onRoute?.(mocks.route.command, "streamed");
        opts.onFirstChunkStart?.();
      }
      return o;
    }
    const cmd = mocks.route.command;
    if (STREAMED.includes(cmd)) {
      opts.onRoute?.(cmd, "streamed");
      opts.onFirstChunkStart?.();
      return { kind: "spoke", fullText: mocks.reply };
    }
    opts.onRoute?.(cmd, "client");
    if (cmd === "unknown") return { kind: "unknown" };
    return { kind: "dispatch", command: cmd, params: mocks.route.params };
  },
}));
mock.module("../../src/ble/mic", () => ({
  startCapture: async () => mocks.capture,
  cancelCapture: async () => {},
}));
mock.module("../../src/ble/camera", () => ({
  capturePhoto: async () => ({ photoToken: "t" }),
  resolvePhoto: async () => ({ photoToken: "t" }),
  GLASSES_DISCONNECTED_ERROR: "glasses-disconnected",
}));
mock.module("../../src/ble/connection", () => ({ onGlassesDisconnected: () => {} }));
mock.module("../../src/relay/stt", () => ({ transcribe: async () => mocks.stt }));
mock.module("../../src/relay/intent", () => ({
  classifyIntent: async () => {
    if (mocks.classifyError) throw mocks.classifyError;
    return mocks.route;
  },
}));
mock.module("../../src/relay/normalize", () => ({ normalize: async (t: string) => t }));
mock.module("../../src/relay/client", () => ({
  RelayError: class RelayError extends Error {
    status: number;
    constructor(m: string, s = 500) {
      super(m);
      this.status = s;
    }
  },
}));
mock.module("../../src/state/settings", () => ({
  getSettings: () => ({ language: mocks.language, speechSpeed: 1, volume: 1, voicePreset: "default" }),
}));
mock.module("../../src/state/lastResponse", () => ({
  getLastResponse: () => mocks.lastResponse,
  setLastResponse: (t: string) => {
    mocks.lastResponse = t;
  },
  clearLastResponse: () => {
    mocks.lastResponse = null;
  },
}));

const cmd = (file: string, fn: string) =>
  mock.module(`../../src/commands/${file}`, () => ({
    [fn]: async () => {
      mocks.dispatched.push(fn);
      return mocks.reply;
    },
  }));
cmd("describe", "executeDescribe");
cmd("read", "executeRead");
cmd("color", "executeColor");
cmd("find", "executeFind");
cmd("who", "executeWho");
cmd("vqa", "executeVqa");
cmd("money", "executeMoney");
mock.module("../../src/commands/enroll", () => ({
  executeEnrollStep1: async () => {
    mocks.dispatched.push("executeEnrollStep1");
    return mocks.reply;
  },
  completeEnrollment: async () => mocks.reply,
}));

let cached: typeof import("../../src/state/listening") | null = null;
export async function loadListening() {
  if (!cached) cached = await import("../../src/state/listening");
  return cached;
}

/** Polls until `pred()` is true or the timeout elapses. */
export async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
