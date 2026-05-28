/**
 * Tier 4 instrumentation — PerfLogger regression test.
 * Fills: (verification gate) instrumentation times the RIGHT boundary.
 *
 * The GP2 acceptance check (instructions §7, §11) requires proving the
 * instrumentation wraps the AWAITED call: a mock that sleeps 500 ms must record
 * 480–600 ms, and a "network" span must show a realistic duration, never the
 * ~15 ms of code that forgot to await. We assert exactly that against the REAL
 * PerfLogger.span() boundary, with a deterministic injected clock for the exact
 * cases and a real 500 ms sleep for the headline regression.
 */
import { test, expect, describe } from "bun:test";
import { PerfLogger, type SpanRecord } from "../../src/perf/perf-logger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("500 ms regression: span() records the real awaited duration", () => {
  test("a 500 ms async op is recorded in [480, 600] ms", async () => {
    const records: SpanRecord[] = [];
    const perf = new PerfLogger("sess-1", { enabled: true, sink: (r) => records.push(r) });
    perf.beginCommand();
    await perf.span("vision.llm_call", async () => { await sleep(500); return "ok"; });
    expect(records).toHaveLength(1);
    const d = records[0]!.durationMs;
    expect(d).toBeGreaterThanOrEqual(480);
    expect(d).toBeLessThanOrEqual(600);
  });

  test("the span's return value is passed through unchanged", async () => {
    const perf = new PerfLogger("sess-1", { enabled: true });
    const out = await perf.span("relay.request", async () => 42);
    expect(out).toBe(42);
  });
});

describe("deterministic clock: span brackets start-before / end-after", () => {
  test("recorded duration equals (clock at end) - (clock at start)", async () => {
    let t = 1000;
    const records: SpanRecord[] = [];
    // now() advances 137 ms across the awaited call.
    const perf = new PerfLogger("sess-2", {
      enabled: true,
      now: () => t,
      sink: (r) => records.push(r),
    });
    await perf.span("face.search", async () => { await Promise.resolve(); t += 137; }, { faceIndex: 2 });
    expect(records[0]!.durationMs).toBe(137);
    expect(records[0]!.meta).toEqual({ faceIndex: 2 });
  });

  test("a 'network' span must not look instant (guards against not awaiting)", async () => {
    const records: SpanRecord[] = [];
    const perf = new PerfLogger("sess-3", { enabled: true, sink: (r) => records.push(r) });
    await perf.span("relay.request", async () => { await sleep(120); }, { command: "scene-summarize" });
    expect(records[0]!.durationMs).toBeGreaterThanOrEqual(100); // realistic, not ~15 ms
  });
});

describe("marks, command sequencing, and the disabled no-op path", () => {
  test("mark() records a point-in-time event (duration 0)", () => {
    const records: SpanRecord[] = [];
    const perf = new PerfLogger("s", { enabled: true, sink: (r) => records.push(r) });
    perf.beginCommand();
    perf.mark("transcription.received", { text: "describe" });
    expect(records[0]!.durationMs).toBe(0);
    expect(records[0]!.name).toBe("transcription.received");
  });

  test("commandSeq increments (cold = 1, warm > 1)", () => {
    const perf = new PerfLogger("s", { enabled: true });
    expect(perf.beginCommand()).toBe(1);
    expect(perf.beginCommand()).toBe(2);
  });

  test("disabled logger records nothing but still runs the work", async () => {
    const records: SpanRecord[] = [];
    const perf = new PerfLogger("s", { enabled: false, sink: (r) => records.push(r) });
    const out = await perf.span("handler.process", async () => "done");
    perf.mark("cue.play");
    expect(out).toBe("done");
    expect(records).toHaveLength(0);
    expect(perf.isEnabled()).toBe(false);
  });

  test("toJSONL emits one line per span", async () => {
    const perf = new PerfLogger("s", { enabled: true });
    perf.beginCommand();
    await perf.span("cue.play", async () => {});
    await perf.span("command.total", async () => {});
    const lines = perf.toJSONL().trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).session).toBe("s");
  });
});
