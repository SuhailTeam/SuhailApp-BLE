/**
 * Tier 3b — OCR component accuracy runner.
 *
 * Feeds labeled images to the REAL production OCR service
 * (`extractText` from src/services/vision-service) and scores the output
 * against UTF-8 ground-truth text using CER (character error rate) and
 * WER (word error rate), reported per language subdir (en / ar / mixed).
 *
 * NEVER fabricates numbers. With no labeled data present it exits 0 with a
 * clear message. With data but no OPENROUTER_API_KEY it exits non-zero
 * gracefully (no fake numbers, no stack trace).
 *
 * Run:  bun run testing/ocr/run.ts
 *
 * Data layout (see testing/ocr/data/README.md):
 *   testing/ocr/data/en/labels.csv      + <image files>
 *   testing/ocr/data/ar/labels.csv      + <image files>
 *   testing/ocr/data/mixed/labels.csv   + <image files>
 *   testing/ocr/data/negative/labels.csv + <image files>   (text must be empty)
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractText } from "../../src/services/vision-service";
import type { Language } from "../../src/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");

/* ── Tiny CSV reader (label files are simple: filename,text) ───── */

interface Sample {
  file: string;
  text: string; // ground-truth (may be empty for negatives)
}

/** Parses a labels.csv with header `filename,text`. Quotes optional; text may contain commas if quoted. */
function readLabels(csvPath: string): Sample[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = header.indexOf("filename");
  const textIdx = header.indexOf("text");
  if (fileIdx === -1 || textIdx === -1) {
    throw new Error(`labels.csv at ${csvPath} must have a header row with columns: filename,text`);
  }
  const out: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const file = (cells[fileIdx] ?? "").trim();
    if (!file) continue;
    out.push({ file, text: (cells[textIdx] ?? "").trim() });
  }
  return out;
}

/** Minimal CSV line splitter that honours double-quoted fields. */
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

/* ── Scoring utilities (NOT production code — generic text metrics) ─── */

/** Levenshtein edit distance between two token arrays (chars or words). */
function editDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Normalize whitespace for fair comparison (collapse runs, trim). */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Character error rate = char edit distance / reference char length. */
function cer(reference: string, hypothesis: string): number {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance([...ref], [...hyp]) / ref.length;
}

/** Word error rate = word edit distance / reference word count. */
function wer(reference: string, hypothesis: string): number {
  const refWords = normalize(reference).split(" ").filter(Boolean);
  const hypWords = normalize(hypothesis).split(" ").filter(Boolean);
  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;
  return editDistance(refWords, hypWords) / refWords.length;
}

/* ── Sample discovery ──────────────────────────────────────── */

const SUBDIRS: { dir: string; lang: Language; negative: boolean }[] = [
  { dir: "en", lang: "en", negative: false },
  { dir: "ar", lang: "ar", negative: false },
  { dir: "mixed", lang: "en", negative: false },
  { dir: "negative", lang: "en", negative: true },
];

interface FoundSubdir {
  dir: string;
  lang: Language;
  negative: boolean;
  samples: Sample[];
}

/** Returns subdirs that actually contain a labels.csv with at least one row. */
function discover(): FoundSubdir[] {
  const found: FoundSubdir[] = [];
  for (const sd of SUBDIRS) {
    const csv = join(DATA_DIR, sd.dir, "labels.csv");
    if (!existsSync(csv)) continue;
    let samples: Sample[] = [];
    try {
      samples = readLabels(csv);
    } catch (err) {
      console.error(`[ocr] failed to read ${csv}: ${(err as Error).message}`);
      continue;
    }
    if (samples.length > 0) found.push({ ...sd, samples });
  }
  return found;
}

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

/* ── Main ──────────────────────────────────────────────────── */

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/ocr/data — see testing/ocr/data/README.md");
    process.exit(0);
  }

  const found = discover();
  if (found.length === 0) {
    console.log("no test data found in testing/ocr/data — see testing/ocr/data/README.md");
    process.exit(0);
  }

  // Data exists → require the API key. Fail gracefully (no fake numbers).
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "OCR test data found but OPENROUTER_API_KEY is not set.\n" +
      "The OCR runner calls the real vision service and cannot score without it.\n" +
      "Set OPENROUTER_API_KEY (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  console.log(`[ocr] Scoring real extractText() output against ground truth (${ts})`);

  interface PerCondition {
    condition: string;
    lang: Language;
    negative: boolean;
    samples: number;
    meanCER: number | null;
    meanWER: number | null;
    hallucinationRate: number | null; // negatives only: fraction returning non-empty text
    perSample: {
      file: string;
      cer: number | null;
      wer: number | null;
      predictedEmpty?: boolean;
      error?: string;
    }[];
  }

  const conditions: PerCondition[] = [];

  for (const sd of found) {
    const dirPath = join(DATA_DIR, sd.dir);
    const perSample: PerCondition["perSample"] = [];
    let cerSum = 0;
    let werSum = 0;
    let scored = 0;
    let hallucinated = 0;
    let negCounted = 0;

    for (const sample of sd.samples) {
      const imgPath = join(dirPath, sample.file);
      if (!existsSync(imgPath)) {
        perSample.push({ file: sample.file, cer: null, wer: null, error: "image file missing" });
        continue;
      }
      try {
        const b64 = imageToBase64(imgPath);
        const predicted = await extractText(b64, undefined, sd.lang);
        if (sd.negative) {
          const isEmpty = normalize(predicted).length === 0;
          negCounted++;
          if (!isEmpty) hallucinated++;
          perSample.push({ file: sample.file, cer: null, wer: null, predictedEmpty: isEmpty });
        } else {
          const c = cer(sample.text, predicted);
          const w = wer(sample.text, predicted);
          cerSum += c;
          werSum += w;
          scored++;
          perSample.push({ file: sample.file, cer: c, wer: w });
        }
      } catch (err) {
        perSample.push({ file: sample.file, cer: null, wer: null, error: (err as Error).message });
      }
    }

    conditions.push({
      condition: sd.dir,
      lang: sd.lang,
      negative: sd.negative,
      samples: sd.samples.length,
      meanCER: sd.negative || scored === 0 ? null : cerSum / scored,
      meanWER: sd.negative || scored === 0 ? null : werSum / scored,
      hallucinationRate: sd.negative ? (negCounted === 0 ? null : hallucinated / negCounted) : null,
      perSample,
    });
  }

  const result = {
    feature: "ocr",
    metric: "CER + WER per language subdir; hallucination rate on negatives",
    service: "src/services/vision-service.extractText",
    timestamp: ts,
    visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",
    conditions,
  };

  // Write JSON + markdown.
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `ocr_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const md: string[] = [];
  md.push(`# OCR Accuracy — ${ts}`);
  md.push("");
  md.push("Real `extractText()` output scored against UTF-8 ground truth.");
  md.push(`Vision model: \`${result.visionModel}\`.`);
  md.push("");
  md.push("| Condition | Lang | Samples | Mean CER | Mean WER | Hallucination rate |");
  md.push("|-----------|------|--------:|---------:|---------:|-------------------:|");
  for (const c of conditions) {
    md.push(
      `| ${c.condition} | ${c.lang} | ${c.samples} | ` +
      `${c.meanCER == null ? "—" : (c.meanCER * 100).toFixed(1) + "%"} | ` +
      `${c.meanWER == null ? "—" : (c.meanWER * 100).toFixed(1) + "%"} | ` +
      `${c.hallucinationRate == null ? "—" : (c.hallucinationRate * 100).toFixed(1) + "%"} |`
    );
  }
  md.push("");
  md.push("CER = character edit distance / reference chars. WER = word edit distance / reference words. Lower is better.");
  md.push("Hallucination rate = fraction of negative (no-text) images where OCR returned non-empty text.");
  const mdPath = join(RESULTS_DIR, `ocr_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  // Console summary.
  console.log("");
  for (const c of conditions) {
    if (c.negative) {
      console.log(`[ocr] ${c.condition}: ${c.samples} samples, hallucination rate ${c.hallucinationRate == null ? "n/a" : (c.hallucinationRate * 100).toFixed(1) + "%"}`);
    } else {
      console.log(`[ocr] ${c.condition} (${c.lang}): ${c.samples} samples, CER ${c.meanCER == null ? "n/a" : (c.meanCER * 100).toFixed(1) + "%"}, WER ${c.meanWER == null ? "n/a" : (c.meanWER * 100).toFixed(1) + "%"}`);
    }
  }
  console.log(`[ocr] Results written to ${jsonPath}`);
  console.log(`[ocr] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[ocr] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
