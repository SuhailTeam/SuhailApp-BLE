/**
 * Tier 3a — Intent Classifier Accuracy Harness
 *
 * Runs the REAL production router (src/commands/command-router.ts) over an
 * author-curated labelled test set + an out-of-domain (OOD) set, N times, and
 * computes accuracy / per-intent precision-recall-F1 / OOD rejection / confusion
 * matrices. Numbers are COMPUTED AT RUNTIME — nothing here is hard-coded.
 *
 * Requires OPENROUTER_API_KEY + network (the router calls OpenRouter). With no
 * key set, the harness prints a clear message and exits 0 without writing fake
 * numbers.
 *
 * Run:
 *   OPENROUTER_API_KEY=... bun run testing/intent/run.ts
 *   RUNS=10 OPENROUTER_API_KEY=... bun run testing/intent/run.ts
 *
 * MEASUREMENT LIMITATION (documented, not faked):
 *   routeCommand() returns only { command, params, rawText }. It does NOT expose
 *   whether the LLM path or the keyword-fallback path produced the result.
 *   Therefore "LLM-path accuracy" and "fallback rate" CANNOT be measured from the
 *   return value alone, and this harness does not report them. Only overall
 *   accuracy, per-intent precision/recall/F1, and OOD rejection are reported.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeCommand } from "../../src/commands/command-router";

// ─── Label space ────────────────────────────────────────────────────────────

/** The 9 strings routeCommand can return for `command` (8 commands + unknown). */
const ALL_LABELS = [
  "scene-summarize",
  "ocr-read-text",
  "face-recognize",
  "face-enroll",
  "find-object",
  "currency-recognize",
  "color-detect",
  "visual-qa",
  "unknown",
] as const;
type Label = (typeof ALL_LABELS)[number];

/** The 8 non-unknown intents an in-domain item can be labelled with. */
const INTENT_LABELS = ALL_LABELS.filter((l) => l !== "unknown") as Label[];

type Lang = "en" | "ar";

interface TestItem {
  utterance: string;
  language: Lang;
  expected_intent: Label;
  acceptable_intents: Label[];
  source: string;
}

interface OodItem {
  utterance: string;
  language: Lang;
  source: string;
}

// ─── IO helpers ───────────────────────────────────────────────────────────────

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text();
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    out.push(JSON.parse(t) as T);
  }
  return out;
}

// ─── Stats helpers ─────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

// ─── Per-intent P/R/F1 from a confusion matrix ──────────────────────────────────
//
// matrix[expected][predicted] = count.  We compute one-vs-rest P/R/F1 for each
// of the 8 in-domain intents (a "miss" to "unknown" still counts against recall).

type Matrix = Record<string, Record<string, number>>;

function emptyMatrix(): Matrix {
  const m: Matrix = {};
  for (const e of INTENT_LABELS) {
    m[e] = {};
    for (const p of ALL_LABELS) m[e][p] = 0;
  }
  return m;
}

interface PRF {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

function computePRF(matrix: Matrix, intent: Label): PRF {
  // TP: expected=intent predicted=intent
  const tp = matrix[intent]?.[intent] ?? 0;
  // FN: expected=intent predicted!=intent
  let fn = 0;
  for (const p of ALL_LABELS) if (p !== intent) fn += matrix[intent]?.[p] ?? 0;
  // FP: expected!=intent predicted=intent (only in-domain expecteds appear as rows)
  let fp = 0;
  for (const e of INTENT_LABELS) if (e !== intent) fp += matrix[e]?.[intent] ?? 0;

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const support = tp + fn;
  return { precision, recall, f1, support };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (apiKey.trim().length === 0) {
    console.log(
      "OPENROUTER_API_KEY not set — intent accuracy needs network; see " +
        "testing/intent/README.md.\n" +
        "The production router calls OpenRouter to classify intent, so this " +
        "harness cannot measure accuracy without a key + network. Exiting " +
        "cleanly without writing any results (no fabricated numbers)."
    );
    process.exit(0);
  }

  const RUNS = Math.max(1, parseInt(process.env.RUNS || "5", 10) || 5);

  const dir = import.meta.dir;
  const testSet = await readJsonl<TestItem>(join(dir, "test_set.jsonl"));
  const oodSet = await readJsonl<OodItem>(join(dir, "out_of_domain.jsonl"));

  console.log("=".repeat(72));
  console.log("Tier 3a — Intent Classifier Accuracy Harness");
  console.log("=".repeat(72));
  console.log(`Test-set items : ${testSet.length} (EN + AR, author-curated)`);
  console.log(`OOD items      : ${oodSet.length}`);
  console.log(`Runs (N)       : ${RUNS}`);
  console.log(
    "NOTE: routeCommand() does not expose LLM-vs-keyword path; LLM-path " +
      "accuracy and fallback rate are NOT measurable here and are not reported."
  );
  console.log("=".repeat(72));

  // Per-run accuracy (overall + per language).
  const runAccuracyAll: number[] = [];
  const runAccuracyEn: number[] = [];
  const runAccuracyAr: number[] = [];
  // Per-run, per-intent F1 (split EN/AR) → so we can flag unstable intents.
  const runF1: Record<Lang, Record<string, number[]>> = {
    en: Object.fromEntries(INTENT_LABELS.map((i) => [i, [] as number[]])),
    ar: Object.fromEntries(INTENT_LABELS.map((i) => [i, [] as number[]])),
  };

  // Aggregate confusion matrices (summed across all runs), split by language.
  const aggMatrix: Record<Lang, Matrix> = { en: emptyMatrix(), ar: emptyMatrix() };

  // OOD: predicted-command distribution summed across runs.
  const oodDist: Record<string, number> = Object.fromEntries(ALL_LABELS.map((l) => [l, 0]));
  let oodNull = 0; // routeCommand returned null (empty text) — should not happen for OOD
  const oodRejectionRates: number[] = []; // per-run rejection (==="unknown") rate

  // Misclassification audit: expected→predicted → list of {utterance, lang}.
  const misses: Record<string, { utterance: string; lang: Lang }[]> = {};

  const t0 = Date.now();

  for (let run = 0; run < RUNS; run++) {
    let correctAll = 0;
    let correctEn = 0;
    let totalEn = 0;
    let correctAr = 0;
    let totalAr = 0;

    const runMatrix: Record<Lang, Matrix> = { en: emptyMatrix(), ar: emptyMatrix() };

    // ── In-domain items ──
    for (const item of testSet) {
      const result = await routeCommand(item.utterance);
      const predicted: Label = (result?.command ?? "unknown") as Label;

      runMatrix[item.language][item.expected_intent][predicted] += 1;
      aggMatrix[item.language][item.expected_intent][predicted] += 1;

      const accepted = item.acceptable_intents.includes(predicted);
      if (accepted) {
        correctAll++;
        if (item.language === "en") correctEn++;
        else correctAr++;
      } else {
        const key = `${item.expected_intent} -> ${predicted}`;
        (misses[key] ||= []).push({ utterance: item.utterance, lang: item.language });
      }
      if (item.language === "en") totalEn++;
      else totalAr++;
    }

    runAccuracyAll.push(correctAll / testSet.length);
    if (totalEn > 0) runAccuracyEn.push(correctEn / totalEn);
    if (totalAr > 0) runAccuracyAr.push(correctAr / totalAr);

    // Per-intent F1 for this run, per language.
    for (const lang of ["en", "ar"] as Lang[]) {
      for (const intent of INTENT_LABELS) {
        runF1[lang][intent].push(computePRF(runMatrix[lang], intent).f1);
      }
    }

    // ── OOD items ──
    let oodRejected = 0;
    for (const item of oodSet) {
      const result = await routeCommand(item.utterance);
      if (result === null) {
        oodNull++;
        continue;
      }
      const predicted = result.command as Label;
      oodDist[predicted] = (oodDist[predicted] ?? 0) + 1;
      if (predicted === "unknown") oodRejected++;
    }
    oodRejectionRates.push(oodRejected / Math.max(1, oodSet.length));

    console.log(
      `Run ${run + 1}/${RUNS}: overall=${pct(runAccuracyAll[run])}  ` +
        `EN=${pct(correctEn / Math.max(1, totalEn))}  ` +
        `AR=${pct(correctAr / Math.max(1, totalAr))}  ` +
        `OOD-reject=${pct(oodRejected / Math.max(1, oodSet.length))}`
    );
  }

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  // ── Aggregate per-intent P/R/F1 (from summed matrices) + F1 σ flags ──
  interface IntentRow {
    intent: string;
    lang: Lang;
    precision: number;
    recall: number;
    f1: number;
    support: number;
    f1Sigma: number;
    unstable: boolean;
  }
  const intentRows: IntentRow[] = [];
  for (const lang of ["en", "ar"] as Lang[]) {
    for (const intent of INTENT_LABELS) {
      const prf = computePRF(aggMatrix[lang], intent);
      const sigma = stddev(runF1[lang][intent]);
      intentRows.push({
        intent,
        lang,
        ...prf,
        f1Sigma: sigma,
        unstable: sigma > 0.05,
      });
    }
  }

  // ── OOD aggregate ──
  const oodTotalPreds = Object.values(oodDist).reduce((a, b) => a + b, 0);
  const oodRejectMean = mean(oodRejectionRates);
  const oodRejectSigma = stddev(oodRejectionRates);

  // ─── Console report ───
  console.log("\n" + "=".repeat(72));
  console.log("RESULTS");
  console.log("=".repeat(72));
  console.log(
    `Overall accuracy : ${pct(mean(runAccuracyAll))} ± ${(stddev(runAccuracyAll) * 100).toFixed(2)}pp  (N=${RUNS})`
  );
  console.log(
    `  EN accuracy    : ${pct(mean(runAccuracyEn))} ± ${(stddev(runAccuracyEn) * 100).toFixed(2)}pp`
  );
  console.log(
    `  AR accuracy    : ${pct(mean(runAccuracyAr))} ± ${(stddev(runAccuracyAr) * 100).toFixed(2)}pp`
  );

  console.log("\nPer-intent precision / recall / F1 (aggregated over all runs):");
  for (const lang of ["en", "ar"] as Lang[]) {
    console.log(`  [${lang.toUpperCase()}]`);
    for (const row of intentRows.filter((r) => r.lang === lang)) {
      console.log(
        `    ${row.intent.padEnd(18)} P=${pct(row.precision).padStart(6)} ` +
          `R=${pct(row.recall).padStart(6)} F1=${pct(row.f1).padStart(6)} ` +
          `n=${String(row.support).padStart(3)} F1σ=${row.f1Sigma.toFixed(3)}` +
          (row.unstable ? "  <<< UNSTABLE (σ>0.05)" : "")
      );
    }
  }

  const unstable = intentRows.filter((r) => r.unstable);
  if (unstable.length > 0) {
    console.log(`\nFLAGGED unstable intents (per-run F1 σ > 0.05): ${unstable.length}`);
    for (const r of unstable) {
      console.log(`  - [${r.lang.toUpperCase()}] ${r.intent} (σ=${r.f1Sigma.toFixed(3)})`);
    }
  } else {
    console.log("\nNo per-intent F1 exceeded the σ>0.05 instability threshold.");
  }

  console.log("\nOOD handling:");
  console.log(
    `  Rejection rate (predicted "unknown"): ${pct(oodRejectMean)} ± ${(oodRejectSigma * 100).toFixed(2)}pp`
  );
  console.log(`  OOD -> command distribution (summed across ${RUNS} runs):`);
  for (const label of ALL_LABELS) {
    const c = oodDist[label] ?? 0;
    if (c === 0) continue;
    console.log(`    ${label.padEnd(18)} ${String(c).padStart(5)}  (${pct(c / Math.max(1, oodTotalPreds))})`);
  }
  if (oodNull > 0) console.log(`    (null returns: ${oodNull})`);

  // ─── Write artifacts ───
  const resultsDir = join(dir, "..", "results");
  await mkdir(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    runs: RUNS,
    elapsedSeconds: Number(elapsedSec),
    model: process.env.CLASSIFICATION_MODEL || "google/gemini-2.5-flash-lite (default)",
    testSetSize: testSet.length,
    oodSetSize: oodSet.length,
    measurementLimitation:
      "routeCommand() does not expose whether the LLM path or keyword-fallback " +
      "path produced each result. LLM-path accuracy and fallback rate are NOT " +
      "measurable from the return value and are not reported. Set quality is " +
      "self-graded (author-curated). LLM is non-deterministic; hence N runs.",
    accuracy: {
      overall: { mean: mean(runAccuracyAll), sigma: stddev(runAccuracyAll), perRun: runAccuracyAll },
      en: { mean: mean(runAccuracyEn), sigma: stddev(runAccuracyEn), perRun: runAccuracyEn },
      ar: { mean: mean(runAccuracyAr), sigma: stddev(runAccuracyAr), perRun: runAccuracyAr },
    },
    perIntent: intentRows,
    confusionMatrices: { en: aggMatrix.en, ar: aggMatrix.ar },
    ood: {
      rejectionRateMean: oodRejectMean,
      rejectionRateSigma: oodRejectSigma,
      perRunRejectionRates: oodRejectionRates,
      distribution: oodDist,
      nullReturns: oodNull,
      totalPredictions: oodTotalPreds,
    },
    flaggedUnstableIntents: unstable.map((r) => ({ intent: r.intent, lang: r.lang, f1Sigma: r.f1Sigma })),
  };

  const jsonPath = join(resultsDir, `intent_accuracy_${ts}.json`);
  await writeFile(jsonPath, JSON.stringify(jsonOut, null, 2), "utf8");

  // ── Markdown confusion-matrix renderer ──
  function renderMatrixMd(m: Matrix, title: string): string {
    const cols = ALL_LABELS;
    const header = `| expected \\ predicted | ${cols.join(" | ")} |`;
    const sep = `| --- | ${cols.map(() => "---").join(" | ")} |`;
    const rows = INTENT_LABELS.map((e) => {
      const cells = cols.map((p) => String(m[e]?.[p] ?? 0));
      return `| **${e}** | ${cells.join(" | ")} |`;
    });
    return [`#### ${title}`, "", header, sep, ...rows, ""].join("\n");
  }

  // ── Misclassification audit markdown ──
  const auditLines: string[] = [];
  auditLines.push(`# Intent Misclassifications — ${new Date().toISOString()}`);
  auditLines.push("");
  auditLines.push(
    `Runs: ${RUNS}. A "miss" = predicted command NOT in the item's ` +
      `acceptable_intents. Grouped by \`expected -> predicted\`. Counts reflect ` +
      `occurrences across all ${RUNS} runs (an item can appear up to ${RUNS} times).`
  );
  auditLines.push("");
  const missKeys = Object.keys(misses).sort(
    (a, b) => misses[b].length - misses[a].length
  );
  if (missKeys.length === 0) {
    auditLines.push("_No misclassifications recorded._");
  } else {
    for (const key of missKeys) {
      auditLines.push(`## ${key} (${misses[key].length})`);
      for (const m of misses[key]) {
        auditLines.push(`- [${m.lang}] ${m.utterance}`);
      }
      auditLines.push("");
    }
  }
  auditLines.push("---");
  auditLines.push("");
  auditLines.push("## Confusion matrices");
  auditLines.push("");
  auditLines.push(renderMatrixMd(aggMatrix.en, "English (summed over all runs)"));
  auditLines.push(renderMatrixMd(aggMatrix.ar, "Arabic (summed over all runs)"));
  auditLines.push("## Measurement limitation");
  auditLines.push("");
  auditLines.push(
    "`routeCommand()` returns only `{ command, params, rawText }`. It does not " +
      "expose whether the LLM path or the keyword-fallback path produced the " +
      "result, so LLM-path accuracy and fallback rate are NOT measurable from " +
      "the return value and are not reported here."
  );

  const auditPath = join(resultsDir, `intent_misclassifications_${ts}.md`);
  await writeFile(auditPath, auditLines.join("\n"), "utf8");

  console.log("\nArtifacts written:");
  console.log(`  ${jsonPath}`);
  console.log(`  ${auditPath}`);
  console.log(`\nElapsed: ${elapsedSec}s`);
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
