/**
 * Tier 1 unit — grace window + TTS echo guard.
 * Fills: Table 13.9 (grace/echo filters) + Table 13.11 (grace + echo rejection).
 * Case IDs: ST-G1 / BV-04 (1 s grace boundary 999/1000/1001),
 *           ST-G2 / BV-07 (1.5 s echo buffer boundary 1499/1500/1501).
 *
 * IMPORTANT DIVERGENCE (reported in §12 of the results doc):
 *  - The 1 s GRACE window (BV-04) is NOT enforced in the mobile build. The
 *    cloud app rejects stale transcriptions inside the grace window via a
 *    Date.now()-activatedAt comparison (src/app.ts:415-416). The mobile app
 *    sets `activatedAt` (listening.ts:473,494) but never reads it: the BLE app
 *    captures a whole utterance then transcribes once (batch), so there is no
 *    streaming-transcription stream to grace-reject. LISTENING_GRACE_MS is
 *    therefore vestigial in mobile. We assert the constant's value and the
 *    actual (no-grace) behaviour, and mark the BV-04 cell "not implemented in
 *    mobile build — enforced in cloud src/app.ts (not unit-testable without a
 *    MentraOS session)".
 *  - The 1.5 s ECHO guard (BV-07) IS implemented, via the `speaking` flag set
 *    during TTS + a TTS_ECHO_BUFFER_MS timer. We test it for real.
 */
import { test, expect, beforeEach, describe, jest } from "bun:test";
import { getHarness, state, resetState, dispatchedCommand } from "../helpers/listening-harness";

const harness = await getHarness();
const { L } = harness;

beforeEach(() => {
  resetState();
  L.reset();
  harness.setLanguage("en");
});

describe("BV-04 / ST-G1: 1 s grace window (mobile divergence — not enforced)", () => {
  test("the constant is 1000 ms (kept in sync with the cloud spec)", () => {
    expect(L.LISTENING_GRACE_MS).toBe(1_000);
  });

  test("a transcription is NOT grace-rejected in mobile (no activatedAt gate)", async () => {
    // In the cloud build this would be rejected if it arrived <1000 ms after
    // activation. The mobile build has no such gate, so a valid transcription
    // is processed regardless of elapsed time since activation.
    state.classifyResult = { command: "color-detect", params: undefined, rawText: "what color" };
    await L.processTranscription("what color is this", 0.9);
    expect(dispatchedCommand()).toBe("color-detect");
  });
});

describe("BV-07 / ST-G2: 1.5 s TTS echo guard (implemented)", () => {
  test("the buffer constant is 1500 ms", () => {
    expect(L.TTS_ECHO_BUFFER_MS).toBe(1_500);
  });

  test("a transcription overlapping active TTS is rejected (speaking flag set)", async () => {
    jest.useFakeTimers();
    try {
      // repeatLast() speaks via speakWithEchoGuard → sets speaking=true and
      // arms the 1.5 s buffer timer. We do NOT advance the timer, so the guard
      // is still up.
      await L.repeatLast(); // speaks repeatNoHistory (no prior response)
      expect(L.isSpeaking()).toBe(true);
      const spokenBefore = state.spoken.length;

      // A transcription arriving now is the app hearing its own TTS — rejected.
      state.classifyResult = { command: "scene-summarize", params: undefined, rawText: "x" };
      await L.processTranscription("describe my surroundings", 0.95);
      expect(state.relayCalls.length).toBe(0);
      expect(state.spoken.length).toBe(spokenBefore); // nothing new spoken
    } finally {
      jest.useRealTimers();
    }
  });

  test("boundary: speaking stays true at 1499 ms, clears at 1500 ms", async () => {
    jest.useFakeTimers();
    try {
      await L.repeatLast();
      expect(L.isSpeaking()).toBe(true);
      jest.advanceTimersByTime(1_499);
      expect(L.isSpeaking()).toBe(true); // 1499 ms — still inside the buffer
      jest.advanceTimersByTime(1); // → 1500 ms total — timer fires (>= 1500)
      expect(L.isSpeaking()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("after the buffer clears, a transcription is accepted again", async () => {
    jest.useFakeTimers();
    try {
      await L.repeatLast();
      jest.advanceTimersByTime(1_501); // past the echo buffer
      expect(L.isSpeaking()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
    state.classifyResult = { command: "find-object", params: { objectName: "keys" }, rawText: "find my keys" };
    await L.processTranscription("find my keys", 0.9);
    expect(dispatchedCommand()).toBe("find-object");
  });
});
