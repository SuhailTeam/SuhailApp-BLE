# Scene description test data

Labeled scene images for the scene-description runner: `testing/scene/run.ts`.

The runner feeds each image to the **real** production service
(`describeScene` in `src/services/vision-service.ts`) and captures the
free-text description. **No accuracy number is fabricated** — scene
descriptions are free text, so output is labeled **"correctness needs human
grading"** and only a keyword-coverage heuristic is reported. If this folder
contains only this README, the runner prints
`no test data found in testing/scene/data — see README` and exits 0.

## Layout

```
testing/scene/data/labels.csv  + <image files>
```

## Label scheme: `labels.csv`

Header row with these **exact columns** (`expectedKeywords` is optional but
recommended):

```csv
filename,expectedKeywords
kitchen_001.jpg,kitchen|counter|sink
office_002.jpg,desk|laptop|chair
street_003.jpg,
```

- `filename` — image file name relative to this folder.
- `expectedKeywords` — optional `|`-separated salient elements that a good
  description should mention (objects, setting). Used only for a loose
  keyword-coverage proxy, **not** a correctness score.

## Image format (match production capture)

- Resolution **1920×1080**, **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner handles this.

## Sample sizes

- **≥ 50 scene images**, 100 preferred, across varied settings (indoor,
  outdoor, crowded, empty).

## Metric

- **Pipeline output captured — correctness needs human grading.** The runner
  records every description for a human reviewer to grade.
- **Keyword-coverage heuristic** (optional) — mean fraction of expected
  keywords mentioned in the description. Reported but explicitly **not** an
  accuracy metric.

## Output

Results written to `testing/results/scene_accuracy_<timestamp>.json` plus a
matching `.md` (a table of every image + captured description for review);
summary printed to console.
