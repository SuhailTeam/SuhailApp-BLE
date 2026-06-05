/**
 * Per-command functional dataset runner (report Table 13.12 / 39).
 *
 *   bun run testing/datasets/run.ts            # reports staged-row counts, accuracy needs-data
 *   RUN_LIVE=1 bun run testing/datasets/run.ts # scores against the real services (costs credits)
 *
 * For each of the 8 commands it loads testing/datasets/<command>/manifest.jsonl.
 * When RUN_LIVE=1 and an OpenRouter key is present, it base64-encodes each image,
 * calls the matching REAL src/services function, and scores against ground truth.
 * Otherwise (the report's current state) accuracy is null → run_all.ts renders
 * needs-data. Latency is ALWAYS needs-device: it is captured on Mentra Live via
 * the mobile timeline / usability CSV (see ./README.md), never synthesized here.
 *
 * run_all.ts imports computeDatasetMetrics to source Table 13.12, so real numbers
 * appear automatically the instant a manifest + RUN_LIVE=1 + keys land.
 */
import { existsSync } from "node:fs";
import { config } from "../../src/utils/config";
import { scoreAnyOf, scoreContains, scoreCurrency, scoreFound, scoreFaceName } from "./score";

export const DATASET_COMMANDS = [
  "scene-summarize",
  "ocr-read-text",
  "face-recognize",
  "face-enroll",
  "find-object",
  "currency-recognize",
  "visual-qa",
  "color-detect",
] as const;

export interface CommandDatasetResult {
  command: string;
  /** Manifest rows staged for this command. */
  n: number;
  /** pass/total when scored live; null when not run (→ needs-data). */
  accuracy: number | null;
  extra?: { recall?: number; falsePositiveRate?: number };
}

export interface DatasetMetrics {
  live: boolean;
  byCommand: Record<string, CommandDatasetResult>;
}

type Row = Record<string, any>;

async function loadManifest(cmdDir: string): Promise<Row[]> {
  const path = `${cmdDir}/manifest.jsonl`;
  if (!existsSync(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Row);
}

async function imgB64(path: string): Promise<string> {
  return Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
}

/** Scores one command's manifest against the real services. Returns null accuracy if every row errored (couldn't run). */
async function scoreCommand(cmd: string, cmdDir: string, manifest: Row[]): Promise<CommandDatasetResult> {
  const vision = await import("../../src/services/vision-service");
  const faces = await import("../../src/services/face-service");

  let pass = 0;
  let errors = 0;
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let knownProbes = 0;
  let strangerProbes = 0;

  for (const row of manifest) {
    try {
      let ok = false;
      const img = () => imgB64(`${cmdDir}/images/${row.file}`);
      switch (cmd) {
        case "scene-summarize": {
          const r = await vision.describeScene(await img(), row.language);
          ok = scoreAnyOf(r.description, row.expected?.anyOf ?? []).pass;
          break;
        }
        case "ocr-read-text": {
          const t = await vision.extractText(await img(), row.context, row.language);
          ok = scoreContains(t, row.expected?.contains ?? []).pass;
          break;
        }
        case "visual-qa": {
          const r = await vision.answerVisualQuestion(await img(), row.question, row.language);
          ok = scoreContains(r.description, row.expected?.contains ?? []).pass;
          break;
        }
        case "color-detect": {
          const r = await vision.detectColor(await img(), row.language);
          ok = scoreAnyOf(r.colorName, row.expected?.anyOf ?? []).pass;
          break;
        }
        case "find-object": {
          const r = await vision.detectObject(await img(), row.target, row.language);
          ok = scoreFound(r.found, r.location, row.expected ?? { found: false }).pass;
          break;
        }
        case "currency-recognize": {
          const r = await vision.recognizeCurrency(await img());
          ok = scoreCurrency(r.currency, r.total, row.expected).pass;
          break;
        }
        case "face-recognize": {
          const r = await faces.recognizeAllFaces(await img());
          const names = r.faces.filter((f) => f.isKnown && f.name).map((f) => f.name as string);
          const expected = row.expected ?? null;
          ok = scoreFaceName(names, expected).pass;
          if (expected === null) {
            strangerProbes += 1;
            if (!ok) fp += 1;
          } else {
            knownProbes += 1;
            if (ok) tp += 1;
            else fn += 1;
          }
          break;
        }
        case "face-enroll": {
          const faceId = await faces.enrollFace(row.name, await img());
          if (faceId && row.probe) {
            const r = await faces.recognizeAllFaces(await imgB64(`${cmdDir}/images/${row.probe}`));
            const names = r.faces.filter((f) => f.isKnown && f.name).map((f) => f.name as string);
            ok = names.includes(row.expected ?? row.name);
          } else {
            ok = Boolean(faceId);
          }
          break;
        }
      }
      if (ok) pass += 1;
    } catch {
      errors += 1;
    }
  }

  // Every row errored (e.g. missing AWS creds for a face command) → couldn't run.
  if (manifest.length > 0 && errors === manifest.length) {
    return { command: cmd, n: manifest.length, accuracy: null };
  }
  const extra =
    cmd === "face-recognize"
      ? { recall: knownProbes ? tp / knownProbes : 0, falsePositiveRate: strangerProbes ? fp / strangerProbes : 0 }
      : undefined;
  return { command: cmd, n: manifest.length, accuracy: manifest.length ? pass / manifest.length : null, extra };
}

export async function computeDatasetMetrics(opts: { datasetsDir?: string } = {}): Promise<DatasetMetrics> {
  const dir = opts.datasetsDir ?? import.meta.dir;
  const live = process.env.RUN_LIVE === "1" && Boolean(config.openRouterApiKey);

  const byCommand: Record<string, CommandDatasetResult> = {};
  for (const cmd of DATASET_COMMANDS) {
    const manifest = await loadManifest(`${dir}/${cmd}`);
    if (!live || manifest.length === 0) {
      byCommand[cmd] = { command: cmd, n: manifest.length, accuracy: null };
      continue;
    }
    byCommand[cmd] = await scoreCommand(cmd, `${dir}/${cmd}`, manifest);
  }
  return { live, byCommand };
}

async function main(): Promise<void> {
  const m = await computeDatasetMetrics();
  console.log(`Dataset runner — live=${m.live}`);
  for (const cmd of DATASET_COMMANDS) {
    const r = m.byCommand[cmd]!;
    const acc = r.accuracy != null ? `${(r.accuracy * 100).toFixed(0)}% (n=${r.n})` : `needs-data (staged ${r.n})`;
    console.log(`  ${cmd.padEnd(20)} ${acc}`);
  }
  if (!m.live) {
    console.log("\nAccuracy is needs-data until RUN_LIVE=1 + OPENROUTER_API_KEY (+ AWS for face) and a populated manifest.");
    console.log("Latency per command is needs-device — capture it on Mentra Live (see testing/datasets/README.md).");
  }
}

if (import.meta.main) main();
