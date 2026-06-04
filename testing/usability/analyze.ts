/**
 * Usability analysis for the 5 blindfolded sessions (report Table 13.14 / Table 41).
 *
 *   bun run testing/usability/analyze.ts
 *
 * Reads every per-participant session CSV in testing/usability/sessions/ (the
 * uncapped one-row-per-turn log the app exports — see mobile/src/state/usabilityLog.ts)
 * and the SUS responses in testing/usability/sus/, then computes per-participant
 * and pooled-aggregate measures:
 *   - task-success rate (per command + overall),
 *   - time-to-first-spoken-word: median + IQR  ← the headline measure,
 *   - end-of-speech→first-word and total-turn medians,
 *   - recoveries per task = rows beyond the first for that task,
 *   - SUS: per participant + mean.
 *
 * Outputs the standalone testing/results/usability_table41.md and patches the
 * "## Table 13.14 — Usability" block of testing/results/section13_results.md.
 *
 * NEVER fabricates: empty / partial data yields needs-participants in the empty
 * cells and prints exactly which participant files are missing. run_all.ts imports
 * computeUsabilityMetrics + renderUsabilityTable so a full `bun run test:harness`
 * renders the same block from the same data.
 */
import { existsSync, readdirSync } from "node:fs";
import { parseCsv, decodeSession, type SessionRow } from "./csv";
import { decodeSus, scoreSus } from "./sus";
import { fiveStat, mean, type FiveStat } from "./stats";
import { replaceSection } from "./patch";

const ROOT = `${import.meta.dir}/../..`;
const EXPECTED_PARTICIPANTS = ["P1", "P2", "P3", "P4", "P5"];

// ─── Command identity (for derived task-success + per-command grouping) ──────

const COMMAND_SLUGS = [
  "scene-summarize",
  "ocr-read-text",
  "face-recognize",
  "face-enroll",
  "find-object",
  "currency-recognize",
  "visual-qa",
  "color-detect",
] as const;

const COMMAND_ALIASES: Record<string, string> = {
  scene: "scene-summarize",
  "scene-summarize": "scene-summarize",
  "scene summarization": "scene-summarize",
  describe: "scene-summarize",
  ocr: "ocr-read-text",
  "ocr-read-text": "ocr-read-text",
  read: "ocr-read-text",
  "read text": "ocr-read-text",
  face: "face-recognize",
  "face-recognize": "face-recognize",
  "face recognition": "face-recognize",
  who: "face-recognize",
  recognize: "face-recognize",
  enroll: "face-enroll",
  "face-enroll": "face-enroll",
  "face enrollment": "face-enroll",
  object: "find-object",
  "find-object": "find-object",
  "object finding": "find-object",
  find: "find-object",
  currency: "currency-recognize",
  "currency-recognize": "currency-recognize",
  "currency recognition": "currency-recognize",
  money: "currency-recognize",
  vqa: "visual-qa",
  "visual-qa": "visual-qa",
  "visual question answering": "visual-qa",
  color: "color-detect",
  colour: "color-detect",
  "color-detect": "color-detect",
  "color detection": "color-detect",
};

/** Parses the intended command from a moderator task label like "1 · scene-summarize". */
export function expectedCommandFromLabel(label: string): string | null {
  const m = label.match(/^\s*\d+\s*[·.:)\-]*\s*(.+?)\s*$/);
  const tail = (m && m[1] ? m[1] : label).trim().toLowerCase();
  if (COMMAND_ALIASES[tail]) return COMMAND_ALIASES[tail];
  for (const slug of COMMAND_SLUGS) {
    if (tail.includes(slug)) return slug;
  }
  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type SuccessSource = "moderator" | "derived" | "none";

export interface ParticipantUsability {
  id: string;
  turns: number;
  tasks: number; // distinct task instances
  timeToFirstWord: FiveStat | null;
  endToFirstWord: FiveStat | null;
  total: FiveStat | null;
  successRate: number | null;
  successSource: SuccessSource;
  recoveriesByTask: Record<string, number>;
  sus: number | null;
}

export interface UsabilityAggregate {
  turns: number;
  tasks: number;
  timeToFirstWord: FiveStat | null; // POOLED across participants — the headline
  endToFirstWord: FiveStat | null;
  total: FiveStat | null;
  successOverall: number | null;
  successByCommand: Record<string, number | null>;
  successSource: SuccessSource | "mixed";
  meanRecoveriesByCommand: Record<string, number>;
  totalByCommand: Record<string, FiveStat | null>; // per-command total_s (E2E latency proxy)
  sus: { mean: number | null; perParticipant: Record<string, number | null> };
}

export interface UsabilityMetrics {
  participantsExpected: string[];
  participantsFound: string[];
  participantsMissing: string[];
  susFound: string[];
  susMissing: string[];
  complete: boolean;
  aggregate: UsabilityAggregate | null;
  perParticipant: ParticipantUsability[];
}

interface Options {
  sessionsDir?: string;
  susDir?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nums(xs: (number | null)[]): number[] {
  return xs.filter((x): x is number => x !== null && Number.isFinite(x));
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return map;
}

function listParticipantFiles(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(dir)) return found;
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(P\d+)\.csv$/i);
    if (m && m[1]) found.set(m[1].toUpperCase(), `${dir}/${f}`);
  }
  return found;
}

interface TaskInstance {
  label: string;
  command: string | null; // intended command parsed from the label
  rows: SessionRow[];
}

/** Decides success of a task instance: moderator grade if present, else derived. */
function instanceSuccess(inst: TaskInstance, moderatorGraded: boolean): { gradable: boolean; success: boolean } {
  if (moderatorGraded) {
    const graded = inst.rows.filter((r) => r.success !== null);
    if (graded.length === 0) return { gradable: false, success: false };
    return { gradable: true, success: graded.some((r) => r.success === 1) };
  }
  // Derived: the intended command was eventually routed correctly.
  if (!inst.command) return { gradable: false, success: false };
  return { gradable: true, success: inst.rows.some((r) => r.command === inst.command) };
}

interface InstAgg {
  command: string | null;
  gradable: boolean;
  success: boolean;
  source: SuccessSource;
  recoveries: number;
  total: number | null;
}

// ─── Core computation ────────────────────────────────────────────────────────

export async function computeUsabilityMetrics(opts: Options = {}): Promise<UsabilityMetrics> {
  const sessionsDir = opts.sessionsDir ?? `${import.meta.dir}/sessions`;
  const susDir = opts.susDir ?? `${import.meta.dir}/sus`;

  const sessionFiles = listParticipantFiles(sessionsDir);
  const susFiles = listParticipantFiles(susDir);

  const participantsFound = [...sessionFiles.keys()].sort();
  const participantsMissing = EXPECTED_PARTICIPANTS.filter((p) => !sessionFiles.has(p));
  const susFound = [...susFiles.keys()].sort();
  const susMissing = EXPECTED_PARTICIPANTS.filter((p) => !susFiles.has(p));

  const perParticipant: ParticipantUsability[] = [];
  const poolTtfw: number[] = [];
  const poolEtfw: number[] = [];
  const poolTotal: number[] = [];
  const allInstances: InstAgg[] = [];

  for (const id of participantsFound) {
    const path = sessionFiles.get(id)!;
    const rows = decodeSession(parseCsv(await Bun.file(path).text()));

    const ttfw = nums(rows.map((r) => r.timeToFirstWordS));
    const etfw = nums(rows.map((r) => r.endUtteranceToFirstWordS));
    const tot = nums(rows.map((r) => r.totalS));
    poolTtfw.push(...ttfw);
    poolEtfw.push(...etfw);
    poolTotal.push(...tot);

    const moderatorGraded = rows.some((r) => r.success !== null);
    const byTask = groupBy(rows, (r) => r.task);

    const recoveriesByTask: Record<string, number> = {};
    let gradable = 0;
    let success = 0;
    for (const [label, taskRows] of byTask) {
      const inst: TaskInstance = { label, command: expectedCommandFromLabel(label), rows: taskRows };
      recoveriesByTask[label] = Math.max(0, taskRows.length - 1);
      const r = instanceSuccess(inst, moderatorGraded);
      if (r.gradable) {
        gradable += 1;
        if (r.success) success += 1;
      }
      const instTotals = nums(taskRows.map((x) => x.totalS));
      allInstances.push({
        command: inst.command,
        gradable: r.gradable,
        success: r.success,
        source: moderatorGraded ? "moderator" : inst.command ? "derived" : "none",
        recoveries: Math.max(0, taskRows.length - 1),
        total: instTotals.length ? avg(instTotals) : null,
      });
    }

    const susVals = susFiles.has(id) ? decodeSus(parseCsv(await Bun.file(susFiles.get(id)!).text())) : null;
    const sus = susVals ? scoreSus(susVals) : null;

    perParticipant.push({
      id,
      turns: rows.length,
      tasks: byTask.size,
      timeToFirstWord: fiveStat(ttfw),
      endToFirstWord: fiveStat(etfw),
      total: fiveStat(tot),
      successRate: gradable > 0 ? success / gradable : null,
      successSource: moderatorGraded ? "moderator" : gradable > 0 ? "derived" : "none",
      recoveriesByTask,
      sus,
    });
  }

  // SUS for participants who submitted a form but no session (still report it).
  const perParticipantSus: Record<string, number | null> = {};
  for (const id of EXPECTED_PARTICIPANTS) {
    const existing = perParticipant.find((p) => p.id === id);
    if (existing) {
      perParticipantSus[id] = existing.sus;
    } else if (susFiles.has(id)) {
      const vals = decodeSus(parseCsv(await Bun.file(susFiles.get(id)!).text()));
      perParticipantSus[id] = vals ? scoreSus(vals) : null;
    } else {
      perParticipantSus[id] = null;
    }
  }

  let aggregate: UsabilityAggregate | null = null;
  if (participantsFound.length > 0) {
    const gradableInst = allInstances.filter((i) => i.gradable);
    const successOverall = gradableInst.length > 0 ? gradableInst.filter((i) => i.success).length / gradableInst.length : null;

    const successByCommand: Record<string, number | null> = {};
    const meanRecoveriesByCommand: Record<string, number> = {};
    const totalByCommand: Record<string, FiveStat | null> = {};
    for (const slug of COMMAND_SLUGS) {
      const forCmd = allInstances.filter((i) => i.command === slug);
      const gradableForCmd = forCmd.filter((i) => i.gradable);
      successByCommand[slug] = gradableForCmd.length > 0 ? gradableForCmd.filter((i) => i.success).length / gradableForCmd.length : null;
      meanRecoveriesByCommand[slug] = forCmd.length > 0 ? avg(forCmd.map((i) => i.recoveries)) : 0;
      totalByCommand[slug] = fiveStat(nums(forCmd.map((i) => i.total)));
    }

    const sources = new Set(gradableInst.map((i) => i.source));
    const successSource: SuccessSource | "mixed" =
      sources.size === 0 ? "none" : sources.size > 1 ? "mixed" : ([...sources][0] as SuccessSource);

    const susScores = nums(EXPECTED_PARTICIPANTS.map((p) => perParticipantSus[p] ?? null));

    aggregate = {
      turns: perParticipant.reduce((a, p) => a + p.turns, 0),
      tasks: allInstances.length,
      timeToFirstWord: fiveStat(poolTtfw),
      endToFirstWord: fiveStat(poolEtfw),
      total: fiveStat(poolTotal),
      successOverall,
      successByCommand,
      successSource,
      meanRecoveriesByCommand,
      totalByCommand,
      sus: { mean: mean(susScores), perParticipant: perParticipantSus },
    };
  }

  return {
    participantsExpected: EXPECTED_PARTICIPANTS,
    participantsFound,
    participantsMissing,
    susFound,
    susMissing,
    complete: participantsMissing.length === 0 && susMissing.length === 0,
    aggregate,
    perParticipant,
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const NEEDS = "needs-participants (D)";
const fmtS = (x: number): string => `${x.toFixed(2)}s`;
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const fiveS = (s: FiveStat | null): string => (s ? `median ${fmtS(s.median)} · IQR ${fmtS(s.q1)}–${fmtS(s.q3)}` : NEEDS);
const medS = (s: FiveStat | null): string => (s ? fmtS(s.median) : NEEDS);

function completenessLine(m: UsabilityMetrics): string {
  const sess = `sessions ${m.participantsFound.length}/5${m.participantsMissing.length ? ` (missing ${m.participantsMissing.join(", ")})` : ""}`;
  const sus = `SUS ${m.susFound.length}/5${m.susMissing.length ? ` (missing ${m.susMissing.join(", ")})` : ""}`;
  const tag = m.complete ? "FINAL" : m.participantsFound.length === 0 ? "NO DATA" : "INTERIM — incomplete";
  return `Participants: ${sess} · ${sus} — ${tag}`;
}

/** Renders the "## Table 13.14 — Usability" body lines (heading added by the patcher / run_all). */
export function renderUsabilityTable(m: UsabilityMetrics): string[] {
  const a = m.aggregate;
  const lines: string[] = [completenessLine(m), ""];
  lines.push("| Measure | Value | n |");
  lines.push("|---|---|---|");
  if (!a) {
    lines.push(`| Task success rate (overall) | ${NEEDS} | — |`);
    lines.push(`| Time-to-first-spoken-word (median, IQR) | ${NEEDS} | — |`);
    lines.push(`| End-of-speech → first word (median) | ${NEEDS} | — |`);
    lines.push(`| Total turn (median) | ${NEEDS} | — |`);
    lines.push(`| Recoveries per task (mean) | ${NEEDS} | — |`);
    lines.push(`| SUS (mean, 0–100) | ${NEEDS} | — |`);
    lines.push("");
    return lines;
  }
  const recovAll = avg(COMMAND_SLUGS.map((s) => a.meanRecoveriesByCommand[s] ?? 0));
  lines.push(`| Task success rate (overall) | ${a.successOverall !== null ? `${pct(a.successOverall)} (${a.successSource})` : NEEDS} | ${a.tasks} tasks |`);
  lines.push(`| Time-to-first-spoken-word (median, IQR) | ${fiveS(a.timeToFirstWord)} | ${a.timeToFirstWord?.n ?? 0} turns |`);
  lines.push(`| End-of-speech → first word (median) | ${medS(a.endToFirstWord)} | ${a.endToFirstWord?.n ?? 0} |`);
  lines.push(`| Total turn (median) | ${medS(a.total)} | ${a.total?.n ?? 0} |`);
  lines.push(`| Recoveries per task (mean) | ${recovAll.toFixed(2)} | ${a.tasks} tasks |`);
  lines.push(`| SUS (mean, 0–100) | ${a.sus.mean !== null ? a.sus.mean.toFixed(1) : NEEDS} | ${m.susFound.length} |`);
  lines.push("");
  return lines;
}

/** Renders the standalone testing/results/usability_table41.md (report Table 41). */
export function renderUsabilityReport(m: UsabilityMetrics): string[] {
  const a = m.aggregate;
  const lines: string[] = [];
  lines.push("# Suhail — Usability results (Table 41 / Section 13.14)");
  lines.push("");
  lines.push("> Generated by `bun run testing/usability/analyze.ts` from the on-device session CSVs");
  lines.push("> (testing/usability/sessions/) and SUS forms (testing/usability/sus/). Empty cells are");
  lines.push("> needs-participants — never fabricated. Headline = pooled median + IQR of");
  lines.push("> time-to-first-spoken-word (inclusive / linear-interpolation quantiles).");
  lines.push("");
  lines.push(completenessLine(m));
  lines.push("");

  lines.push("## Aggregate");
  lines.push("");
  for (const l of renderUsabilityTable(m)) {
    if (l.startsWith("|") || l === "") lines.push(l);
  }

  lines.push("## Per command");
  lines.push("");
  lines.push("| Command | Task success | Mean recoveries | Total turn (median, on-device E2E latency) |");
  lines.push("|---|---|---|---|");
  for (const slug of COMMAND_SLUGS) {
    if (!a) {
      lines.push(`| ${slug} | ${NEEDS} | ${NEEDS} | needs-device |`);
    } else {
      const s = a.successByCommand[slug];
      lines.push(
        `| ${slug} | ${s !== null && s !== undefined ? pct(s) : NEEDS} | ${(a.meanRecoveriesByCommand[slug] ?? 0).toFixed(2)} | ${medS(a.totalByCommand[slug] ?? null)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Per participant");
  lines.push("");
  lines.push("| Participant | Turns | Tasks | Time-to-first-word (median) | Success | SUS |");
  lines.push("|---|---|---|---|---|---|");
  for (const id of m.participantsExpected) {
    const p = m.perParticipant.find((x) => x.id === id);
    if (!p) {
      const sus = a?.sus.perParticipant[id];
      lines.push(`| ${id} | ${NEEDS} | — | ${NEEDS} | ${NEEDS} | ${sus != null ? sus.toFixed(1) : NEEDS} |`);
    } else {
      lines.push(
        `| ${id} | ${p.turns} | ${p.tasks} | ${medS(p.timeToFirstWord)} | ${p.successRate !== null ? `${pct(p.successRate)} (${p.successSource})` : NEEDS} | ${p.sus != null ? p.sus.toFixed(1) : NEEDS} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Method notes");
  lines.push("");
  lines.push("- **Headline** (time-to-first-spoken-word) pools every valid turn across participants into one");
  lines.push("  sample for the median + IQR; per-participant medians are shown above as a consistency check.");
  lines.push("- **Quantiles**: inclusive / linear interpolation (Excel `QUARTILE.INC` == NumPy `linear` ==");
  lines.push("  Hyndman & Fan type 7), so a reader can reproduce them in a spreadsheet.");
  lines.push("- **Task success**: moderator `success` column when present, else derived (the intended command");
  lines.push("  for the task was eventually routed correctly); the source is shown in parentheses.");
  lines.push("- **Recoveries per task** = turns beyond the first for that task instance.");
  lines.push("- **SUS**: standard 10-item scoring, (Σ adjusted items) × 2.5 → 0–100; mean across participants.");
  lines.push("- Latency per command = the on-device `total_s` median (captured on Mentra Live); until device");
  lines.push("  CSVs are present these cells read needs-device / needs-participants.");
  lines.push("");
  return lines;
}

// ─── Standalone entry point ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const m = await computeUsabilityMetrics();

  console.log(completenessLine(m));
  if (m.participantsMissing.length) console.log(`Missing session files: ${m.participantsMissing.map((p) => `${p}.csv`).join(", ")}`);
  if (m.susMissing.length) console.log(`Missing SUS files: ${m.susMissing.map((p) => `${p}.csv`).join(", ")}`);

  const reportPath = `${ROOT}/testing/results/usability_table41.md`;
  await Bun.write(reportPath, renderUsabilityReport(m).join("\n") + "\n");
  console.log(`Wrote ${reportPath}`);

  const sectionPath = `${ROOT}/testing/results/section13_results.md`;
  if (await Bun.file(sectionPath).exists()) {
    const md = await Bun.file(sectionPath).text();
    await Bun.write(sectionPath, replaceSection(md, "Table 13.14 — Usability", renderUsabilityTable(m)));
    console.log(`Patched Table 13.14 in ${sectionPath}`);
  } else {
    console.log("section13_results.md not found — run `bun run test:harness` first (wrote usability_table41.md only).");
  }
}

if (import.meta.main) main();
