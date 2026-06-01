import { beforeEach, describe, expect, test } from "bun:test";
import {
  useUsabilityLog,
  buildUsabilityCsv,
  USABILITY_CSV_HEADER,
  type UsabilityRow,
} from "../../src/state/usabilityLog";
import { startTimeline, mark, tagTimeline, endTimeline } from "../../src/utils/timeline";

// Usability-test instrumentation (merged from the usability-instrumentation work):
// the uncapped session log, its CSV export, and the timeline → log integration
// that records the wake → first-spoken-word timing per command turn.

beforeEach(() => {
  useUsabilityLog.getState().clear();
  useUsabilityLog.getState().setActiveTask("");
});

describe("usability log store", () => {
  test("record stamps the active task label and accumulates uncapped", () => {
    useUsabilityLog.getState().setActiveTask("1 · scene-summarize");
    for (let i = 0; i < 25; i++) {
      useUsabilityLog.getState().record({ command: "scene-summarize", totalMs: 1000 });
    }
    const rows = useUsabilityLog.getState().rows;
    expect(rows).toHaveLength(25); // no 20-entry cap (unlike the Activity log)
    expect(rows.every((r) => r.taskLabel === "1 · scene-summarize")).toBe(true);
    expect(rows[0]?.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("clear empties the log (between participants)", () => {
    useUsabilityLog.getState().record({ command: "x", totalMs: 1 });
    useUsabilityLog.getState().clear();
    expect(useUsabilityLog.getState().rows).toHaveLength(0);
  });
});

describe("buildUsabilityCsv", () => {
  const rows: UsabilityRow[] = [
    {
      id: "1",
      iso: "2026-06-01T10:00:00.000Z",
      taskLabel: "1 · scene-summarize",
      command: "scene-summarize",
      timeToFirstWordMs: 1234,
      endUtteranceToFirstWordMs: 800,
      totalMs: 3000,
      transcript: "hello, world",
    },
    {
      id: "2",
      iso: "2026-06-01T10:01:00.000Z",
      taskLabel: "2 · ocr",
      command: "ocr-read-text",
      totalMs: 2500,
      // no timings / no transcript → empty cells, never "undefined"
    },
  ];

  test("first line is the canonical header", () => {
    expect(buildUsabilityCsv(rows).split("\n")[0]).toBe(USABILITY_CSV_HEADER.join(","));
  });

  test("converts ms → seconds and leaves missing values blank", () => {
    const line1 = buildUsabilityCsv(rows).split("\n")[1]!;
    expect(line1).toContain("1.23"); // 1234ms → 1.23s
    expect(line1).toContain("0.80"); // 800ms  → 0.80s
    expect(line1).toContain("3.00"); // 3000ms → 3.00s
    const line2 = buildUsabilityCsv(rows).split("\n")[2]!;
    expect(line2.split(",").filter((c) => c === "undefined")).toHaveLength(0);
  });

  test("RFC-4180 escapes a transcript containing a comma", () => {
    expect(buildUsabilityCsv(rows).split("\n")[1]).toContain('"hello, world"');
  });
});

describe("timeline → usability-log integration (wake → first spoken word)", () => {
  test("a tagged command turn records one row with the first-word timing", async () => {
    useUsabilityLog.getState().setActiveTask("1 · scene-summarize");
    startTimeline("cmd");
    mark("mic-capture-done");
    await new Promise((r) => setTimeout(r, 5));
    mark("tts-playback-start"); // the "glasses start speaking" moment
    tagTimeline({ command: "scene-summarize", transcript: "describe the room" });
    endTimeline();

    const rows = useUsabilityLog.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe("scene-summarize");
    expect(rows[0]?.taskLabel).toBe("1 · scene-summarize");
    expect(rows[0]?.timeToFirstWordMs).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.endUtteranceToFirstWordMs).toBeGreaterThanOrEqual(0);
    expect(typeof rows[0]?.totalMs).toBe("number");
  });

  test("an untagged timeline (repeat/cue speech) records no usability row", () => {
    startTimeline("cmd");
    mark("tts-playback-start");
    endTimeline(); // no tagTimeline → not a command turn
    expect(useUsabilityLog.getState().rows).toHaveLength(0);
  });
});
