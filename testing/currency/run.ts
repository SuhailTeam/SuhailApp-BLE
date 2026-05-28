/**
 * Tier 3b — Currency component accuracy runner.
 *
 * Feeds labeled cash photos to the REAL production service
 * (`recognizeCurrency` from src/services/vision-service) and scores the
 * predicted per-denomination counts against ground truth.
 *
 * NEVER fabricates numbers. With no labeled data it exits 0 with a clear
 * message. With data but no OPENROUTER_API_KEY it exits non-zero gracefully.
 *
 * Run:  bun run testing/currency/run.ts
 *
 * Data layout (see testing/currency/data/README.md):
 *   testing/currency/data/labels.csv   + <image files>
 *   testing/currency/data/negative/labels.csv + <image files>  (no money)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { recognizeCurrency } from "../../src/services/vision-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");

/* ── Ground-truth model ───────────────────────────────────── */

interface Sample {
  file: string;
  /** Map of denomination -> count. Empty for negatives. */
  bills: Map<number, number>;
}

/** Parses a `bills` cell like "500x3;100x2;50x1" into a Map. Empty => no bills. */
function parseBills(cell: string): Map<number, number> {
  const map = new Map<number, number>();
  const trimmed = cell.trim();
  if (!trimmed) return map;
  for (const part of trimmed.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+)$/);
    if (!m) throw new Error(`bad bills entry "${p}" (expected e.g. 500x3)`);
    const denom = Number(m[1]);
    const count = Number(m[2]);
    map.set(denom, (map.get(denom) ?? 0) + count);
  }
  return map;
}

function readLabels(csvPath: string): Sample[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = header.indexOf("filename");
  const billsIdx = header.indexOf("bills");
  if (fileIdx === -1 || billsIdx === -1) {
    throw new Error(`labels.csv at ${csvPath} must have header columns: filename,bills`);
  }
  const out: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const file = (cells[fileIdx] ?? "").trim();
    if (!file) continue;
    out.push({ file, bills: parseBills(cells[billsIdx] ?? "") });
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

/* ── Sample discovery ──────────────────────────────────────── */

function discover(dir: string): Sample[] {
  const csv = join(dir, "labels.csv");
  if (!existsSync(csv)) return [];
  try {
    return readLabels(csv);
  } catch (err) {
    console.error(`[currency] failed to read ${csv}: ${(err as Error).message}`);
    return [];
  }
}

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

/* ── Main ──────────────────────────────────────────────────── */

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/currency/data — see testing/currency/data/README.md");
    process.exit(0);
  }

  const positives = discover(DATA_DIR);
  const negatives = discover(join(DATA_DIR, "negative"));

  if (positives.length === 0 && negatives.length === 0) {
    console.log("no test data found in testing/currency/data — see testing/currency/data/README.md");
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "Currency test data found but OPENROUTER_API_KEY is not set.\n" +
      "The currency runner calls the real vision service and cannot score without it.\n" +
      "Set OPENROUTER_API_KEY (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  console.log(`[currency] Scoring real recognizeCurrency() output against ground truth (${ts})`);

  // Per-denomination accuracy: a denomination's predicted count is "correct"
  // for a sample when it exactly matches the ground-truth count for that
  // denomination in that image. Aggregate exact-count matches per denomination.
  const denomStats = new Map<number, { correct: number; total: number }>();
  let exactPhotoMatches = 0; // photos where ALL denominations matched exactly
  let scoredPhotos = 0;

  interface PerSample {
    file: string;
    expected: Record<string, number>;
    predicted?: Record<string, number>;
    exactMatch?: boolean;
    error?: string;
  }
  const positiveSamples: PerSample[] = [];

  for (const sample of positives) {
    const imgPath = join(DATA_DIR, sample.file);
    const expected: Record<string, number> = {};
    sample.bills.forEach((cnt, denom) => { expected[String(denom)] = cnt; });

    if (!existsSync(imgPath)) {
      positiveSamples.push({ file: sample.file, expected, error: "image file missing" });
      continue;
    }
    try {
      const b64 = imageToBase64(imgPath);
      const result = await recognizeCurrency(b64);
      const predMap = new Map<number, number>();
      for (const b of result.bills) predMap.set(b.denomination, (predMap.get(b.denomination) ?? 0) + b.count);
      // Include other-currency bills too so a wrong-currency guess isn't silently ignored.
      for (const oc of result.otherCurrencies ?? []) {
        for (const b of oc.bills) predMap.set(b.denomination, (predMap.get(b.denomination) ?? 0) + b.count);
      }
      const predicted: Record<string, number> = {};
      predMap.forEach((cnt, denom) => { predicted[String(denom)] = cnt; });

      // Score every denomination that appears in either expected or predicted.
      const allDenoms = new Set<number>([...sample.bills.keys(), ...predMap.keys()]);
      let allMatch = true;
      for (const denom of allDenoms) {
        const exp = sample.bills.get(denom) ?? 0;
        const got = predMap.get(denom) ?? 0;
        const stat = denomStats.get(denom) ?? { correct: 0, total: 0 };
        stat.total++;
        if (exp === got) stat.correct++; else allMatch = false;
        denomStats.set(denom, stat);
      }
      scoredPhotos++;
      if (allMatch) exactPhotoMatches++;
      positiveSamples.push({ file: sample.file, expected, predicted, exactMatch: allMatch });
    } catch (err) {
      positiveSamples.push({ file: sample.file, expected, error: (err as Error).message });
    }
  }

  // Negatives: must return zero bills.
  let negCounted = 0;
  let falsePositives = 0;
  const negativeSamples: { file: string; returnedBills?: number; error?: string }[] = [];
  for (const sample of negatives) {
    const imgPath = join(DATA_DIR, "negative", sample.file);
    if (!existsSync(imgPath)) {
      negativeSamples.push({ file: sample.file, error: "image file missing" });
      continue;
    }
    try {
      const b64 = imageToBase64(imgPath);
      const result = await recognizeCurrency(b64);
      const totalBills =
        result.bills.reduce((s, b) => s + b.count, 0) +
        (result.otherCurrencies ?? []).reduce((s, oc) => s + oc.bills.reduce((t, b) => t + b.count, 0), 0);
      negCounted++;
      if (totalBills > 0) falsePositives++;
      negativeSamples.push({ file: sample.file, returnedBills: totalBills });
    } catch (err) {
      negativeSamples.push({ file: sample.file, error: (err as Error).message });
    }
  }

  const perDenomination = [...denomStats.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([denom, s]) => ({
      denomination: denom,
      samples: s.total,
      accuracy: s.total === 0 ? null : s.correct / s.total,
    }));

  const result = {
    feature: "currency",
    metric: "per-denomination exact-count accuracy; whole-photo exact match; false-positive rate on negatives",
    service: "src/services/vision-service.recognizeCurrency",
    timestamp: ts,
    visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",
    positives: {
      scoredPhotos,
      wholePhotoExactAccuracy: scoredPhotos === 0 ? null : exactPhotoMatches / scoredPhotos,
      perDenomination,
      perSample: positiveSamples,
    },
    negatives: {
      samples: negCounted,
      falsePositiveRate: negCounted === 0 ? null : falsePositives / negCounted,
      perSample: negativeSamples,
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `currency_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const md: string[] = [];
  md.push(`# Currency Accuracy — ${ts}`);
  md.push("");
  md.push("Real `recognizeCurrency()` output scored against per-denomination ground truth.");
  md.push(`Vision model: \`${result.visionModel}\`.`);
  md.push("");
  md.push("## Per-denomination exact-count accuracy");
  md.push("");
  md.push("| Denomination | Samples | Accuracy |");
  md.push("|-------------:|--------:|---------:|");
  for (const d of perDenomination) {
    md.push(`| ${d.denomination} | ${d.samples} | ${d.accuracy == null ? "—" : (d.accuracy * 100).toFixed(1) + "%"} |`);
  }
  md.push("");
  md.push(`Whole-photo exact match (all denominations correct): ${result.positives.wholePhotoExactAccuracy == null ? "—" : (result.positives.wholePhotoExactAccuracy * 100).toFixed(1) + "%"} over ${scoredPhotos} photos.`);
  md.push("");
  md.push("## Negatives (non-currency items)");
  md.push("");
  md.push(`Samples: ${negCounted}. False-positive rate (returned ≥1 bill): ${result.negatives.falsePositiveRate == null ? "—" : (result.negatives.falsePositiveRate * 100).toFixed(1) + "%"}.`);
  const mdPath = join(RESULTS_DIR, `currency_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  console.log("");
  console.log(`[currency] Per-denomination accuracy over ${scoredPhotos} positive photos:`);
  for (const d of perDenomination) {
    console.log(`[currency]   ${d.denomination}: ${d.accuracy == null ? "n/a" : (d.accuracy * 100).toFixed(1) + "%"} (${d.samples} samples)`);
  }
  console.log(`[currency] Whole-photo exact match: ${result.positives.wholePhotoExactAccuracy == null ? "n/a" : (result.positives.wholePhotoExactAccuracy * 100).toFixed(1) + "%"}`);
  console.log(`[currency] Negatives: ${negCounted} samples, false-positive rate ${result.negatives.falsePositiveRate == null ? "n/a" : (result.negatives.falsePositiveRate * 100).toFixed(1) + "%"}`);
  console.log(`[currency] Results written to ${jsonPath}`);
  console.log(`[currency] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[currency] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
