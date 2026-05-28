/**
 * Tier 4 — pre-capture A/B analysis (GP2 §7, "defense-grade extra").
 *
 * Quantifies the pre-capture design decision: capturing the photo on swipe (in
 * parallel with STT+intent) vs forcing sequential capture. The mobile build
 * exposes DISABLE_PRECAPTURE=1 to force the sequential path; a human runs each
 * command N times with and without it on hardware, and the PerfLogger tags each
 * command.total span with meta.precaptureDisabled (true/false).
 *
 * This script reads those tagged spans from logs/perf/ and reports the
 * command.total delta. It computes nothing from thin air: with insufficient
 * tagged data it says so and exits 0.
 *
 * Run: bun run testing/perf/precapture_ab.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

interface SpanRecord { name: string; durationMs: number; meta?: Record<string, unknown> }

const ROOT = path.resolve(import.meta.dir, "../..");
const LOGS_DIR = path.join(ROOT, "logs", "perf");
const OUT = path.join(ROOT, "testing", "results", "precapture_ab.md");
const MIN_PER_ARM = 5;

function findJsonl(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findJsonl(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function write(md: string): void {
  console.log(md);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md + "\n");
}

function main(): void {
  const spans: SpanRecord[] = [];
  for (const f of findJsonl(LOGS_DIR)) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { spans.push(JSON.parse(t)); } catch { /* skip */ }
    }
  }

  const totals = spans.filter((s) => s.name === "command.total" && s.meta && "precaptureDisabled" in s.meta);
  const withPre = totals.filter((s) => s.meta!.precaptureDisabled === false).map((s) => s.durationMs);
  const without = totals.filter((s) => s.meta!.precaptureDisabled === true).map((s) => s.durationMs);

  if (withPre.length < MIN_PER_ARM || without.length < MIN_PER_ARM) {
    write([
      "## Tier 4 — Pre-capture A/B",
      "",
      `**needs measurement** — insufficient tagged trials (pre-capture on: ${withPre.length}, off: ${without.length}; need >= ${MIN_PER_ARM} per arm).`,
      "",
      "Collect on hardware: run trials normally, then again with `DISABLE_PRECAPTURE=1`",
      "in the mobile build. The PerfLogger tags each `command.total` with",
      "`meta.precaptureDisabled`. Copy `logs/perf/` here and re-run this script.",
      "",
    ].join("\n"));
    process.exit(0);
  }

  const mPre = median(withPre);
  const mWithout = median(without);
  write([
    "## Tier 4 — Pre-capture A/B",
    "",
    `- With pre-capture (parallel): median ${Math.round(mPre)} ms (N=${withPre.length})`,
    `- Without pre-capture (sequential): median ${Math.round(mWithout)} ms (N=${without.length})`,
    `- **Delta (sequential − parallel): ${Math.round(mWithout - mPre)} ms saved by pre-capture**`,
    "",
  ].join("\n"));
}

main();
