# Usability analysis (report Table 13.14 / Table 41)

Deterministic analysis of the 5 blindfolded usability sessions. Drop the per-participant
data into `sessions/` and `sus/`, then re-run — the script never invents a number, so until
the data lands every cell reads `needs-participants`.

## Run

```bash
bun run testing/usability/analyze.ts     # → testing/results/usability_table41.md + patches Table 13.14
bun run test:harness                      # full Section-13 regen (renders Table 13.14 from the same code)
bun run test:tooling                      # unit tests for the analysis code itself
```

`analyze.ts` writes the standalone `testing/results/usability_table41.md` (paste-ready Table 41)
and surgically replaces only the `## Table 13.14 — Usability` block of
`testing/results/section13_results.md` (it does not touch the suite-count sections).

## Input: session CSVs — `sessions/P1.csv … P5.csv`

Exactly the file the app exports (Settings → Testing → **Export CSV**, see
`mobile/src/state/usabilityLog.ts → buildUsabilityCsv`). One row per **completed command turn**.
Header (the first 7 columns are mandatory and validated against the app's `USABILITY_CSV_HEADER`):

```
iso,task,command,timeToFirstWord_s,endUtterance_to_firstWord_s,total_s,transcript[,success]
```

| Column | Meaning |
|---|---|
| `iso` | ISO timestamp the row was recorded |
| `task` | moderator-set active task label, e.g. `1 · scene-summarize` (the leading number is the counterbalanced order; the tail names the intended command) |
| `command` | the command the app actually routed, e.g. `scene-summarize` |
| `timeToFirstWord_s` | wake (forward swipe) → glasses start speaking, **seconds** (blank if not captured) |
| `endUtterance_to_firstWord_s` | end of the user's speech → glasses start speaking, seconds |
| `total_s` | wake → TTS finished (full cycle), seconds |
| `transcript` | what the participant said (RFC-4180 quoted if it contains a comma/quote/newline) |
| `success` *(optional 8th column)* | moderator grade: `1` = task accomplished, `0` = not. Add it in the Google Sheet before export. |

- Blank numeric cells are treated as missing (excluded from medians), never as `0`.
- **Recoveries per task** = rows beyond the first sharing a `task` label.
- File naming: `P<n>.csv`, one per participant. Expected set is `P1`–`P5`.

## Input: SUS forms — `sus/P1.csv … P5.csv`

One file per participant: a header row and one data row of the ten 1–5 answers.

```
q1,q2,q3,q4,q5,q6,q7,q8,q9,q10
4,2,5,1,4,1,5,2,4,1
```

Scored the standard way: odd items contribute `value−1`, even items `5−value`, summed and ×2.5
→ 0–100 per participant; the study SUS is the mean across participants.

## What it computes

- **Task-success rate** (overall + per command). Source priority: the moderator `success`
  column if present (shown as `(moderator)`); otherwise **derived** — the intended command
  for the task was eventually routed correctly (shown as `(derived)`). A task with neither a
  grade nor a parseable label is excluded (→ `needs-participants`).
- **Time-to-first-spoken-word: median + IQR** — the headline measure. Pooled across every valid
  turn from all participants; per-participant medians are also shown as a consistency check.
- **End-of-speech → first word** and **total-turn** medians.
- **Recoveries per task** (mean, per command).
- **SUS** per participant + mean.

Quantiles use the inclusive / linear-interpolation method (Excel `QUARTILE.INC` == NumPy
`linear` == Hyndman & Fan type 7), so any reader can reproduce them in a spreadsheet.

## Missing / partial data

If `sessions/` or `sus/` is empty or partial, the empty cells read `needs-participants` and the
run prints exactly which `P<n>.csv` files are missing. Present participants still produce real
interim numbers, clearly tagged `INTERIM — incomplete` until all five are in.

## Files

```
usability/
├── analyze.ts      # computeUsabilityMetrics() + renderers + standalone main
├── csv.ts          # RFC-4180 parser + session decoder
├── sus.ts          # SUS decode + scoring
├── stats.ts        # quantile / median / IQR (inclusive method)
├── patch.ts        # targeted "## Table 13.14" section replacement
├── *.test.ts       # unit tests for the above (run via test:tooling)
├── sessions/       # ← drop P1..P5.csv here
├── sus/            # ← drop P1..P5.csv here
└── __fixtures__/   # sample data exercising the populated/derived paths in tests
```
