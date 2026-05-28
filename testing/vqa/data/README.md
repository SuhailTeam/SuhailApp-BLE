# VQA test data

Labeled (image, question) pairs for the visual-question-answering runner:
`testing/vqa/run.ts`.

The runner feeds each pair to the **real** production service
(`answerVisualQuestion` in `src/services/vision-service.ts`) and captures the
free-text answer. **No accuracy number is fabricated** — VQA answers are free
text, so the runner labels output as **"correctness needs human grading"** and
only reports an optional keyword-hit heuristic. If this folder contains only
this README, the runner prints
`no test data found in testing/vqa/data — see README` and exits 0.

## Layout

```
testing/vqa/data/labels.csv  + <image files>
```

## Label scheme: `labels.csv`

Header row with these **exact columns** (`expectedKeywords` is optional):

```csv
filename,question,expectedKeywords
desk_001.jpg,How many cups are on the table?,two|2
door_002.jpg,Is the door open or closed?,closed
sign_003.jpg,What does the sign say?,
```

- `filename` — image file name relative to this folder.
- `question` — the question to ask, in plain text. Quote it if it contains a
  comma.
- `expectedKeywords` — optional `|`-separated keywords. If the answer contains
  ANY of them (case-insensitive substring), the sample counts as a keyword hit.
  This is a **loose sanity check only**, not a correctness score.

## Image format (match production capture)

- Resolution **1920×1080**, **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner handles this.

## Sample sizes

- **≥ 50 (image, question) pairs**, 100 preferred, across varied question
  types (counting, yes/no, identification, spatial).

## Metric

- **Pipeline output captured — correctness needs human grading.** The runner
  records every answer for a human reviewer to grade.
- **Keyword-hit heuristic** (optional) — fraction of answers containing any
  expected keyword. Reported but explicitly **not** an accuracy metric.

## Output

Results written to `testing/results/vqa_accuracy_<timestamp>.json` plus a
matching `.md` (a table of every question + captured answer for review);
summary printed to console.
