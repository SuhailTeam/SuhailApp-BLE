# OCR test data

Labeled images for the OCR (text reading) accuracy runner: `testing/ocr/run.ts`.

The runner feeds each image to the **real** production OCR service
(`extractText` in `src/services/vision-service.ts`) and scores the output
against the ground-truth text. **No numbers are fabricated** — if this folder
contains only this README, the runner prints
`no test data found in testing/ocr/data — see README` and exits 0.

## Subdirectory layout

| Subdir | Contents | Language passed to service |
|--------|----------|----------------------------|
| `en/`      | images containing English text | `en` |
| `ar/`      | images containing Arabic text  | `ar` |
| `mixed/`   | images containing both Arabic + English text | `en` |
| `negative/`| images with **no readable text** (must return empty) | `en` |

Each subdir holds the image files plus a `labels.csv`.

## Label scheme (standardized across all component runners): `labels.csv`

Every data subdir contains a UTF-8 `labels.csv` with a header row and these
**exact columns**:

```csv
filename,text
receipt_en_001.jpg,"Total: 45.00 SAR"
sign_en_002.jpg,Exit
```

- `filename` — the image file name, relative to the same subdir.
- `text` — the ground-truth text, UTF-8. Quote the field if it contains commas
  or newlines (standard CSV double-quote escaping: `""` for a literal quote).
- For the `negative/` subdir, leave `text` empty:

```csv
filename,text
blank_wall_001.jpg,
sky_002.jpg,
```

## Image format (match production capture)

- Resolution: **1920×1080** (the `"large"` size production uses).
- Encoding: **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner does this for you.

## Sample sizes

- **≥ 50 per condition**, 100 preferred.
- `negative/`: **at least 10** no-text images (negative samples).

## Metrics computed

Per condition (`en`, `ar`, `mixed`):
- **CER** — character error rate = Levenshtein(char) / reference char count.
- **WER** — word error rate = Levenshtein(word) / reference word count.

For `negative/`:
- **Hallucination rate** — fraction of no-text images where OCR returned
  non-empty text. Reported as a separate row (CER/WER are not applicable).

Lower is better for all three. Whitespace is normalized (runs collapsed,
trimmed) before scoring.

## Output

Results are written to `testing/results/ocr_accuracy_<timestamp>.json` and a
matching `.md` section, and a summary is printed to the console.
