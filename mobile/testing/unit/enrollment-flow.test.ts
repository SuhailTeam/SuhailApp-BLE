/**
 * Tier 1 unit — face-enrollment 2-step flow.
 * Fills: Table 13.9 (face-enrollment flow).
 * Case IDs: ST-E1 (E1,E2 → persisted), ST-E2 (E1,E3 timeout at 30 001 ms →
 *           discarded, BV-08), ST-E3 (E1,E4,E2 — TTS echo filtered as a
 *           self-loop, then the real name persisted; echo never persisted).
 *
 * This drives the REAL flow end to end: the listening machine's enrollment
 * intercept (listening.ts), the REAL enroll command (commands/enroll.ts) and
 * the REAL enrollment state (state/enrollment.ts). Only the persist call —
 * relay/faces.enrollFace — is stubbed (the spy `state.enrollFaceCalls`), which
 * is exactly the boundary instructions §4.4 says to assert on.
 *
 * The 30 s enrollment timeout and the 1.5 s TTS echo guard are both real
 * setTimeout-driven, so we use jest fake timers. We advance 1 500 ms between
 * step 1 and step 2 to clear the echo guard (in reality the user swipes again
 * after the prompt), then assert the persist boundary.
 */
import { test, expect, beforeEach, describe, jest } from "bun:test";
import { getHarness, state, resetState } from "../helpers/listening-harness";
import { flushMicrotasks } from "../helpers/async";

const harness = await getHarness();
const { L, enrollment } = harness;

beforeEach(() => {
  L.reset(); // clears any armed enrollment timer + pending state
  resetState();
  harness.setLanguage("en");
});

/**
 * Runs enrollment step 1 (route → executeEnrollStep1). When `clearEcho` is
 * true it also advances 1.5 s to drop the TTS echo guard so the next
 * transcription (the name) isn't rejected as self-echo — but that also burns
 * 1.5 s off the 30 s enrollment timer, so the boundary-timeout test passes
 * `clearEcho: false` to keep the timeline precise.
 */
async function runStep1(clearEcho = true): Promise<void> {
  state.classifyResult = { command: "face-enroll", params: undefined, rawText: "enroll this person" };
  await L.processTranscription("enroll this person", 0.95);
  await flushMicrotasks();
  if (clearEcho) {
    jest.advanceTimersByTime(1_500);
    await flushMicrotasks();
  }
}

describe("ST-E1: capture → name → persisted", () => {
  test("step 1 stashes a pending photo and prompts for the name", async () => {
    jest.useFakeTimers();
    try {
      await runStep1();
      expect(enrollment.hasPending()).toBe(true);
      expect(state.spoken.some((s) => s.includes("Please say the person's name"))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("step 2 with a real name persists via enrollFace and speaks success", async () => {
    jest.useFakeTimers();
    try {
      await runStep1();
      await L.processTranscription("Faisal", 0.95);
      await flushMicrotasks();
      expect(state.enrollFaceCalls).toEqual([{ name: "Faisal" }]);
      expect(state.spoken).toContain("Faisal has been enrolled successfully.");
      expect(enrollment.hasPending()).toBe(false); // consumed
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("ST-E2 / BV-08: 30 s enrollment timeout discards the pending photo", () => {
  test("at 29 999 ms still pending; crossing 30 000 ms discards + speaks timeout", async () => {
    jest.useFakeTimers();
    try {
      await runStep1(false); // keep the 30 s timer's clock untouched
      expect(enrollment.hasPending()).toBe(true);

      jest.advanceTimersByTime(29_999);
      await flushMicrotasks();
      expect(enrollment.hasPending()).toBe(true); // not yet

      jest.advanceTimersByTime(2); // → 30 001 ms total (timer fires at 30 000)
      await flushMicrotasks();
      expect(enrollment.hasPending()).toBe(false); // discarded
      expect(state.enrollFaceCalls.length).toBe(0); // nothing persisted
      expect(state.spoken.some((s) => s.includes("timed out"))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("ST-E3: TTS echo is filtered as a self-loop, then the real name persists", () => {
  test("an echo of the prompt is NOT persisted; the next real name is", async () => {
    jest.useFakeTimers();
    try {
      await runStep1();
      expect(enrollment.hasPending()).toBe(true);

      // E4: the mic picks up the app's own prompt. completeEnrollment matches
      // an ECHO_PATTERN ("please say" / "person's name" / "photo captured") and
      // returns null WITHOUT consuming the pending photo → still pending.
      await L.processTranscription("Photo captured. Please say the person's name.", 0.95);
      await flushMicrotasks();
      expect(state.enrollFaceCalls.length).toBe(0); // echo never persisted
      expect(enrollment.hasPending()).toBe(true);   // pending survives the echo

      // The intercept restarts the 30 s timeout and re-arms the echo guard;
      // clear the guard, then say the real name.
      jest.advanceTimersByTime(1_500);
      await flushMicrotasks();
      await L.processTranscription("Sara", 0.95);
      await flushMicrotasks();
      expect(state.enrollFaceCalls).toEqual([{ name: "Sara" }]);
      expect(state.spoken).toContain("Sara has been enrolled successfully.");
    } finally {
      jest.useRealTimers();
    }
  });
});
