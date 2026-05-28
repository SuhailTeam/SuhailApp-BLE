# Tier 3b — Component accuracy runners

These runners measure the **real-world accuracy** of each Suhail vision/face
component by feeding **labeled images** to the **actual production services**
and scoring the output against ground truth. They are plain `bun` scripts
(NOT `bun test` files) so they never run during the unit/integration suite.

## Honesty contract (read this first)

A graduation committee reads these results. Therefore:

1. **No number is ever fabricated or hard-coded.** Every metric is computed at
   runtime from real labeled data passed through the real services.
2. Each runner **calls production code directly** (`src/services/vision-service`
   and `src/services/face-service`) — it never reimplements a service. The
   scoring math (CER, WER, precision/recall, etc.) is generic measurement, not a
   reimplementation of the service under test.
3. **Graceful empty-data:** with no labeled samples, each runner prints
   `no test data found in testing/<feature>/data — see README` and exits 0
   **without** touching the network.
4. **Graceful missing creds:** if data exists but the required key/credentials
   are missing, the runner prints a clear message and exits non-zero — it never
   crashes with a stack trace and never invents results.

Data is collected later (by the team / on hardware) — see each feature's
`data/README.md` for the exact format and label scheme.

## Runners

| Feature | Runner | Production call | Metric |
|---------|--------|-----------------|--------|
| OCR | `testing/ocr/run.ts` | `extractText` | CER + WER per `en`/`ar`/`mixed`; hallucination rate on no-text negatives |
| Currency | `testing/currency/run.ts` | `recognizeCurrency` | per-denomination exact-count accuracy + whole-photo exact match; false-positive rate on non-currency negatives |
| Color | `testing/color/run.ts` | `detectColor` | dominant-color correctness (name match OR hex within RGB tolerance 60); multi-color negatives captured for human review |
| Face | `testing/face/run.ts` | `enrollFace` + `recognizeAllFaces` | precision + recall per enrolled identity; false-accept rate on unenrolled distractors and no-face images (separate rows) |
| VQA | `testing/vqa/run.ts` | `answerVisualQuestion` | pipeline output captured — correctness needs human grading; optional keyword-hit heuristic |
| Scene | `testing/scene/run.ts` | `describeScene` | pipeline output captured — correctness needs human grading; optional keyword-coverage heuristic |

VQA and Scene produce free text, so they are **not** auto-scored; they capture
output for human grading and clearly label it as such.

## Required credentials

- **Vision runners** (ocr, currency, color, vqa, scene) need `OPENROUTER_API_KEY`.
- **Face runner** needs AWS credentials (`AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`). It **writes** to the Rekognition
  collection named by `AWS_REKOGNITION_COLLECTION_ID` — point it at a dedicated
  test collection (e.g. `suhail-faces-test`), not production.

See `.env.example` at the repo root for all variables.

## Running

```bash
bun run testing/ocr/run.ts
bun run testing/currency/run.ts
bun run testing/color/run.ts
bun run testing/face/run.ts
bun run testing/vqa/run.ts
bun run testing/scene/run.ts
```

With empty data dirs (the default state) each prints the "no test data found"
message and exits 0.

## Output

Every runner writes:
- `testing/results/<feature>_accuracy_<timestamp>.json` — full machine-readable
  results (per-sample + aggregates),
- `testing/results/<feature>_accuracy_<timestamp>.md` — a human-readable section
  for the report,

and prints a summary to the console. Timestamps use `new Date().toISOString()`.

## Collecting labeled data

Each feature's `testing/<feature>/data/README.md` documents the exact subdir
layout, the `labels.csv` columns, the image format (1920×1080 JPEG, medium
compression — matching production capture), required sample sizes (≥ 50 per
condition, 100 preferred), and the required negative samples.

The shared label scheme is a **`labels.csv`** per data dir (the face runner adds
an `enroll/enroll.csv` for its gallery). A convenience helper,
`testing/tools/capture.ts`, copies an image into the right data dir and appends
a labeled row:

```bash
bun run testing/tools/capture.ts ocr en ~/Desktop/receipt.jpg
```
