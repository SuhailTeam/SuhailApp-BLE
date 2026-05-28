/**
 * Tier 1 unit — ListeningStateMachine transitions.
 * Fills: Table 13.9 (ListeningStateMachine.transition) + listening rows of 13.11.
 * Case IDs: ST-L1 (idle→active→processing→idle; T1,T2,T4),
 *           ST-L2 (idle→active→idle on timeout; T1,T3).
 *
 * NOTE ON METHOD: the design doc describes a pure (state,event)→(state,effect)
 * function. The production code is NOT pure — it is a Zustand store driven by
 * imperative async functions (activate / processTranscription / the internal
 * runListenSession) with real side effects (cues, mic, STT, dispatch). Per the
 * "call production code, never reimplement it" rule we drive the REAL functions
 * with the adapter boundary stubbed (see listening-harness.ts) and assert both
 * the resulting state AND the emitted cue effect, which is the faithful
 * equivalent of (state,event)→(state,effect).
 *
 * DIVERGENCE (reported in §12 of the results doc): on active-window timeout the
 * mobile machine resolves the pending capture to null and speaks the
 * "didn't catch that" message — it does NOT emit a "cancelled" cue (the design
 * doc's ST-L2/BV-03 assume a cancelled cue; that path exists only on explicit
 * user cancel, tested in listening-grace-echo / active-timeout files).
 */
import { test, expect, beforeEach, describe } from "bun:test";
import { getHarness, state, resetState, dispatchedCommand } from "../helpers/listening-harness";
import { waitFor, tick } from "../helpers/async";

const harness = await getHarness();
const { L } = harness;

beforeEach(() => {
  resetState();
  L.reset();
  harness.setLanguage("ar"); // restore default after any per-test override
});

describe("ST-L1: idle → active → processing → idle", () => {
  test("T1: activate() from idle enters active and plays the listening cue", async () => {
    expect(L.getListeningState()).toBe("idle");
    await L.activate();
    // The synchronous part of runListenSession runs before the first await,
    // so state is already "active" when activate() returns.
    expect(L.getListeningState()).toBe("active");
    // Cue is played just after; let the awaited playCue resolve.
    await waitFor(() => state.cuesPlayed.includes("listening"));
    expect(state.cuesPlayed).toContain("listening");
  });

  test("T2+T4: captured audio drives active→processing (got-it cue) then →idle after dispatch", async () => {
    harness.setLanguage("en");
    state.classifyResult = { command: "scene-summarize", params: undefined, rawText: "describe" };
    state.sceneResult = { description: "You are facing a desk.", confidence: 0.9 };
    await L.activate();
    // The session runs to completion: STT → classify → dispatch → speak → idle.
    await waitFor(() => L.getListeningState() === "idle");
    // T2 effect: the got-it cue was emitted when entering processing.
    expect(state.cuesPlayed).toContain("got-it");
    // The routed command ran (hit vision/scene) and its reply was spoken (T4 → idle).
    expect(dispatchedCommand()).toBe("scene-summarize");
    expect(state.spoken).toContain("You are facing a desk.");
    expect(L.getListeningState()).toBe("idle");
  });
});

describe("ST-L2: idle → active → idle (no usable input)", () => {
  test("T3: a capture that yields no audio returns to idle with the didn't-catch message", async () => {
    // Model "no speech": startCapture resolves to null directly.
    state.sttCaptureResult = null;
    await L.activate();
    await waitFor(() => L.getListeningState() === "idle");
    expect(state.relayCalls.length).toBe(0);
    // didn't-catch message spoken; default language is Arabic.
    expect(state.spoken).toContain("لم أسمع، حاول مرة أخرى");
    expect(L.getListeningState()).toBe("idle");
  });
});

describe("activate() while already active cancels (re-entry guard)", () => {
  test("active + activate() → cancelled cue, returns to idle/listening", async () => {
    state.micMode = "manual"; // keep the session in 'active' (capture pending)
    await L.activate();
    await waitFor(() => state.cuesPlayed.includes("listening"));
    expect(L.getListeningState()).toBe("active");
    // Second activate while active → cancelInternal(withCue=true) → cancelled cue.
    await L.activate();
    await tick();
    expect(state.cuesPlayed).toContain("cancelled");
    expect(state.cancelCaptureCount).toBeGreaterThan(0);
    expect(L.getListeningState()).toBe("idle");
  });
});
