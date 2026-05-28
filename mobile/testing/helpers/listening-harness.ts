/**
 * Shared test harness for the mobile listening state machine
 * (mobile/src/state/listening.ts).
 *
 * WHY A SHARED HARNESS (and not per-file mocks):
 * Bun runs all *.test.ts in one process and caches modules. The first import
 * of listening.ts binds its collaborator imports; later `mock.module` calls in
 * a different file can't cleanly rebind an already-evaluated module. So every
 * listening test file imports THIS one harness, which registers a single fixed
 * set of mock factories. The factories read their behaviour from a mutable
 * `state` object, so each test controls outcomes by mutating `state` in a
 * beforeEach — not by re-mocking. Identical mock factories across files means
 * no cross-file contamination.
 *
 * WHAT IS MOCKED (the adapter boundary — instructions §1, "stub external
 * services"): audio (cues/tts/playback), BLE (mic/camera), and the relay HTTP
 * calls (stt/intent/normalize/vision/faces). We mock the RELAY layer, NOT the
 * per-feature command handlers — so the REAL command handlers run offline.
 * Routing is observed via `state.relayCalls` (which relay endpoint a handler
 * hit), which both keeps routing assertions about the decision AND lets the
 * standalone OCR-cap test reuse the same vision stub against the real
 * commands/read.ts (mocking the command modules would have shadowed it).
 *
 * WHAT IS REAL (the production logic under test): listening.ts, ALL 8 command
 * handlers (commands/*.ts), the enrollment state machine (state/enrollment.ts),
 * the transcription filter, bilingual messages, the activity + last-response
 * stores, and the settings store (MMKV stubbed by the preload). The enrollment
 * flow test drives the REAL 2-step logic and only the persist call
 * (relay/faces.enrollFace) is a spy — exactly what instructions §4.4 asks for.
 */
import { mock } from "bun:test";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../../src");

export interface CapturedPhotoLike {
  photoToken: string;
  requestId: string;
  uploadUrl: string;
  bytes: number;
}

export interface SttResultLike {
  text: string;
  confidence?: number;
  languageCode?: string;
}

export interface RouteResultLike {
  command: string;
  params?: Record<string, string>;
  rawText: string;
}

/** Mutable behaviour knobs + call spies, shared by every mock factory. */
export interface HarnessState {
  // ── camera / mic ──
  captureResult: CapturedPhotoLike;
  captureError: Error | null;
  /**
   * Mic capture behaviour:
   *  - "immediate": startCapture() resolves to `sttCaptureResult` right away
   *    (happy path — audio captured, used by routing/transition tests).
   *  - "manual": startCapture() stays pending until cancelCapture() is called
   *    (resolves it to null, modelling the real mic's silence/cancel contract).
   *    Used by the active-window-timeout test where the 10s failsafe fires
   *    cancelCapture() and the session then sees a null capture.
   */
  micMode: "immediate" | "manual";
  /** startCapture() resolves to this in "immediate" mode (null = "no audio"). */
  sttCaptureResult: { audioBase64: string; durationMs: number } | null;
  startCaptureError: Error | null;
  /** Internal: resolver for the pending "manual"-mode capture promise. */
  _micResolve: ((v: { audioBase64: string; durationMs: number } | null) => void) | null;

  // ── relay: stt / intent / normalize ──
  sttResult: SttResultLike;
  sttError: Error | null;
  /** classifyIntent: an object to return, or an Error to throw. */
  classifyResult: RouteResultLike;
  classifyError: Error | null;
  /** normalize() returns this (defaults to passing the input through). */
  normalizeImpl: (text: string) => string;

  // ── relay vision/face return values (real command handlers consume these) ──
  sceneResult: { description: string; confidence: number };
  ocrResult: { text: string };
  currencyResult: { bills: Array<{ denomination: number; count: number }>; total: number; currency: string; confidence: number };
  objectResult: { found: boolean; location: string; confidence: number };
  colorResult: { colorName: string; hex: string };
  vqaResult: { description: string; confidence: number };
  facesResult: { faces: Array<{ name: string | null; confidence: number; isKnown: boolean }>; totalDetected: number };
  /** If set, every relay vision/face call throws this (command-failure path). */
  relayError: Error | null;

  // ── relay: face enroll persist boundary (real enroll.ts calls this) ──
  enrollFaceResult: { faceId: string; name: string; enrolledAt: string } | null;
  enrollFaceError: Error | null;

  // ── spies ──
  cuesPlayed: string[];
  spoken: string[];
  /** Relay endpoints hit by the dispatched handler (e.g. "vision/scene"). The
   *  routed command is inferred from these (see dispatchedCommand()). */
  relayCalls: string[];
  startCaptureCount: number;
  cancelCaptureCount: number;
  stopAllAudioCount: number;
  enrollFaceCalls: Array<{ name: string }>;
}

function freshState(): HarnessState {
  return {
    captureResult: { photoToken: "tok-default", requestId: "tok-default", uploadUrl: "http://relay/upload/tok", bytes: 1234 },
    captureError: null,
    micMode: "immediate",
    sttCaptureResult: { audioBase64: "AAAA", durationMs: 1200 },
    startCaptureError: null,
    _micResolve: null,
    sttResult: { text: "describe my surroundings", confidence: 0.9, languageCode: "en-US" },
    sttError: null,
    classifyResult: { command: "scene-summarize", params: undefined, rawText: "describe my surroundings" },
    classifyError: null,
    normalizeImpl: (t: string) => t,
    sceneResult: { description: "a room with a desk in front of you", confidence: 0.9 },
    ocrResult: { text: "" },
    currencyResult: { bills: [], total: 0, currency: "UNKNOWN", confidence: 0.9 },
    objectResult: { found: false, location: "", confidence: 0.9 },
    colorResult: { colorName: "red", hex: "#ff0000" },
    vqaResult: { description: "yes", confidence: 0.9 },
    facesResult: { faces: [], totalDetected: 0 },
    relayError: null,
    enrollFaceResult: { faceId: "face-abc12345", name: "X", enrolledAt: "2026-01-01T00:00:00.000Z" },
    enrollFaceError: null,
    cuesPlayed: [],
    spoken: [],
    relayCalls: [],
    startCaptureCount: 0,
    cancelCaptureCount: 0,
    stopAllAudioCount: 0,
    enrollFaceCalls: [],
  };
}

export const state: HarnessState = freshState();

/** Reset all knobs + spies to defaults. Call in beforeEach. */
export function resetState(): void {
  Object.assign(state, freshState());
}

let registered = false;

function registerMocks(): void {
  if (registered) return;
  registered = true;

  // ── audio adapters ──
  mock.module(SRC + "/audio/cues.ts", () => ({
    playCue: async (type: string) => { state.cuesPlayed.push(type); },
  }));
  mock.module(SRC + "/audio/tts.ts", () => ({
    speak: async (text: string) => { state.spoken.push(text); },
  }));
  mock.module(SRC + "/audio/playback.ts", () => ({
    play: async () => {},
    stopAll: async () => { state.stopAllAudioCount++; },
  }));

  // ── BLE adapters ──
  mock.module(SRC + "/ble/mic.ts", () => ({
    startCapture: () => {
      state.startCaptureCount++;
      if (state.startCaptureError) return Promise.reject(state.startCaptureError);
      if (state.micMode === "manual") {
        return new Promise<{ audioBase64: string; durationMs: number } | null>((res) => {
          state._micResolve = res;
        });
      }
      return Promise.resolve(state.sttCaptureResult);
    },
    stopCapture: async () => {
      if (state._micResolve) { state._micResolve(state.sttCaptureResult); state._micResolve = null; }
      return state.sttCaptureResult;
    },
    cancelCapture: async () => {
      state.cancelCaptureCount++;
      // Mirror real mic.ts: a cancel resolves any pending capture to null.
      if (state._micResolve) { state._micResolve(null); state._micResolve = null; }
    },
    isCapturing: () => false,
  }));
  mock.module(SRC + "/ble/camera.ts", () => ({
    capturePhoto: async () => {
      if (state.captureError) throw state.captureError;
      return state.captureResult;
    },
    resolvePhoto: async () => {
      if (state.captureError) throw state.captureError;
      return state.captureResult;
    },
  }));

  // ── relay HTTP calls ──
  mock.module(SRC + "/relay/stt.ts", () => ({
    transcribe: async () => {
      if (state.sttError) throw state.sttError;
      return state.sttResult;
    },
  }));
  mock.module(SRC + "/relay/intent.ts", () => ({
    classifyIntent: async () => {
      if (state.classifyError) throw state.classifyError;
      return state.classifyResult;
    },
  }));
  mock.module(SRC + "/relay/normalize.ts", () => ({
    normalize: async (text: string) => state.normalizeImpl(text),
  }));

  // ── relay vision endpoints (real command handlers call these) ──
  const visionCall = <T>(endpoint: string, value: () => T) => {
    state.relayCalls.push(endpoint);
    if (state.relayError) throw state.relayError;
    return Promise.resolve(value());
  };
  mock.module(SRC + "/relay/vision.ts", () => ({
    describeScene: () => visionCall("vision/scene", () => state.sceneResult),
    ocr: () => visionCall("vision/ocr", () => state.ocrResult),
    recognizeCurrency: () => visionCall("vision/currency", () => state.currencyResult),
    detectObject: () => visionCall("vision/object", () => state.objectResult),
    detectColor: () => visionCall("vision/color", () => state.colorResult),
    answerVisualQuestion: () => visionCall("vision/vqa", () => state.vqaResult),
  }));

  // ── relay face endpoints. enrollFace is the persist boundary for the REAL
  //    enroll command (commands/enroll.ts); recognize-all feeds describe/who. ──
  mock.module(SRC + "/relay/faces.ts", () => ({
    recognizeFace: () => visionCall("faces/recognize", () => state.facesResult.faces[0] ?? { name: null, confidence: 0, isKnown: false }),
    recognizeAllFaces: () => visionCall("faces/recognize-all", () => state.facesResult),
    enrollFace: async (_arg: unknown, name: string) => {
      state.relayCalls.push("faces/enroll");
      state.enrollFaceCalls.push({ name });
      if (state.enrollFaceError) throw state.enrollFaceError;
      return state.enrollFaceResult;
    },
    listFaces: async () => ({ faces: [], count: 0 }),
  }));
}

/**
 * Infers the routed command from the relay endpoints the dispatched handler
 * hit. scene-summarize is the only one that calls vision/scene; face-recognize
 * calls recognize-all WITHOUT vision/scene; the rest map 1:1.
 */
export function dispatchedCommand(): string | null {
  const c = state.relayCalls;
  if (c.includes("vision/scene")) return "scene-summarize";
  if (c.includes("vision/ocr")) return "ocr-read-text";
  if (c.includes("vision/color")) return "color-detect";
  if (c.includes("vision/object")) return "find-object";
  if (c.includes("vision/currency")) return "currency-recognize";
  if (c.includes("vision/vqa")) return "visual-qa";
  if (c.includes("faces/enroll")) return "face-enroll";
  if (c.includes("faces/recognize-all")) return "face-recognize";
  return null;
}

export type ListeningModule = typeof import("../../src/state/listening");
export type EnrollmentModule = typeof import("../../src/state/enrollment");
export type SettingsModule = typeof import("../../src/state/settings");

export interface Harness {
  L: ListeningModule;
  enrollment: EnrollmentModule;
  settings: SettingsModule;
  /** Switch the global language used by listening.ts (settings store is real). */
  setLanguage(lang: "ar" | "en"): void;
}

let cached: Harness | null = null;

/**
 * Registers the mocks (once) and returns the real listening module plus the
 * real enrollment + settings stores. Idempotent across files.
 */
export async function getHarness(): Promise<Harness> {
  if (cached) return cached;
  registerMocks();
  const L = (await import(SRC + "/state/listening.ts")) as ListeningModule;
  const enrollment = (await import(SRC + "/state/enrollment.ts")) as EnrollmentModule;
  const settings = (await import(SRC + "/state/settings.ts")) as SettingsModule;
  cached = {
    L,
    enrollment,
    settings,
    setLanguage(lang) {
      settings.useSettings.getState().update({ language: lang });
    },
  };
  return cached;
}
