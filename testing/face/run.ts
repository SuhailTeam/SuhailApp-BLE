/**
 * Tier 3b — Face recognition component accuracy runner.
 *
 * Uses the REAL production face service (AWS Rekognition):
 *   - `enrollFace(name, base64)` to enrol the gallery identities, then
 *   - `recognizeAllFaces(base64)` on labeled probe images.
 *
 * Scores precision + recall on enrolled identities, and reports the
 * false-accept rate on never-enrolled distractor faces and on no-face images
 * as SEPARATE rows.
 *
 * NEVER fabricates numbers. With no data it exits 0. With data but missing AWS
 * credentials it exits non-zero gracefully (no fake numbers, no stack trace).
 *
 * WARNING: this runner WRITES to the configured Rekognition collection
 * (it indexes the gallery faces). Use a dedicated test collection — set
 * AWS_REKOGNITION_COLLECTION_ID to something like `suhail-faces-test`.
 *
 * Run:  bun run testing/face/run.ts
 *
 * Data layout (see testing/face/data/README.md):
 *   testing/face/data/enroll/enroll.csv  + <one clear photo per identity>
 *   testing/face/data/probe/labels.csv   + <probe image files>
 *   testing/face/data/distractor/        + (probe rows reference these; never enrolled)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { recognizeAllFaces, enrollFace } from "../../src/services/face-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const RESULTS_DIR = join(HERE, "..", "results");

const UNENROLLED = "__unenrolled__"; // distractor: a real face that was never enrolled
const NOFACE = "__noface__";         // no face present at all

interface EnrollEntry { file: string; name: string; }
interface ProbeEntry { file: string; identity: string; } // identity = enrolled name | __unenrolled__ | __noface__

function readCsv(csvPath: string, colA: string, colB: string): { a: string; b: string }[] {
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const ai = header.indexOf(colA.toLowerCase());
  const bi = header.indexOf(colB.toLowerCase());
  if (ai === -1 || bi === -1) {
    throw new Error(`${csvPath} must have header columns: ${colA},${colB}`);
  }
  const out: { a: string; b: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const a = (cells[ai] ?? "").trim();
    if (!a) continue;
    out.push({ a, b: (cells[bi] ?? "").trim() });
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

function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("no test data found in testing/face/data — see testing/face/data/README.md");
    process.exit(0);
  }

  const enrollCsv = join(DATA_DIR, "enroll", "enroll.csv");
  const probeCsv = join(DATA_DIR, "probe", "labels.csv");

  let enrollEntries: EnrollEntry[] = [];
  let probeEntries: ProbeEntry[] = [];
  try {
    if (existsSync(enrollCsv)) enrollEntries = readCsv(enrollCsv, "filename", "name").map((r) => ({ file: r.a, name: r.b }));
    if (existsSync(probeCsv)) probeEntries = readCsv(probeCsv, "filename", "identity").map((r) => ({ file: r.a, identity: r.b }));
  } catch (err) {
    console.error(`[face] failed to read label files: ${(err as Error).message}`);
    process.exit(1);
  }

  if (enrollEntries.length === 0 || probeEntries.length === 0) {
    console.log("no test data found in testing/face/data — see testing/face/data/README.md");
    process.exit(0);
  }

  // Data exists → require AWS credentials. Fail gracefully (no fake numbers).
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error(
      "Face test data found but AWS credentials are not set " +
      "(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).\n" +
      "The face runner calls the real AWS Rekognition service and cannot score without them.\n" +
      "Set the credentials (see .env.example) and re-run. Exiting without producing results."
    );
    process.exit(1);
  }

  const ts = new Date().toISOString();
  const collection = process.env.AWS_REKOGNITION_COLLECTION_ID || "suhail-faces";
  console.log(`[face] Enrolling gallery + scoring recognition via AWS Rekognition (collection: ${collection}) (${ts})`);
  console.warn(`[face] NOTE: this indexes faces into collection "${collection}". Use a dedicated test collection.`);

  /* ── 1. Enrol the gallery ─────────────────────────────────── */
  const enrolledNames = new Set<string>();
  const enrollResults: { file: string; name: string; faceId: string | null; error?: string }[] = [];
  for (const e of enrollEntries) {
    const imgPath = join(DATA_DIR, "enroll", e.file);
    if (!existsSync(imgPath)) {
      enrollResults.push({ file: e.file, name: e.name, faceId: null, error: "image file missing" });
      continue;
    }
    try {
      const faceId = await enrollFace(e.name, imageToBase64(imgPath));
      if (faceId) enrolledNames.add(e.name);
      enrollResults.push({ file: e.file, name: e.name, faceId });
    } catch (err) {
      enrollResults.push({ file: e.file, name: e.name, faceId: null, error: (err as Error).message });
    }
  }

  if (enrolledNames.size === 0) {
    console.error("[face] No gallery faces enrolled successfully — cannot score recognition. Exiting.");
    process.exit(1);
  }

  /* ── 2. Run probes ───────────────────────────────────────── */
  // Per-identity confusion counts for precision/recall:
  //   TP: probe of identity X recognized as X
  //   FP: probe recognized as X but true identity != X
  //   FN: probe of identity X not recognized as X (wrong name or unknown)
  const tp = new Map<string, number>();
  const fp = new Map<string, number>();
  const fn = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // Negative handling, reported separately.
  let distractorCount = 0;
  let distractorFalseAccepts = 0; // distractor recognized as some known person
  let nofaceCount = 0;
  let nofaceFalseAccepts = 0;     // no-face image returned a known person

  interface ProbeResult {
    file: string;
    trueIdentity: string;
    predictedNames: (string | null)[];
    totalDetected: number;
    outcome: string;
    error?: string;
  }
  const probeResults: ProbeResult[] = [];

  for (const p of probeEntries) {
    const imgPath = join(DATA_DIR, "probe", p.file);
    if (!existsSync(imgPath)) {
      probeResults.push({ file: p.file, trueIdentity: p.identity, predictedNames: [], totalDetected: 0, outcome: "skipped", error: "image file missing" });
      continue;
    }
    let predictedNames: (string | null)[] = [];
    let totalDetected = 0;
    try {
      const res = await recognizeAllFaces(imageToBase64(imgPath));
      totalDetected = res.totalDetected;
      predictedNames = res.faces.map((f) => (f.isKnown ? f.name : null));
    } catch (err) {
      probeResults.push({ file: p.file, trueIdentity: p.identity, predictedNames: [], totalDetected: 0, outcome: "error", error: (err as Error).message });
      continue;
    }

    const knownPreds = predictedNames.filter((n): n is string => !!n);

    if (p.identity === NOFACE) {
      nofaceCount++;
      if (knownPreds.length > 0) {
        nofaceFalseAccepts++;
        for (const name of knownPreds) bump(fp, name);
      }
      probeResults.push({ file: p.file, trueIdentity: p.identity, predictedNames, totalDetected, outcome: knownPreds.length > 0 ? "false-accept" : "correctly-rejected" });
    } else if (p.identity === UNENROLLED) {
      distractorCount++;
      if (knownPreds.length > 0) {
        distractorFalseAccepts++;
        for (const name of knownPreds) bump(fp, name);
      }
      probeResults.push({ file: p.file, trueIdentity: p.identity, predictedNames, totalDetected, outcome: knownPreds.length > 0 ? "false-accept" : "correctly-rejected" });
    } else {
      // Positive probe of an enrolled identity.
      const truth = p.identity;
      const matched = knownPreds.includes(truth);
      if (matched) bump(tp, truth); else bump(fn, truth);
      // Any predicted name that is NOT the true identity is a false positive for that name.
      for (const name of knownPreds) {
        if (name !== truth) bump(fp, name);
      }
      probeResults.push({ file: p.file, trueIdentity: truth, predictedNames, totalDetected, outcome: matched ? "correct" : "miss" });
    }
  }

  /* ── 3. Aggregate precision / recall per identity + overall ── */
  const identities = new Set<string>([...tp.keys(), ...fp.keys(), ...fn.keys(), ...enrolledNames]);
  const perIdentity = [...identities].sort().map((id) => {
    const t = tp.get(id) ?? 0;
    const f = fp.get(id) ?? 0;
    const n = fn.get(id) ?? 0;
    return {
      identity: id,
      enrolled: enrolledNames.has(id),
      tp: t, fp: f, fn: n,
      precision: t + f === 0 ? null : t / (t + f),
      recall: t + n === 0 ? null : t / (t + n),
    };
  });

  const totalTP = [...tp.values()].reduce((a, b) => a + b, 0);
  const totalFP = [...fp.values()].reduce((a, b) => a + b, 0);
  const totalFN = [...fn.values()].reduce((a, b) => a + b, 0);
  const microPrecision = totalTP + totalFP === 0 ? null : totalTP / (totalTP + totalFP);
  const microRecall = totalTP + totalFN === 0 ? null : totalTP / (totalTP + totalFN);

  const result = {
    feature: "face",
    metric: "precision + recall on enrolled identities; false-accept rate on unenrolled distractors and no-face negatives (separate rows)",
    service: "src/services/face-service.enrollFace + recognizeAllFaces (AWS Rekognition)",
    collection,
    timestamp: ts,
    enrolled: { attempted: enrollEntries.length, succeeded: enrolledNames.size, results: enrollResults },
    overall: { microPrecision, microRecall, totalTP, totalFP, totalFN },
    perIdentity,
    negatives: {
      distractors: { samples: distractorCount, falseAccepts: distractorFalseAccepts, falseAcceptRate: distractorCount === 0 ? null : distractorFalseAccepts / distractorCount },
      noface: { samples: nofaceCount, falseAccepts: nofaceFalseAccepts, falseAcceptRate: nofaceCount === 0 ? null : nofaceFalseAccepts / nofaceCount },
    },
    probeResults,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `face_accuracy_${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  const pct = (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const md: string[] = [];
  md.push(`# Face Recognition Accuracy — ${ts}`);
  md.push("");
  md.push("Real AWS Rekognition: gallery enrolled via `enrollFace`, probes scored via `recognizeAllFaces`.");
  md.push(`Collection: \`${collection}\`. Enrolled ${enrolledNames.size}/${enrollEntries.length} identities.`);
  md.push("");
  md.push(`Overall (micro): precision ${pct(microPrecision)}, recall ${pct(microRecall)}.`);
  md.push("");
  md.push("## Per-identity");
  md.push("");
  md.push("| Identity | Enrolled | TP | FP | FN | Precision | Recall |");
  md.push("|----------|:--------:|---:|---:|---:|----------:|-------:|");
  for (const p of perIdentity) {
    md.push(`| ${p.identity} | ${p.enrolled ? "yes" : "no"} | ${p.tp} | ${p.fp} | ${p.fn} | ${pct(p.precision)} | ${pct(p.recall)} |`);
  }
  md.push("");
  md.push("## Negative handling (separate rows)");
  md.push("");
  md.push("| Negative type | Samples | False accepts | False-accept rate |");
  md.push("|---------------|--------:|--------------:|------------------:|");
  md.push(`| Unenrolled distractor faces | ${distractorCount} | ${distractorFalseAccepts} | ${pct(result.negatives.distractors.falseAcceptRate)} |`);
  md.push(`| No-face images | ${nofaceCount} | ${nofaceFalseAccepts} | ${pct(result.negatives.noface.falseAcceptRate)} |`);
  md.push("");
  md.push("False-accept = a never-enrolled face (or a no-face image) recognized as a known person.");
  const mdPath = join(RESULTS_DIR, `face_accuracy_${stamp}.md`);
  writeFileSync(mdPath, md.join("\n") + "\n", "utf-8");

  console.log("");
  console.log(`[face] Enrolled ${enrolledNames.size}/${enrollEntries.length} identities`);
  console.log(`[face] Overall micro precision ${pct(microPrecision)}, recall ${pct(microRecall)}`);
  console.log(`[face] Distractors: ${distractorCount} samples, false-accept rate ${pct(result.negatives.distractors.falseAcceptRate)}`);
  console.log(`[face] No-face: ${nofaceCount} samples, false-accept rate ${pct(result.negatives.noface.falseAcceptRate)}`);
  console.log(`[face] Results written to ${jsonPath}`);
  console.log(`[face] Markdown written to ${mdPath}`);
}

main().catch((err) => {
  console.error(`[face] runner failed: ${(err as Error).message}`);
  process.exit(1);
});
