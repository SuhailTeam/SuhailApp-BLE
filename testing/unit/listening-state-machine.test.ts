import { describe, expect, test } from "bun:test";
import {
  LISTENING_GRACE_MS,
  LISTENING_TIMEOUT_MS,
  shouldAcceptTranscriptionEvent,
  transitionListeningState,
} from "../../src/utils/listening-state-machine";

describe("ListeningStateMachine.transition (Section 13.2.3)", () => {
  test("covers ST-L1: idle -> active -> processing -> idle", () => {
    const active = transitionListeningState("idle", "wake");
    const processing = transitionListeningState(active, "transcription");
    const idle = transitionListeningState(processing, "processingDone");

    expect(active).toBe("active");
    expect(processing).toBe("processing");
    expect(idle).toBe("idle");
  });

  test("covers ST-L2: idle -> active -> idle on timeout", () => {
    const active = transitionListeningState("idle", "wake");
    const idle = transitionListeningState(active, "timeout");

    expect(active).toBe("active");
    expect(idle).toBe("idle");
  });

  test("invalid events leave the state unchanged", () => {
    expect(transitionListeningState("idle", "transcription")).toBe("idle");
    expect(transitionListeningState("processing", "timeout")).toBe("processing");
  });
});

describe("grace and echo event filters (Section 13.2.2)", () => {
  test("rejects transcriptions before the 1s grace boundary", () => {
    expect(shouldAcceptTranscriptionEvent({
      state: "active",
      elapsedSinceActivationMs: LISTENING_GRACE_MS - 1,
      isSpeaking: false,
      confidence: 1,
      minConfidence: 0.55,
    })).toBe(false);
  });

  test("accepts transcriptions on and after the grace boundary while active", () => {
    expect(shouldAcceptTranscriptionEvent({
      state: "active",
      elapsedSinceActivationMs: LISTENING_GRACE_MS,
      isSpeaking: false,
      confidence: 0.55,
      minConfidence: 0.55,
    })).toBe(true);
  });

  test("rejects TTS echo and post-timeout transcriptions", () => {
    expect(shouldAcceptTranscriptionEvent({
      state: "active",
      elapsedSinceActivationMs: LISTENING_GRACE_MS + 1,
      isSpeaking: true,
      confidence: 1,
      minConfidence: 0.55,
    })).toBe(false);

    expect(shouldAcceptTranscriptionEvent({
      state: "active",
      elapsedSinceActivationMs: LISTENING_TIMEOUT_MS + 1,
      isSpeaking: false,
      confidence: 1,
      minConfidence: 0.55,
    })).toBe(false);
  });
});
