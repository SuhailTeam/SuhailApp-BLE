import { describe, expect, test } from "bun:test";
import { Timeline, startTimeline, mark, endTimeline, getTimeline } from "../../src/utils/timeline";

// REAL latency timeline (the instrumentation behind the measurement harness).

describe("Timeline class", () => {
  test("records marks and reports a non-negative total", () => {
    const tl = new Timeline("cmd");
    tl.mark("a");
    tl.mark("b");
    expect(tl.total()).toBeGreaterThanOrEqual(0);
  });

  test("dump() names the timeline and lists its marks", () => {
    const tl = new Timeline("session");
    tl.mark("stt-start");
    tl.mark("stt-done");
    const dump = tl.dump();
    expect(dump).toContain("Timeline [session]");
    expect(dump).toContain("stt-start");
    expect(dump).toContain("stt-done");
  });
});

describe("module-level timeline lifecycle", () => {
  test("startTimeline → mark → endTimeline runs without throwing; mark is a no-op when idle", () => {
    expect(() => mark("orphan-no-timeline")).not.toThrow();
    const tl = startTimeline("cmd");
    expect(getTimeline()).toBe(tl);
    mark("x");
    expect(() => endTimeline()).not.toThrow();
    expect(getTimeline()).toBeUndefined();
  });
});
