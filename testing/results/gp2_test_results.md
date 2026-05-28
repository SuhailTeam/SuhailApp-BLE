# Suhail GP2 — Automated Test Results
Generated: 2026-05-28T22:54:39.574Z   Git: worktree-gp2-testing@34871ff
Mobile: expo ~52.0.0, RN 0.76.5   Relay: bun 1.3.10
Vision model: google/gemini-2.5-flash-lite (default)   AWS region: us-east-1 (default)   Rekognition collection: suhail-faces (default)
Intent runs aggregated: see Tier 3 section   Test-set hashes: see testing/intent/

> Regenerate with `bun run testing/run_all.ts`. Tier 1 + Tier 2 numbers are computed live and run offline (no network, no keys). Tier 3 (accuracy) needs labeled data / an API key; Tier 4 (latency) needs on-device logs — those cells say **needs measurement / needs data collection** until collected. **No number in this file is fabricated.**

---

## 1. Unit tests → Table 13.9
Offline, adapters stubbed at the boundary. Per-module test count + pass rate.

| Module | Case IDs covered | Tests | Pass rate | |
|---|---|---|---|---|
| IntentRouter keyword matcher | §4.5 EP (ar/en triggers) | 18 | 100% | ✅ |
| IntentRouter.classify decision table | DT-R1…R5 | 8 | 100% | ✅ |
| Arabic-script normalization | §4.7 + fallback | 14 | 100% | ✅ |
| Currency per-denomination tally | EP-08, EP-09 | 7 | 100% | ✅ |
| color-detect extraction | EP-10 | 5 | 100% | ✅ |
| ExternalImageId hex round-trip | §4.11 | 14 | 100% | ✅ |
| Scribe annotation stripping (relay) | BLE-08, BLE-09 | 4 | 100% | ✅ |
| ListeningStateMachine.transition | ST-L1, ST-L2 | 4 | 100% | ✅ |
| Grace + TTS echo filters | ST-G1/BV-04, ST-G2/BV-07 | 6 | 100% | ✅ |
| Active-window timeout | BV-01, BV-02, BV-03 | 3 | 100% | ✅ |
| Face-enrollment flow | ST-E1, ST-E2/BV-08, ST-E3 | 4 | 100% | ✅ |
| OCR cap enforcement | BV-09, BV-10 | 5 | 100% | ✅ |
| Scribe annotation stripping (mobile) | BLE-08, BLE-09 | 13 | 100% | ✅ |
| PerfLogger boundary (Tier 4 regression) | §7 500 ms verify | 8 | 100% | ✅ |

**Tier 1 totals: 113 tests, 100% pass (0 failing).**

\* Divergences found and tested-as-actual (see §6 Divergences): DT-R2 / DT-R5 (router), BV-04 grace (mobile), ST-L2/BV-03 cancelled-cue (mobile), BLE-06 (no timestamp). The tests assert ACTUAL behaviour and the divergences are documented — they are not failures.

## 2. Relay integration → Table 13.11 (HMAC + photo-token rows)
In-process Express app, real HTTP, real HMAC verifier. No glasses/phone.

| Module | Case IDs | Tests | Pass rate | |
|---|---|---|---|---|
| HMAC device-auth | BLE-04, BLE-05, BLE-06* | 8 | 100% | ✅ |
| Photo-token lifecycle + 60 s TTL | BLE-01, BLE-02 | 8 | 100% | ✅ |
| Long-poll + outer timeouts | BLE-03 | 5 | 100% | ✅ |

**Tier 2 totals: 21 tests, 100% pass (0 failing).**
Invalid-signature rejection rate: **100%** (100/100 random tokens rejected — see hmac.test.ts).

## 3. Intent classifier → Table 13.11 (router rows) + DT-R1
OPENROUTER_API_KEY not set — intent accuracy needs network; see testing/intent/README.md.
The production router calls OpenRouter to classify intent, so this harness cannot measure accuracy without a key + network. Exiting cleanly without writing any results (no fabricated numbers).

## 4. Component accuracy → Table 13.10 (recognition) + 13.5
Each runner calls the production service directly and scores vs ground truth.
- **ocr**: no test data found in testing/ocr/data — see testing/ocr/data/README.md
- **face**: no test data found in testing/face/data — see testing/face/data/README.md
- **currency**: no test data found in testing/currency/data — see testing/currency/data/README.md
- **color**: no test data found in testing/color/data — see testing/color/data/README.md
- **vqa**: no test data found in testing/vqa/data — see testing/vqa/data/README.md
- **scene**: no test data found in testing/scene/data — see testing/scene/data/README.md

(Empty data dirs ⇒ "no test data found" ⇒ **needs data collection**. See each `testing/<feature>/data/README.md` for the collection protocol.)

## 5. Latency → Table 13.10 (latency) + Table 13.11 (pre-capture, cue rows)
## Tier 4 — Latency (perf instrumentation)

**needs measurement** — no perf logs found in `logs/perf/`.

These numbers are produced by a human-run hardware trial: enable
`EXPO_PUBLIC_PERF_LOGGING=1` in the mobile build, run each command on real
Mentra Live glasses, copy the on-device `logs/perf/<date>/*.jsonl` into this
repo's `logs/perf/`, then re-run `bun run testing/perf/report.ts`.
See `testing/perf/README.md`.

## Tier 4 — Pre-capture A/B

**needs measurement** — insufficient tagged trials (pre-capture on: 0, off: 0; need >= 5 per arm).

Collect on hardware: run trials normally, then again with `DISABLE_PRECAPTURE=1`
in the mobile build. The PerfLogger tags each `command.total` with
`meta.precaptureDisabled`. Copy `logs/perf/` here and re-run this script.

## 6. Divergences from the design docs (verify-don't-assume findings)
These were found by reading the code; the tests assert the ACTUAL behaviour and these are documented, not fixed (per "do not tune to the spec"):
1. **Router DT-R2** — when the LLM returns `unknown`, the router returns `unknown` and does NOT consult the keyword table (fallback runs only when the LLM CALL fails/times out). Design Table 13.7 R2 assumed keyword recovery.
2. **Router DT-R5 / keyword "no-match"** — the keyword fallback has no "no match"; its catch-all is `visual-qa`, never `unknown`.
3. **Grace window BV-04 (mobile)** — `LISTENING_GRACE_MS` is vestigial in the mobile build (`activatedAt` is set but never read). The grace gate exists only in the cloud app (src/app.ts:415). The BLE app batch-captures audio, so there is no streaming transcription to grace-reject.
4. **Active-timeout cue BV-03 (mobile)** — on the 10 s failsafe the mobile machine speaks "didn't catch that" and returns to idle; it does NOT emit a "cancelled" cue (that cue is only on explicit user cancel).
5. **HMAC BLE-06** — the bearer token is a static HMAC(deviceId, secret) with NO timestamp/nonce, so there is no clock-skew window and no replay protection (by design — "soft rate-limiter, not real auth").
6. **`stripAnnotations` nesting** — the regex is non-recursive; nested annotations leave a dangling tail (minor; flat/multiple annotations handled correctly).

## 7. Manual (not run here) → Table 13.10 success columns, BLE-07/10, Table 13.12
Human-run by design — **needs measurement**:
- Live end-to-end functional **success** per command (UC-* rows): real glasses, BLE pairing, real ElevenLabs STT on spoken audio, physical pages/faces/SAR notes/objects.
- **BLE-07** mid-command disconnect; **BLE-10** A2DP audio routing (perceptual).
- All of **Table 13.12** usability (participants, SUS in Arabic, task success/time, interviews, counterbalanced order, consent, qualitative coding).
Protocol pointer: Section 13.6.

## 8. ID → Section 13 cell mapping
| Section 13 cell | Source | Value |
|---|---|---|
| 13.9 ListeningStateMachine.transition / count, pass | unit (mobile) | run `bun run testing/run_all.ts` → §1 row |
| 13.9 each module count + pass rate | unit | §1 table (computed live) |
| 13.11 HMAC accept/reject | relay integration | §2 (100% reject) |
| 13.11 photo-token TTL (60 s boundary) | relay integration | §2 photo-token row |
| 13.11 long-poll/outer timeout (20 s/25 s) | relay integration | §2 timeouts row |
| 13.11 Router R1 accuracy (mean±σ) | intent harness | §3 (needs API key) |
| 13.11 fallback / clarification rate | intent harness | §3 (path-split is a documented limitation) |
| 13.10 OCR CER/WER (en/ar/mixed) | OCR harness | §4 (needs data collection) |
| 13.10 Face precision/recall/FAR | face harness | §4 (needs data collection) |
| 13.10 Currency per-denomination | currency harness | §4 (needs data collection) |
| 13.5 Color correctness | color harness | §4 (needs data collection) |
| 13.10 per-command latency (median/p95/p99) | perf report | §5 (needs device logs) |
| 13.11 pre-capture A/B delta | perf precapture_ab | §5 (needs device logs) |
| 13.10 success rate (UC-*) | MANUAL | needs measurement |
| 13.10 BLE-07 / BLE-10 | MANUAL | needs measurement |
| 13.12 (all usability) | MANUAL | needs measurement |

## 9. Methodology notes
- **Runner:** `bun test` in both packages; mobile native packages (MMKV, Bluetooth SDK, expo-audio) stubbed via `mobile/testing/preload.ts`; relay LLM/HTTP stubbed at `fetch`.
- **Timing:** `setSystemTime` for Date.now() boundaries (60 s photo TTL), jest fake timers for setTimeout boundaries (echo 1.5 s, active 10 s, enrollment 30 s, classify 3 s, long-poll). **No injectable-clock change to production was needed** — fake timers + the existing structure sufficed.
- **One production change:** `encodeName`/`decodeName` in `src/services/face-service.ts` were exported (previously private) for the §4.11 round-trip test. Backward-compatible, no behaviour change.
- **Intent set** is author-curated (self-graded limitation); **vision sets** are team-collected; runs-per-measurement and conditions recorded by each harness.
- **Not committed:** generated logs, raw images (`testing/**/data/`), result JSON. Committed: this report, the harness code, and the data READMEs.
- **CI:** Tiers 1–2 (offline) are CI-safe; Tiers 3–4 (need data/hardware) must NOT run in CI.

_Last regenerated: 2026-05-28T22:54:39.574Z_
