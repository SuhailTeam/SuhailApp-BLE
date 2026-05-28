# Currency test data

Labeled cash photos for the currency-counting accuracy runner:
`testing/currency/run.ts`.

The runner feeds each image to the **real** production service
(`recognizeCurrency` in `src/services/vision-service.ts`) and scores the
predicted per-denomination counts against ground truth. **No numbers are
fabricated** — if this folder contains only this README, the runner prints
`no test data found in testing/currency/data — see README` and exits 0.

## Layout

```
testing/currency/data/labels.csv      + <positive image files>
testing/currency/data/negative/labels.csv + <non-currency image files>
```

- Positive images go directly in `data/` (single-denomination AND
  mixed-denomination photos both live here — mixed is just multiple entries in
  the `bills` cell).
- Negative images (no money at all) go in `data/negative/`.

## Label scheme: `labels.csv`

Header row with these **exact columns**:

```csv
filename,bills
cash_500x3_001.jpg,500x3
mixed_002.jpg,500x2;100x3;50x1
single_50_003.jpg,50x1
```

- `filename` — image file name relative to the same folder.
- `bills` — semicolon-separated `DENOMINATIONxCOUNT` entries. Denomination is the
  numeric face value only (e.g. `500`, not `500 SAR`). Example: `500x2;100x3`
  means two 500 notes and three 100 notes.

For `negative/labels.csv`, leave `bills` empty:

```csv
filename,bills
keys_001.jpg,
book_002.jpg,
```

## Image format (match production capture)

- Resolution **1920×1080**, **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner handles this.

## Sample sizes

- **≥ 50 positive photos per denomination**, 100 preferred. Include
  mixed-denomination photos.
- `negative/`: **at least 10** non-currency items.

## Metrics computed

- **Per-denomination exact-count accuracy** — for each denomination appearing in
  expected or predicted for a photo, the predicted count must exactly equal the
  ground-truth count. Aggregated per denomination across all photos.
- **Whole-photo exact match** — fraction of photos where every denomination's
  count matched exactly.
- **False-positive rate (negatives)** — fraction of non-currency images where the
  service returned ≥ 1 bill. Reported as a separate row.

Predicted bills include any `otherCurrencies` the service reports, so a
wrong-currency guess is not silently ignored.

## Output

Results written to `testing/results/currency_accuracy_<timestamp>.json` plus a
matching `.md`; summary printed to console.
