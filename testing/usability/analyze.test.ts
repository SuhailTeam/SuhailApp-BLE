import { describe, expect, test } from "bun:test";
import {
  computeUsabilityMetrics,
  renderUsabilityTable,
  expectedCommandFromLabel,
} from "./analyze";

const FIX = `${import.meta.dir}/./__fixtures__`;

describe("expectedCommandFromLabel", () => {
  test("parses the moderator label format", () => {
    expect(expectedCommandFromLabel("1 · scene-summarize")).toBe("scene-summarize");
    expect(expectedCommandFromLabel("2 · ocr")).toBe("ocr-read-text");
    expect(expectedCommandFromLabel("3 · money")).toBe("currency-recognize");
    expect(expectedCommandFromLabel("8 · who")).toBe("face-recognize");
  });
  test("returns null for an unparseable label", () => {
    expect(expectedCommandFromLabel("warm-up chatter")).toBeNull();
  });
});

describe("computeUsabilityMetrics — empty data → needs-participants", () => {
  test("no sessions dir yields a null aggregate and all participants missing", async () => {
    const m = await computeUsabilityMetrics({ sessionsDir: `${FIX}/none`, susDir: `${FIX}/none` });
    expect(m.aggregate).toBeNull();
    expect(m.participantsFound).toEqual([]);
    expect(m.participantsMissing).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(m.complete).toBe(false);
    // the rendered table is entirely needs-participants
    const table = renderUsabilityTable(m).join("\n");
    expect(table).toContain("needs-participants");
    expect(table).not.toMatch(/\d+%/); // no fabricated percentages
  });
});

describe("computeUsabilityMetrics — moderator-graded fixtures (P1, P2)", () => {
  test("pooled headline + per-command success match hand-computed values", async () => {
    const m = await computeUsabilityMetrics({ sessionsDir: `${FIX}/sessions`, susDir: `${FIX}/sus` });

    expect(m.participantsFound).toEqual(["P1", "P2"]);
    expect(m.participantsMissing).toEqual(["P3", "P4", "P5"]);
    expect(m.complete).toBe(false); // interim — only 2 of 5

    const a = m.aggregate!;
    // pooled time-to-first-word = [3, 3.5, 4, 2, 5] → median 3.5, IQR 3..4
    expect(a.timeToFirstWord).toEqual({ n: 5, q1: 3, median: 3.5, q3: 4, iqr: 1 });
    // 4 task instances, 3 succeed → 75%
    expect(a.successOverall).toBe(0.75);
    expect(a.successSource).toBe("moderator");
    expect(a.successByCommand["scene-summarize"]).toBe(1); // both succeed
    expect(a.successByCommand["ocr-read-text"]).toBe(0.5); // 1 of 2
    expect(a.meanRecoveriesByCommand["scene-summarize"]).toBe(0.5); // (1 + 0) / 2
    expect(a.sus.mean).toBe(87.5); // (75 + 100) / 2
  });

  test("per-participant breakdown", async () => {
    const m = await computeUsabilityMetrics({ sessionsDir: `${FIX}/sessions`, susDir: `${FIX}/sus` });
    const p1 = m.perParticipant.find((p) => p.id === "P1")!;
    expect(p1.turns).toBe(3);
    expect(p1.tasks).toBe(2);
    expect(p1.successRate).toBe(0.5); // scene ok, ocr fail
    expect(p1.recoveriesByTask["1 · scene-summarize"]).toBe(1); // 2 rows → 1 recovery
    expect(p1.sus).toBe(75);
    const p2 = m.perParticipant.find((p) => p.id === "P2")!;
    expect(p2.successRate).toBe(1);
    expect(p2.sus).toBe(100);
  });
});

describe("computeUsabilityMetrics — derived success (no moderator column)", () => {
  test("falls back to intended-command-was-routed", async () => {
    const m = await computeUsabilityMetrics({ sessionsDir: `${FIX}/derived/sessions`, susDir: `${FIX}/none` });
    const p3 = m.perParticipant.find((p) => p.id === "P3")!;
    expect(p3.successSource).toBe("derived");
    expect(p3.successRate).toBe(0.5); // scene routed correctly, ocr mis-routed to visual-qa
    expect(m.aggregate!.successSource).toBe("derived");
  });
});
