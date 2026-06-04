# Per-command functional dataset (report Table 13.12 / Table 39)

Labeled-dataset harness for the 8 voice commands. It scores the **real**
`src/services/{vision,face}-service` functions against ground truth. Until a
manifest is populated and run with keys, every accuracy cell reads `needs-data`
and every latency cell reads `needs-device` — never an invented number.

## Run

```bash
bun testing/datasets/run.ts               # reports staged-row counts; accuracy = needs-data
RUN_LIVE=1 bun testing/datasets/run.ts    # scores against the live services (costs OpenRouter/AWS)
```

`run_all.ts` imports `computeDatasetMetrics`, so a full `bun run test:harness` fills
Table 13.12 automatically the moment a manifest + `RUN_LIVE=1` + keys are present.

Gating: live scoring needs `RUN_LIVE=1` **and** `OPENROUTER_API_KEY` (vision commands).
The two face commands additionally need AWS Rekognition credentials; if a command's every
row errors (e.g. no AWS), that command stays `needs-data` rather than reporting a false 0%.

## Layout

```
datasets/<command>/
├── manifest.jsonl     # one JSON object per line (the ground truth). Empty = needs-data.
└── images/            # input images referenced by manifest "file"
```

Commands (dir names = `CommandType`): `scene-summarize`, `ocr-read-text`, `face-recognize`,
`face-enroll`, `find-object`, `currency-recognize`, `visual-qa`, `color-detect`.

## Manifest format per command

One JSON object per line in `manifest.jsonl`. `file` is relative to that command's `images/`.

```jsonc
// scene-summarize     → describeScene(); pass if the description contains ANY keyword
{"file": "kitchen.jpg", "language": "en", "expected": {"anyOf": ["kitchen", "مطبخ", "sink"]}}

// ocr-read-text       → extractText(); pass if it contains ALL substrings (normalized)
{"file": "menu_en.jpg", "expected": {"contains": ["coffee", "tea"]}}

// color-detect        → detectColor(); pass if colorName contains ANY name (lang-aware)
{"file": "red_shirt.jpg", "expected": {"anyOf": ["red", "أحمر"]}}

// find-object         → detectObject(target); found matches, and if found, location has a keyword
{"file": "keys_desk.jpg", "target": "keys", "expected": {"found": true, "locationContains": ["desk", "left"]}}

// currency-recognize  → recognizeCurrency(); exact ISO code + total within tolerance
{"file": "sar_50_x3.jpg", "expected": {"currency": "SAR", "total": 150, "tolerance": 0}}

// visual-qa           → answerVisualQuestion(question); answer contains ANY expected substring
{"file": "door.jpg", "question": "is the door open", "expected": {"contains": ["yes", "open", "نعم"]}}

// face-recognize      → recognizeAllFaces(); expected name present, or null = stranger (no known face)
{"file": "alice_2.jpg", "expected": "Alice"}
{"file": "stranger.jpg", "expected": null}

// face-enroll         → enrollFace(name) then recognizeAllFaces(probe); probe must come back as the name
{"file": "bob.jpg", "name": "Bob", "probe": "bob_again.jpg", "expected": "Bob"}
```

`expected` keys by scorer (see `score.ts`): `anyOf` (≥1 keyword), `contains` (all substrings),
`{currency,total,tolerance}`, `{found,locationContains}`, a bare name / `null` for faces.
`face-recognize` also reports recall + false-positive rate in `extra`.

## Latency is `needs-device` — capture it on Mentra Live, do not synthesize

Per-command end-to-end latency cannot be measured off-device. Capture it on the glasses:

1. Run the 8 tasks on a paired Mentra Live using the app (Settings → Testing).
2. The app's latency timeline (`mobile/src/utils/timeline.ts`) records each turn; the
   usability log exports `total_s` (wake → speech end) and `timeToFirstWord_s` per command.
3. **Export CSV** and drop it into `testing/usability/sessions/`. The per-command `total_s`
   median (`testing/usability/analyze.ts` → "Per command" table) is the E2E latency to paste
   into Table 13.12's latency column.
