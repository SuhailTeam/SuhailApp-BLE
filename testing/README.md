# Suhail — GP2 automated testing

This directory is the GP2 (SWE 497) test automation + measurement harness. It
produces **one results file** — [`results/gp2_test_results.md`](results/gp2_test_results.md)
— whose numbers map cell-for-cell onto Section 13 of the GP2 document.

> **The one rule: never invent a number.** Anything not yet computable (no
> hardware, no labeled data, no participants) is written `needs measurement` /
> `needs data collection`. Every committed number is computed live by the
> harness from the real production code.

## Layout

```
testing/
├── unit/                 # Tier 1 — relay-side pure-logic units (root: bun test)
├── integration/          # Tier 2 — relay HMAC / photo-token / timeouts (in-process Express)
├── intent/               # Tier 3a — intent-router accuracy harness + corpora
├── ocr|face|currency|color|vqa|scene/   # Tier 3b — per-feature accuracy runners + data/README
├── perf/                 # Tier 4 — perf report + pre-capture A/B (reads on-device JSONL)
├── tools/                # capture helper for collecting labeled photos
├── helpers/              # shared test helpers (openrouter-mock, relay-app)
├── results/              # gp2_test_results.md (committed) + generated JSON/audits (gitignored)
└── run_all.ts            # regenerates results/gp2_test_results.md from scratch

mobile/testing/           # Tier 1 — mobile-side units (cd mobile && bun test)
├── preload.ts            # stubs native packages (MMKV, Bluetooth SDK, expo-audio)
├── helpers/              # listening harness + async utils
└── unit/                 # listening machine, enrollment, OCR cap, Scribe, PerfLogger
mobile/src/perf/          # Tier 4 — PerfLogger instrumentation module (production)
```

## Running

```bash
# Tier 1 + Tier 2 — offline, no network, no keys, fully green
bun test                         # relay/server units + integration (repo root)
cd mobile && bun test            # mobile units

# Type checking
bun run typecheck                # production src (tsc)
bun run typecheck:test           # relay testing/ harness (tsc -p tsconfig.test.json)
cd mobile && bun run typecheck   # mobile src + testing

# Regenerate the results doc (runs every tier, idempotent)
bun run testing/run_all.ts       # → testing/results/gp2_test_results.md
```

Tier 3 accuracy harnesses need labeled data / an `OPENROUTER_API_KEY`; Tier 4
needs on-device perf logs. Without those they print `needs measurement` and exit
0 — they never crash and never fabricate.

## The tiers

| Tier | What | Needs | Fills |
|---|---|---|---|
| 1 Unit | pure/deterministic logic, adapters stubbed | nothing (offline) | Table 13.9 + listening rows of 13.11 |
| 2 Relay integration | HMAC, token TTL, long-poll/timeout (in-process) | nothing (offline) | HMAC + photo-token rows of 13.11 |
| 3 Accuracy | labeled inputs → production services → score | labeled data (+ API key) | recognition accuracy (13.10), router rows (13.11) |
| 4 Latency | timestamp the real wake→speech path | Mentra Live hardware | latency (13.10), pre-capture/cue (13.11) |
| Manual | live E2E success, BLE-07/10, all usability | hardware + participants | success cols of 13.10, all of 13.12 |

## Conventions

- **Call production code, never reimplement it.** Units drive the real router /
  filter / verifier / services; adapters (OpenRouter, Rekognition, ElevenLabs,
  BLE SDK) are stubbed at their boundary.
- **Case IDs** (ST-*, BV-*, DT-*, EP-*, BLE-*) appear in each test's header and
  in the `run_all` tables so a number traces back to its Section 13 case.
- **Divergences** found while reading the code (where the build differs from the
  design docs) are tested as ACTUAL behaviour and documented in §6 of the
  results doc — not "fixed" to match the spec.

## CI

Tiers 1–2 are CI-safe (offline). Do **not** put Tiers 3–4 in CI (they need data
/ hardware).
