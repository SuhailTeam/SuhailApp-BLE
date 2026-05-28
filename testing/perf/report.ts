/**
 * Tier 4 — perf aggregation report (GP2 §7).
 *
 * Reads the JSONL spans emitted on-device by mobile/src/perf/PerfLogger
 * (logs/perf/<date>/<sessionId>-<epoch>.jsonl) and aggregates per command and
 * per stage. Produces median / p95 / p99 / N, a cold-vs-warm split, and a
 * wall-time-share vs raw-compute-time breakdown. Rows with N < 10 are GATED as
 * "insufficient data (N=x, need >=10)" — never reported as a real number.
 *
 * NO numbers are invented: if there are no logs, it prints how to collect them
 * and exits 0 (latency cells stay "needs measurement" in the results doc).
 *
 * Run: bun run testing/perf/report.ts   (after copying device logs into logs/perf/)
 */
import * as fs from "node:fs";
import * as path from "node:path";

interface SpanRecord {
  session: string;
  commandSeq: number;
  name: string;
  start: number;
  end: number;
  durationMs: number;
  meta?: Record<string, unknown>;
}

const ROOT = path.resolve(import.meta.dir, "../..");
const LOGS_DIR = path.join(ROOT, "logs", "perf");
const OUT_DIR = path.join(ROOT, "testing", "results");
const MIN_N = 10;

function findJsonl(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonl(p));
    else if (entry.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function loadSpans(): SpanRecord[] {
  const spans: SpanRecord[] = [];
  for (const file of findJsonl(LOGS_DIR)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        spans.push(JSON.parse(t) as SpanRecord);
      } catch {
        /* skip malformed line */
      }
    }
  }
  return spans;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

interface Stat { n: number; median: number; p95: number; p99: number; gated: boolean }
function stat(values: number[]): Stat {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    gated: s.length < MIN_N,
  };
}

function fmt(stat: Stat): string {
  if (stat.gated) return `insufficient data (N=${stat.n}, need >=${MIN_N})`;
  return `median ${Math.round(stat.median)} ms · p95 ${Math.round(stat.p95)} ms · p99 ${Math.round(stat.p99)} ms · N=${stat.n}`;
}

function main(): void {
  const spans = loadSpans();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (spans.length === 0) {
    const msg = [
      "## Tier 4 — Latency (perf instrumentation)",
      "",
      "**needs measurement** — no perf logs found in `logs/perf/`.",
      "",
      "These numbers are produced by a human-run hardware trial: enable",
      "`EXPO_PUBLIC_PERF_LOGGING=1` in the mobile build, run each command on real",
      "Mentra Live glasses, copy the on-device `logs/perf/<date>/*.jsonl` into this",
      "repo's `logs/perf/`, then re-run `bun run testing/perf/report.ts`.",
      "See `testing/perf/README.md`.",
      "",
    ].join("\n");
    console.log(msg);
    fs.writeFileSync(path.join(OUT_DIR, "perf_report.md"), msg + "\n");
    process.exit(0);
  }

  // command.total spans carry meta.command — group commands by it.
  const totals = spans.filter((s) => s.name === "command.total");
  const byCommand = new Map<string, SpanRecord[]>();
  for (const s of totals) {
    const cmd = (s.meta?.command as string) ?? "unknown";
    (byCommand.get(cmd) ?? byCommand.set(cmd, []).get(cmd)!).push(s);
  }

  const lines: string[] = ["## Tier 4 — Latency (perf instrumentation)", ""];

  lines.push("### Per command — end-to-end (command.total)");
  lines.push("");
  lines.push("| Command | Cold (seq=1) | Warm (seq>1) | All |");
  lines.push("|---|---|---|---|");
  for (const [cmd, recs] of byCommand) {
    const cold = recs.filter((r) => r.commandSeq === 1).map((r) => r.durationMs);
    const warm = recs.filter((r) => r.commandSeq > 1).map((r) => r.durationMs);
    const all = recs.map((r) => r.durationMs);
    lines.push(`| ${cmd} | ${fmt(stat(cold))} | ${fmt(stat(warm))} | ${fmt(stat(all))} |`);
  }
  lines.push("");

  // Per-stage stats across all commands.
  const byStage = new Map<string, number[]>();
  for (const s of spans) {
    if (s.name === "command.total") continue;
    (byStage.get(s.name) ?? byStage.set(s.name, []).get(s.name)!).push(s.durationMs);
  }
  lines.push("### Per stage (all commands)");
  lines.push("");
  lines.push("| Stage | Stats |");
  lines.push("|---|---|");
  for (const [stage, vals] of byStage) {
    lines.push(`| ${stage} | ${fmt(stat(vals))} |`);
  }
  lines.push("");

  // Wall-time share vs raw compute. On the critical path the stage wall times
  // sum to command.total (100%); raw compute can exceed wall time because
  // precapture + multi-face searches run in parallel. We report both and never
  // let the wall share silently exceed 100%.
  const totalWall = totals.reduce((a, r) => a + r.durationMs, 0);
  const rawCompute = spans.filter((s) => s.name !== "command.total").reduce((a, r) => a + r.durationMs, 0);
  lines.push("### Wall-time vs raw compute");
  lines.push("");
  lines.push(`- Sum of command.total (wall, critical path): ${Math.round(totalWall)} ms`);
  lines.push(`- Sum of all stage durations (raw compute, parallelism included): ${Math.round(rawCompute)} ms`);
  if (totalWall > 0) {
    const ratio = rawCompute / totalWall;
    lines.push(`- Raw/wall ratio: ${ratio.toFixed(2)}× ${ratio > 1 ? "(parallelism win — compute exceeds wall)" : ""}`);
  }
  lines.push("");
  lines.push(`_Spans analysed: ${spans.length} across ${new Set(spans.map((s) => s.session)).size} session(s)._`);
  lines.push("");

  const md = lines.join("\n");
  console.log(md);
  fs.writeFileSync(path.join(OUT_DIR, "perf_report.md"), md + "\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "perf_report.json"),
    JSON.stringify({ generatedFrom: spans.length, commands: [...byCommand.keys()] }, null, 2),
  );
}

main();
