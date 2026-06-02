# Suhail test suite (report Chapter 13)

Our own automated suite, independent of the abandoned PRs #20/#35. It tests the
**real** production modules (no server-side stand-ins) and **never invents a
number** — anything not computable offline is reported as needs-data /
needs-device / needs-participants.

## Layout

```
testing/                      # server / relay (Bun test, run from repo root)
├── preload.ts                # pins dummy keys so suites never hit live APIs
├── helpers/                  # OpenRouter fetch mock + in-process relay app
├── unit/                     # Tier 1 → report Table 13.9
├── integration/              # Tier 2 → Table 13.10 (in-process Express, real HTTP)
├── regression/               # Tier 3 → Table 13.11
├── harness/                  # Tier 4 measurement (intent keyword/LLM metric)
├── datasets/                 # Tier 4b per-command accuracy harness → Table 13.12 (see datasets/README.md)
├── usability/                # Table 13.14 analyzer: sessions/ + sus/ → usability_table41.md (see usability/README.md)
├── run_all.ts                # runs Tiers 1–3 + 4a → results/section13_results.md
└── results/                  # section13_results.md + usability_table41.md (paste into the report)

mobile/testing/               # mobile app (Bun test, run from mobile/)
├── preload.ts                # stubs native modules (BLE SDK, expo-*, MMKV, RN)
├── helpers/listening-harness.ts   # drives the REAL listening machine w/ mocked IO
├── unit/                     # enrollment, transcription-filter, OCR cap, i18n, timeline
└── state-machine/            # listening machine (separate process — global mocks)
```

## Run

```bash
# Server (from repo root)
bun run test            # unit + integration + regression (product tests → Tables 13.9–13.11)
bun run test:harness    # + offline metrics → testing/results/section13_results.md
bun run test:tooling    # unit tests for the usability + dataset analysis code (not a product table)
bun run testing/usability/analyze.ts   # Table 13.14 from sessions/ + sus/ → results/usability_table41.md
bun testing/datasets/run.ts            # per-command dataset accuracy (RUN_LIVE=1 to score live)

# Mobile (from mobile/)
cd mobile && bun run test

# Typecheck (prod + test configs)
bun run typecheck && bun run typecheck:test
cd mobile && bun run typecheck && bun run typecheck:test
```

CI runs all of the above on push/PR (`.github/workflows/test.yml`); the
API-key accuracy tier (Tier 4b) is a manual `workflow_dispatch` job.

## Two gotchas (if you add tests)

- **Path scoping:** always prefix `bun test` paths with `./` (e.g. `./testing/unit`).
  Bun treats a bare path as a substring filter, so from the repo root `testing/unit`
  also matches `mobile/testing/unit` and runs mobile files under the wrong preload.
- **Global mocks:** `mock.module` is process-global. The listening suite mocks
  modules other suites import for real, so it lives in `mobile/testing/state-machine/`
  and runs as a **separate** `bun test` process.

## Fidelity (vs the abandoned PR #35)

Where a pure helper was module-private, we added `export` to the real module and
test that — we do **not** reimplement logic as a server-side stand-in. Export-only
edits: `command-router` (`matchKeywordCommand`), `vision-service`
(`parseCurrencyResponse`/`cleanJSON`/lang helpers), `face-service`
(`encodeName`/`decodeName`/`getSimilarityThreshold`), and a pure `formatOcrResult`
extracted in `mobile/src/commands/read.ts`.
