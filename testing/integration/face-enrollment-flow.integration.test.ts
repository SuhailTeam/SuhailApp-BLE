import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPending,
  consumePendingPhoto,
  getPendingPhoto,
  hasPending,
  interrupt,
  markProcessing,
  setPendingPhoto,
  takeInterruptedFlag,
  unmarkProcessing,
} from "../../mobile/src/state/enrollment";

afterEach(() => {
  clearPending();
  unmarkProcessing();
  takeInterruptedFlag();
});

describe("face-enrollment two-step state integration", () => {
  test("step 1 stores a pending photo and step 2 consumes it exactly once", () => {
    setPendingPhoto("photo-token-1");

    expect(hasPending()).toBe(true);
    expect(getPendingPhoto()).toBe("photo-token-1");
    expect(consumePendingPhoto()).toBe("photo-token-1");
    expect(consumePendingPhoto()).toBeNull();
    expect(hasPending()).toBe(false);
  });

  test("processing lock prevents duplicate enrollment completion", () => {
    setPendingPhoto("photo-token-2");

    expect(markProcessing()).toBe(true);
    expect(hasPending()).toBe(false);
    expect(markProcessing()).toBe(false);

    unmarkProcessing();
    expect(markProcessing()).toBe(true);
  });

  test("timeout-style clear removes pending state without marking interruption", () => {
    setPendingPhoto("photo-token-3");

    clearPending();

    expect(hasPending()).toBe(false);
    expect(getPendingPhoto()).toBeNull();
    expect(takeInterruptedFlag()).toBe(false);
  });

  test("interrupt clears pending state and marks the in-flight result as suppressed", () => {
    setPendingPhoto("photo-token-4");

    expect(interrupt()).toBe(true);
    expect(hasPending()).toBe(false);
    expect(getPendingPhoto()).toBeNull();
    expect(takeInterruptedFlag()).toBe(true);
    expect(takeInterruptedFlag()).toBe(false);
  });
});
