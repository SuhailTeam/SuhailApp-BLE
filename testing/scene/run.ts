/**
 * Tier 3b — Scene description pipeline runner.
 *
 * Feeds labeled scene images to the REAL production service
 * (`describeScene` from src/services/vision-service) and captures the
 * free-text description.
 *
 * Scene descriptions are free text, so there is no objective accuracy. The
 * runner reports an OPTIONAL keyword-coverage heuristic (fraction of expected
 * keywords present in the description) and CLEARLY labels the captured output
 * as "correctness needs human grading". It does NOT invent an accuracy score.
 *
 * NEVER fabricates numbers. With no data it exits 0. With data but no
 * OPENROUTER_API_KEY it exits non-zero gracefully.
 *
 * Run:  bun run testing/scene/run.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describeScene } from "../../src/services/vision-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");

interface Sample {
  file: string;
  keywords: string[]; // expected salient elements (lowercased)
}

function readLabels(csvPath: string): Sample[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = header.indexOf("filename");
  const kwIdx = header.indexOf("expectedkeywords");
  if (fileIdx === -1) {
    throw new Error(`labels.csv at ${csvPath} must have header columns: filename[,expectedKeywords]`);
  }
  const out: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const file = (cells[fileIdx] ?? "").trim();
    if (!file) continue;
    const keywords = kwIdx === -1
      ? []
      : (cells[kwIdx] ?? "").split("|").map((k) => k.trim().toLowerCase()).filter(Boolean);
    out.push({ file, keywords });
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
    console.error(`[scene] failed to read ${csv}: ${(err as Error).message}`);
    return [];
  }
}

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/scene/data — see testing/scene/data/README.md");
    process.exit(0);
  }

  const samples = discover();
  if (samples.length === 0) {
    console.log("no test data found in testing/scene/data — see testing/scene/data/README.md");
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      "Scene test data found but OPENROUTER_API_KEY is not set.\n" +
      "The scene runner calls the real vision service and cannot run without it.\n" +
      "Set OPENROUTER_API_KEY (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  console.log(`[scene] Capturing real describeScene() output (${ts})`);
  console.log("[scene] NOTE: scene correctness is NOT auto-scored — outputs are captured for human grading.");

  interface PerSample {
    file: string;
    expectedKeywords: string[];
    description?: string;
    keywordsCovered?: number | null; // fraction of expected keywords present, or null
    error?: string;
  }
  const results: PerSample[] = [];
  let withKeywords = 0;
  let coverageSum = 0;

  for (const s of samples) {
    const imgPath = join(DATA_DIR, s.file);
    if (!existsSync(imgPath)) {
      results.push({ file: s.file, expectedKeywords: s.keywords, error: "image file missing" });
      continue;
    }
    try {
      const { description } = await describeScene(imageToBase64(imgPath), "en");
      let keywordsCovered: number | null = null;
      if (s.keywords.length > 0) {
        const lower = description.toLowerCase();
        const present = s.keywords.filter((k) => lower.includes(k)).length;
        keywordsCovered = present / s.keywords.length;
        withKeywords++;
        coverageSum += keywordsCovered;
      }
      results.push({ file: s.file, expectedKeywords: s.keywords, description, keywordsCovered });
    } catch (err) {
      results.push({ file: s.file, expectedKeywords: s.keywords, error: (err as Error).message });
    }
  }

  const result = {
    feature: "scene",
    metric: "pipeline output captured; correctness needs human grading. Optional keyword-coverage heuristic reported (NOT an accuracy score).",
    service: "src/services/vision-service.describeScene",
    timestamp: ts,
    visionModel: process.env.VISION_MODEL || "google/gemini-2.5-flash-lite",
    humanReviewPending: true,
    keywordHeuristic: {
      samplesWithKeywords: withKeywords,
      meanKeywordCoverage: withKeywords === 0 ? null : coverageSum / withKeywords,
      note: "Mean fraction of expected salient keywords mentioned in the description. A loose recall proxy, NOT a correctness metric.",
    },
    samples: results,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `scene_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const md: string[] = [];
  md.push(`# Scene Description Pipeline Output — ${ts}`);
  md.push("");
  md.push("**Correctness needs human grading.** Real `describeScene()` outputs are captured below; the keyword-coverage heuristic is a loose recall proxy, not an accuracy score.");
  md.push(`Vision model: \`${result.visionModel}\`. Samples: ${results.length}.`);
  md.push("");
  md.push(`Keyword-coverage heuristic: ${result.keywordHeuristic.meanKeywordCoverage == null ? "— (no keywords provided)" : (result.keywordHeuristic.meanKeywordCoverage * 100).toFixed(1) + "% mean coverage over " + withKeywords + " keyworded samples"}.`);
  md.push("");
  md.push("## Captured descriptions (for human review)");
  md.push("");
  md.push("| Image | Expected keywords | Description | Coverage |");
  md.push("|-------|-------------------|-------------|:--------:|");
  for (const r of results) {
    const desc = r.error ? `ERROR: ${r.error}` : (r.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const cov = r.keywordsCovered == null ? "n/a" : (r.keywordsCovered * 100).toFixed(0) + "%";
    md.push(`| ${r.file} | ${r.expectedKeywords.join(", ")} | ${desc} | ${cov} |`);
  }
  const mdPath = join(RESULTS_DIR, `scene_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  console.log("");
  console.log(`[scene] Captured ${results.length} descriptions (human grading pending)`);
  console.log(`[scene] Keyword-coverage heuristic: ${result.keywordHeuristic.meanKeywordCoverage == null ? "n/a (no keywords)" : (result.keywordHeuristic.meanKeywordCoverage * 100).toFixed(1) + "%"}`);
  console.log(`[scene] Results written to ${jsonPath}`);
  console.log(`[scene] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[scene] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
