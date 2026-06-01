# Measurement harness (report Tables 13.12 & 13.13)

Automates the *functional* numbers as far as is honestly possible. Each metric is
classified by what it needs:

- **A — offline / deterministic:** computed with no key and no dataset. Real number now.
- **B — API key + labeled dataset:** needs a provider key and a curated dataset. The
  runner computes the number when both are present, else reports `needs data collection`.
- **C — physical glasses:** end-to-end / photo / cue latency. Captured on-device via the
  mobile latency timeline + the usability CSV export (PR #37). Reported `needs device`.
- **D — human participants:** usability (Table 13.14). Reported `needs participants`.

## Run

```bash
bun run testing/run_all.ts            # suites + offline metrics → testing/results/section13_results.md
RUN_LIVE=1 bun run testing/run_all.ts # also runs the API-key accuracy tier (costs OpenRouter credits)
```

`RUN_LIVE=1` requires `OPENROUTER_API_KEY` (and AWS keys for face accuracy) in the
environment / `.env`. Without it, accuracy/latency cells stay `needs data collection`
so the report never shows an invented number.

## Datasets (you grow these)

The seed sets are tiny — enough to prove the pipeline. Expand them for a defensible
sample size, then re-run.

### Intent — `testing/harness/intent/test_set.jsonl`
One JSON object per line:
```json
{"text": "what is in front of me", "expected": "scene-summarize", "keyword": false}
```
- `expected`: the target `CommandType` (or `unknown`).
- `keyword`: `true` if the utterance starts with an explicit trigger word (so it should
  take the R1 fast-path). Used to verify the keyword-fast-path classification.

### Vision — `testing/harness/datasets/<area>/` (area = scene|ocr|color|object|currency|vqa)
Put input images as `*.jpg` and a sibling `labels.jsonl`:
```json
{"file": "bill_50_x3.jpg", "expected": {"currency": "SAR", "total": 150}}
{"file": "menu_en.jpg", "expected": {"textContains": "coffee"}}
```
The runner base64-encodes each image, calls the matching `vision-service` function, and
scores against `expected` (exact / contains / numeric tolerance per area).

### Face — `testing/harness/datasets/face/`
`enroll/<name>.jpg` (one per known person) + `probe/labels.jsonl`:
```json
{"file": "alice_2.jpg", "expected": "Alice"}
{"file": "stranger.jpg", "expected": null}
```
The runner enrolls the `enroll/` set into a throwaway Rekognition collection, recognizes
each probe, computes recall + false-positive rate, then drops the collection.
