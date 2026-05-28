# Color test data

Labeled images for the color-detection accuracy runner: `testing/color/run.ts`.

The runner feeds each image to the **real** production service
(`detectColor` in `src/services/vision-service.ts`) and scores the predicted
dominant color against ground truth. **No numbers are fabricated** — if this
folder contains only this README, the runner prints
`no test data found in testing/color/data — see README` and exits 0.

## Layout

```
testing/color/data/labels.csv          + <single-color image files>
testing/color/data/negative/labels.csv + <multi-color scene image files>
```

- Positive images (one clear dominant color) go directly in `data/`.
- Negative images (multi-color scenes, no single dominant color) go in
  `data/negative/`.

## Label scheme: `labels.csv`

Header row with these **exact columns** (`hex` is optional but recommended):

```csv
filename,colorName,hex
red_mug_001.jpg,red,#cc1f1f
navy_shirt_002.jpg,blue|navy|dark blue,#1a2a5e
green_apple_003.jpg,green,
```

- `filename` — image file name relative to the same folder.
- `colorName` — the ground-truth color name in **English**. List several
  acceptable names separated by `|` (e.g. `blue|navy|dark blue`) — any one of
  them matching counts as correct.
- `hex` — optional ground-truth hex (`#rrggbb` or `#rgb`). Used only as a
  fallback when the name does not match.

For `negative/labels.csv`, `colorName` and `hex` may be left empty (they are not
scored):

```csv
filename,colorName,hex
street_scene_001.jpg,,
fruit_bowl_002.jpg,,
```

## Matching rule (how "correct" is decided)

A prediction counts as correct if **either**:
1. **Name match** — predicted `colorName` matches a label name
   (case-insensitive, trimmed; substring either direction; `|`-separated
   alternatives all accepted), OR
2. **Hex tolerance** — a ground-truth `hex` is provided AND the predicted hex is
   within **Euclidean RGB distance 60** (on the 0–255 axis) of the label hex.

Name match is primary; hex is the fallback so a correct color with a
differently-worded name still counts.

## Image format (match production capture)

- Resolution **1920×1080**, **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner handles this.

## Sample sizes

- **≥ 50 single-color images per condition**, 100 preferred. Spread across
  common color names.
- `negative/`: **at least 10** multi-color scenes.

## Metrics computed

- **Dominant-color accuracy** — fraction of single-color images matched by the
  rule above.
- **Negatives** — multi-color scenes have no single correct dominant color, so
  the runner does **not** assign a correctness score; it captures the pipeline
  output for human review (separate row).

## Output

Results written to `testing/results/color_accuracy_<timestamp>.json` plus a
matching `.md`; summary printed to console.
