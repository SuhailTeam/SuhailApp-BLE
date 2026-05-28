/**
 * Tier 3b — Color detection component accuracy runner.
 *
 * Feeds labeled single-color images to the REAL production service
 * (`detectColor` from src/services/vision-service) and scores the predicted
 * dominant color against ground truth.
 *
 * Matching rule (documented in data/README.md):
 *   A prediction COUNTS AS CORRECT if EITHER
 *     (a) the predicted colorName matches the label colorName (case-insensitive,
 *         after trimming; we also accept a label that lists several acceptable
 *         names separated by "|"), OR
 *     (b) a ground-truth hex is provided AND the predicted hex is within the
 *         Euclidean RGB tolerance (default 60 on a 0–255 axis).
 *   Name match is primary; hex tolerance is a fallback so a correct color with
 *   a differently-worded name (e.g. "navy" vs "dark blue") still counts.
 *
 * NEVER fabricates numbers. With no data it exits 0. With data but no
 * OPENROUTER_API_KEY it exits non-zero gracefully.
 *
 * Run:  bun run testing/color/run.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { detectColor } from "../../src/services/vision-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");
const HEX_TOLERANCE = 60; // Euclidean RGB distance threshold for fallback match.

interface Sample {
  file: string;
  /** Acceptable color names, lowercased. */
  names: string[];
  hex: string | null;
}

function readLabels(csvPath: string): Sample[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = header.indexOf("filename");
  const nameIdx = header.indexOf("colorname");
  const hexIdx = header.indexOf("hex");
  if (fileIdx === -1 || nameIdx === -1) {
    throw new Error(`labels.csv at ${csvPath} must have header columns: filename,colorName[,hex]`);
  }
  const out: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const file = (cells[fileIdx] ?? "").trim();
    if (!file) continue;
    const names = (cells[nameIdx] ?? "")
      .split("|")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    const hexRaw = hexIdx === -1 ? "" : (cells[hexIdx] ?? "").trim();
    out.push({ file, names, hex: hexRaw || null });
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

/** Parses #rrggbb / #rgb into [r,g,b], or null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function discover(dir: string): Sample[] {
  const csv = join(dir, "labels.csv");
  if (!existsSync(csv)) return [];
  try {
    return readLabels(csv);
  } catch (err) {
    console.error(`[color] failed to read ${csv}: ${(err as Error).message}`);
    return [];
  }
}

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/color/data — see testing/color/data/README.md");
    process.exit(0);
  }

  const positives = discover(DATA_DIR);
  const negatives = discover(join(DATA_DIR, "negative"));

  if (positives.length === 0 && negatives.length === 0) {
    console.log("no test data found in testing/color/data — see testing/color/data/README.md");
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "Color test data found but OPENROUTER_API_KEY is not set.\n" +
      "The color runner calls the real vision service and cannot score without it.\n" +
      "Set OPENROUTER_API_KEY (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  console.log(`[color] Scoring real detectColor() output against ground truth (${ts})`);

  interface PerSample {
    file: string;
    expectedNames: string[];
    expectedHex: string | null;
    predictedName?: string;
    predictedHex?: string;
    matchedBy?: "name" | "hex" | null;
    error?: string;
  }
  const positiveSamples: PerSample[] = [];
  let correct = 0;
  let scored = 0;

  for (const sample of positives) {
    const imgPath = join(DATA_DIR, sample.file);
    if (!existsSync(imgPath)) {
      positiveSamples.push({ file: sample.file, expectedNames: sample.names, expectedHex: sample.hex, error: "image file missing" });
      continue;
    }
    try {
      const b64 = imageToBase64(imgPath);
      const { colorName, hex } = await detectColor(b64, "en");
      const predName = colorName.trim().toLowerCase();
      let matchedBy: "name" | "hex" | null = null;
      if (sample.names.some((n) => n === predName || predName.includes(n) || n.includes(predName))) {
        matchedBy = "name";
      } else if (sample.hex) {
        const exp = parseHex(sample.hex);
        const got = parseHex(hex);
        if (exp && got && rgbDistance(exp, got) <= HEX_TOLERANCE) matchedBy = "hex";
      }
      scored++;
      if (matchedBy) correct++;
      positiveSamples.push({
        file: sample.file,
        expectedNames: sample.names,
        expectedHex: sample.hex,
        predictedName: colorName,
        predictedHex: hex,
        matchedBy,
      });
    } catch (err) {
      positiveSamples.push({ file: sample.file, expectedNames: sample.names, expectedHex: sample.hex, error: (err as Error).message });
    }
  }

  // Negatives: multi-color scenes. There is no single correct dominant color,
  // so we DO NOT score correctness. We capture the pipeline output for human
  // review (does it pick a plausible dominant color rather than crashing?).
  const negativeSamples: { file: string; predictedName?: string; predictedHex?: string; error?: string }[] = [];
  for (const sample of negatives) {
    const imgPath = join(DATA_DIR, "negative", sample.file);
    if (!existsSync(imgPath)) {
      negativeSamples.push({ file: sample.file, error: "image file missing" });
      continue;
    }
    try {
      const b64 = imageToBase64(imgPath);
      const { colorName, hex } = await detectColor(b64, "en");
      negativeSamples.push({ file: sample.file, predictedName: colorName, predictedHex: hex });
    } catch (err) {
      negativeSamples.push({ file: sample.file, error: (err as Error).message });
    }
  }

  const result = {
    feature: "color",
    metric: "dominant-color correctness (name match OR hex within RGB tolerance); multi-color negatives captured for human review",
    matchingRule: `name match (case-insensitive, substring-tolerant, "|"-separated alternatives) OR predicted hex within Euclidean RGB distance ${HEX_TOLERANCE} of label hex`,
    service: "src/services/vision-service.detectColor",
    timestamp: ts,
    visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",
    positives: {
      scored,
      accuracy: scored === 0 ? null : correct / scored,
      perSample: positiveSamples,
    },
    negatives: {
      samples: negativeSamples.length,
      note: "multi-color scenes — no single correct dominant color; pipeline output captured, correctness needs human grading",
      perSample: negativeSamples,
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `color_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const md: string[] = [];
  md.push(`# Color Accuracy — ${ts}`);
  md.push("");
  md.push("Real `detectColor()` output scored against single-color ground truth.");
  md.push(`Vision model: \`${result.visionModel}\`.`);
  md.push("");
  md.push(`Matching rule: ${result.matchingRule}.`);
  md.push("");
  md.push(`Dominant-color accuracy: ${result.positives.accuracy == null ? "—" : (result.positives.accuracy * 100).toFixed(1) + "%"} over ${scored} single-color images.`);
  md.push("");
  md.push(`Negatives (multi-color scenes): ${negativeSamples.length} images. No correctness score — pipeline output captured for human review.`);
  const mdPath = join(RESULTS_DIR, `color_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  console.log("");
  console.log(`[color] Dominant-color accuracy: ${result.positives.accuracy == null ? "n/a" : (result.positives.accuracy * 100).toFixed(1) + "%"} over ${scored} images`);
  console.log(`[color] Negatives (multi-color): ${negativeSamples.length} images captured for human review`);
  console.log(`[color] Results written to ${jsonPath}`);
  console.log(`[color] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[color] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
