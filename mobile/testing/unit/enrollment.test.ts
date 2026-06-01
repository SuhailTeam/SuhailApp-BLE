import { beforeEach, describe, expect, test } from "bun:test";
import {
  setPendingPhoto,
  getPendingPhoto,
  consumePendingPhoto,
  clearPending,
  hasPending,
  markProcessing,
  unmarkProcessing,
  interrupt,
  takeInterruptedFlag,
} from "../../src/state/enrollment";

// REAL face-enrollment state container (pure). Covers the two-step lock and
// interrupt suppression (ST-E1/E2/E3 control logic + regression: interrupted
// enrollment suppresses stale completion).

beforeEach(() => {
  // Reset module-level slot between tests.
  clearPending();
  unmarkProcessing();
  takeInterruptedFlag();
});

describe("pending photo lifecycle", () => {
  test("starts empty", () => {
    expect(hasPending()).toBe(false);
    expect(getPendingPhoto()).toBeNull();
  });

  test("set → hasPending true, get returns the token, consume clears it", () => {
    setPendingPhoto("tok-1");
    expect(hasPending()).toBe(true);
    expect(getPendingPhoto()).toBe("tok-1");
    expect(consumePendingPhoto()).toBe("tok-1");
    expect(getPendingPhoto()).toBeNull();
    expect(hasPending()).toBe(false);
  });
});

describe("processing lock (ST-E concurrency guard)", () => {
  test("markProcessing is a one-shot CAS lock", () => {
    setPendingPhoto("tok");
    expect(markProcessing()).toBe(true); // acquired
    expect(markProcessing()).toBe(false); // already held
    expect(hasPending()).toBe(false); // not "pending" while processing
    unmarkProcessing();
    expect(markProcessing()).toBe(true); // re-acquirable after release
  });
});

describe("interrupt suppression (ST-E3 / regression)", () => {
  test("interrupt with pending state → true, clears pending, raises the flag once", () => {
    setPendingPhoto("tok");
    expect(interrupt()).toBe(true);
    expect(getPendingPhoto()).toBeNull();
    expect(takeInterruptedFlag()).toBe(true); // a completion in flight would see this and discard
    expect(takeInterruptedFlag()).toBe(false); // one-shot read
  });

  test("interrupt with no state → false (nothing to suppress)", () => {
    expect(interrupt()).toBe(false);
  });

  test("setPendingPhoto clears a stale interrupt marker", () => {
    setPendingPhoto("old");
    interrupt(); // raises interrupted, clears pending
    setPendingPhoto("new"); // fresh enrollment supersedes
    expect(takeInterruptedFlag()).toBe(false);
    expect(getPendingPhoto()).toBe("new");
  });
});
