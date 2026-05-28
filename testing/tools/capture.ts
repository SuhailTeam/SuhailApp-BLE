/**
 * Tier 3b — labeled-sample capture helper (optional convenience).
 *
 * Copies an existing image file into the right component data dir and appends a
 * row to that dir's `labels.csv`, prompting for the label interactively. This
 * just speeds up dataset collection from photos already on disk — it does NOT
 * call any glasses hardware or AI service, and does NOTHING on import.
 *
 * Usage:
 *   bun run testing/tools/capture.ts <feature> <subdir> <image-path>
 *
 *   feature : ocr | currency | color | vqa | scene | face
 *   subdir  : the target data subdir for that feature, e.g.
 *               ocr:      en | ar | mixed | negative
 *               currency: .  | negative          ( "." = data root )
 *               color:    .  | negative
 *               vqa:      .
 *               scene:    .
 *               face:     enroll | probe
 *   image   : path to a JPEG (ideally 1920x1080, medium compression)
 *
 * Example:
 *   bun run testing/tools/capture.ts ocr en ~/Desktop/receipt.jpg
 *
 * The helper then prompts for the label fields that the chosen feature's
 * labels.csv expects (see each feature's data/README.md for the schema).
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTING_ROOT = join(HERE, "..");

/** Header columns + the label-file name for each feature. */
const SCHEMAS: Record<string, { csv: string; headers: string[] }> = {
  ocr: { csv: "labels.csv", headers: ["filename", "text"] },
  currency: { csv: "labels.csv", headers: ["filename", "bills"] },
  color: { csv: "labels.csv", headers: ["filename", "colorName", "hex"] },
  vqa: { csv: "labels.csv", headers: ["filename", "question", "expectedKeywords"] },
  scene: { csv: "labels.csv", headers: ["filename", "expectedKeywords"] },
  // face uses two label files depending on subdir:
  "face:enroll": { csv: "enroll.csv", headers: ["filename", "name"] },
  "face:probe": { csv: "labels.csv", headers: ["filename", "identity"] },
};

/** Escapes a CSV field (quote if it contains comma, quote, or newline). */
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function readLine(question: string): string {
  // Bun (and Node ≥ 22) expose a synchronous global `prompt`.
  const p = (globalThis as { prompt?: (q: string) => string | null }).prompt;
  if (typeof p === "function") {
    return (p(question) ?? "").trim();
  }
  throw new Error("Interactive prompt is unavailable in this runtime; run under Bun.");
}

async function main() {
  const [feature, subdir, imagePath] = process.argv.slice(2);
  if (!feature || !subdir || !imagePath) {
    console.error("Usage: bun run testing/tools/capture.ts <feature> <subdir> <image-path>");
    console.error("  feature: ocr | currency | color | vqa | scene | face");
    process.exit(1);
  }
  if (!existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const schemaKey = feature === "face" ? `face:${subdir}` : feature;
  const schema = SCHEMAS[schemaKey];
  if (!schema) {
    console.error(`Unknown feature/subdir combination: ${feature} ${subdir}`);
    console.error("Known: ocr, currency, color, vqa, scene, face (enroll|probe).");
    process.exit(1);
  }

  // Resolve target dir. "." means the feature data root.
  const targetDir = subdir === "." ? join(TESTING_ROOT, feature, "data") : join(TESTING_ROOT, feature, "data", subdir);
  mkdirSync(targetDir, { recursive: true });

  const filename = basename(imagePath);
  const dest = join(targetDir, filename);
  if (existsSync(dest)) {
    console.error(`A file named ${filename} already exists in ${targetDir}. Rename your source file first.`);
    process.exit(1);
  }
  copyFileSync(imagePath, dest);

  // Collect the non-filename label fields.
  const values: Record<string, string> = { filename };
  for (const col of schema.headers) {
    if (col === "filename") continue;
    values[col] = readLine(`${col}: `);
  }

  // Ensure the CSV exists with a header, then append the row.
  const csvPath = join(targetDir, schema.csv);
  if (!existsSync(csvPath)) {
    writeFileSync(csvPath, schema.headers.join(",") + "\n", "utf-8");
  } else {
    // Make sure the existing file ends with a newline before appending.
    const existing = readFileSync(csvPath, "utf-8");
    if (existing.length > 0 && !existing.endsWith("\n")) appendFileSync(csvPath, "\n");
  }
  const row = schema.headers.map((h) => csvEscape(values[h] ?? "")).join(",");
  appendFileSync(csvPath, row + "\n");

  console.log(`Saved ${filename} -> ${targetDir}`);
  console.log(`Appended label row to ${csvPath}: ${row}`);
}

main().catch((err) => {
  console.error(`capture failed: ${(err as Error).message}`);
  process.exit(1);
});
