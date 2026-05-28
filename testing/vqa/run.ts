/**
 * Tier 3b — Visual Question Answering (VQA) pipeline runner.
 *
 * Feeds labeled (image, question) pairs to the REAL production service
 * (`answerVisualQuestion` from src/services/vision-service) and captures the
 * free-text answer.
 *
 * VQA answers are free text, so there is no objective accuracy. The runner
 * reports an OPTIONAL keyword/substring heuristic (fraction of answers
 * containing any expected keyword) and CLEARLY labels the captured output as
 * "correctness needs human grading". It does NOT invent an accuracy score.
 *
 * NEVER fabricates numbers. With no data it exits 0. With data but no
 * OPENROUTER_API_KEY it exits non-zero gracefully.
 *
 * Run:  bun run testing/vqa/run.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { answerVisualQuestion } from "../../src/services/vision-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");

interface Sample {
  file: string;
  question: string;
  keywords: string[]; // optional expected keywords (lowercased)
}

function readLabels(csvPath: string): Sample[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = header.indexOf("filename");
  const qIdx = header.indexOf("question");
  const kwIdx = header.indexOf("expectedkeywords");
  if (fileIdx === -1 || qIdx === -1) {
    throw new Error(`labels.csv at ${csvPath} must have header columns: filename,question[,expectedKeywords]`);
  }
  const out: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const file = (cells[fileIdx] ?? "").trim();
    const question = (cells[qIdx] ?? "").trim();
    if (!file || !question) continue;
    const keywords = kwIdx === -1
      ? []
      : (cells[kwIdx] ?? "").split("|").map((k) => k.trim().toLowerCase()).filter(Boolean);
    out.push({ file, question, keywords });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur); cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function discover(): Sample[] {
  const csv = join(DATA_DIR, "labels.csv");
  if (!existsSync(csv)) return [];
  try {
    return readLabels(csv);
  } catch (err) {
    console.error(`[vqa] failed to read ${csv}: ${(err as Error).message}`);
    return [];
  }
}

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/vqa/data — see testing/vqa/data/README.md");
    process.exit(0);
  }

  const samples = discover();
  if (samples.length === 0) {
    console.log("no test data found in testing/vqa/data — see testing/vqa/data/README.md");
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "VQA test data found but OPENROUTER_API_KEY is not set.\n" +
      "The VQA runner calls the real vision service and cannot run without it.\n" +
      "Set OPENROUTER_API_KEY (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  console.log(`[vqa] Capturing real answerVisualQuestion() output (${ts})`);
  console.log("[vqa] NOTE: VQA correctness is NOT auto-scored — outputs are captured for human grading.");

  interface PerSample {
    file: string;
    question: string;
    expectedKeywords: string[];
    answer?: string;
    keywordHit?: boolean | null; // null when no keywords provided
    error?: string;
  }
  const results: PerSample[] = [];
  let withKeywords = 0;
  let keywordHits = 0;

  for (const s of samples) {
    const imgPath = join(DATA_DIR, s.file);
    if (!existsSync(imgPath)) {
      results.push({ file: s.file, question: s.question, expectedKeywords: s.keywords, error: "image file missing" });
      continue;
    }
    try {
      const { description } = await answerVisualQuestion(imageToBase64(imgPath), s.question, "en");
      let keywordHit: boolean | null = null;
      if (s.keywords.length > 0) {
        const lower = description.toLowerCase();
        keywordHit = s.keywords.some((k) => lower.includes(k));
        withKeywords++;
        if (keywordHit) keywordHits++;
      }
      results.push({ file: s.file, question: s.question, expectedKeywords: s.keywords, answer: description, keywordHit });
    } catch (err) {
      results.push({ file: s.file, question: s.question, expectedKeywords: s.keywords, error: (err as Error).message });
    }
  }

  const result = {
    feature: "vqa",
    metric: "pipeline output captured; correctness needs human grading. Optional keyword-hit heuristic reported (NOT an accuracy score).",
    service: "src/services/vision-service.answerVisualQuestion",
    timestamp: ts,
    visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",
    humanReviewPending: true,
    keywordHeuristic: {
      samplesWithKeywords: withKeywords,
      keywordHitRate: withKeywords === 0 ? null : keywordHits / withKeywords,
      note: "Fraction of answers containing ANY expected keyword. A loose sanity check, NOT a correctness metric.",
    },
    samples: results,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `vqa_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const md: string[] = [];
  md.push(`# VQA Pipeline Output — ${ts}`);
  md.push("");
  md.push("**Correctness needs human grading.** Real `answerVisualQuestion()` outputs are captured below; the keyword heuristic is a loose sanity check, not an accuracy score.");
  md.push(`Vision model: \`${result.visionModel}\`. Samples: ${results.length}.`);
  md.push("");
  md.push(`Keyword-hit heuristic: ${result.keywordHeuristic.keywordHitRate == null ? "— (no keywords provided)" : (result.keywordHeuristic.keywordHitRate * 100).toFixed(1) + "% of " + withKeywords + " keyworded samples"}.`);
  md.push("");
  md.push("## Captured answers (for human review)");
  md.push("");
  md.push("| Image | Question | Answer | Keyword hit |");
  md.push("|-------|----------|--------|:-----------:|");
  for (const r of results) {
    const ans = r.error ? `ERROR: ${r.error}` : (r.answer ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const hit = r.keywordHit == null ? "n/a" : r.keywordHit ? "yes" : "no";
    md.push(`| ${r.file} | ${r.question.replace(/\|/g, "\\|")} | ${ans} | ${hit} |`);
  }
  const mdPath = join(RESULTS_DIR, `vqa_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  console.log("");
  console.log(`[vqa] Captured ${results.length} answers (human grading pending)`);
  console.log(`[vqa] Keyword-hit heuristic: ${result.keywordHeuristic.keywordHitRate == null ? "n/a (no keywords)" : (result.keywordHeuristic.keywordHitRate * 100).toFixed(1) + "%"}`);
  console.log(`[vqa] Results written to ${jsonPath}`);
  console.log(`[vqa] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[vqa] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
