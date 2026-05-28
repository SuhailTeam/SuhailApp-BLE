# Tier 3a — Intent Classifier Accuracy Harness

Measures the accuracy of Suhail's **production** voice-command intent router
(`src/commands/command-router.ts`) on an author-curated labelled corpus, plus an
out-of-domain (OOD) rejection set. The harness imports and calls the real
`routeCommand()` — it does **not** reimplement classification.

```
import { routeCommand } from "../../src/commands/command-router";
// routeCommand(transcription: string, signal?: AbortSignal): Promise<RouteResult | null>
// RouteResult = { command: CommandType; params?; rawText: string }
```

`command` is one of exactly nine strings: `scene-summarize`, `ocr-read-text`,
`face-recognize`, `face-enroll`, `find-object`, `currency-recognize`,
`color-detect`, `visual-qa`, `unknown`.

## Files

| File | Purpose |
| --- | --- |
| `test_set.jsonl` | Labelled in-domain utterances (8 intents × 2 languages). |
| `out_of_domain.jsonl` | Utterances that should map to **no** visual intent. |
| `run.ts` | The harness. Computes metrics at runtime, writes artifacts. |

### `test_set.jsonl` schema
```json
{"utterance":"...", "language":"en|ar", "expected_intent":"<command string>",
 "acceptable_intents":["..."], "source":"author-curated"}
```
- `expected_intent` is one of the **8 non-`unknown`** command strings.
- `acceptable_intents` is used only for genuinely ambiguous items (e.g.
  `"what color is the sky"` → `["color-detect","visual-qa"]`). Kept under ~5% of
  items. A prediction counts as correct if it is in `acceptable_intents`.

Corpus size: 8 intents × 2 languages, ~15–16 utterances per intent per language
(canonical, colloquial, and indirect phrasings). Arabic in real Arabic script.

### `out_of_domain.jsonl` schema
```json
{"utterance":"...", "language":"en|ar", "source":"author-curated"}
```
~100 utterances that are unrelated ("what time is it"), near-miss ("what's the
weather outside"), or conversational ("thanks", "never mind"). A **true
rejection** is the router returning `command: "unknown"`.

## How to run

The router calls OpenRouter, so a key + network are **required**:

```bash
OPENROUTER_API_KEY=sk-... bun run testing/intent/run.ts
RUNS=10 OPENROUTER_API_KEY=sk-... bun run testing/intent/run.ts   # override run count
```

- `RUNS` (env, default `5`) — how many times the full corpus is replayed. The
  LLM classifier is **non-deterministic**, so we run N times and report
  mean ± σ.
- With **no** `OPENROUTER_API_KEY`, the harness prints a "needs network" message
  and exits `0` **without** writing any results — it never fabricates numbers.

This is a plain Bun script, not a unit test. Do **not** run it via `bun test`.

## What it computes (all at runtime)

- **Overall accuracy** mean ± σ across the N runs, plus EN and AR splits.
- **Per-intent precision / recall / F1**, split EN and AR, aggregated over runs
  (one-vs-rest; a miss to `unknown` counts against recall).
- **OOD handling**: the OOD→command distribution and the rejection rate
  (fraction predicted `unknown`), mean ± σ.
- **Confusion matrices**, split EN and AR.
- **Stability flag**: any per-intent F1 whose per-run σ > 0.05 is flagged.

## Outputs

Written under `testing/results/` (timestamped via `new Date().toISOString()`):

- `intent_accuracy_<ts>.json` — all metrics + per-run series + confusion matrices.
- `intent_misclassifications_<ts>.md` — every miss
  (utterance, language, expected, predicted) grouped by `expected -> predicted`,
  followed by the EN/AR confusion matrices.

## Measurement limitation (read before quoting numbers)

`routeCommand()` returns only `{ command, params, rawText }`. It does **not**
expose whether the **LLM path** or the **keyword-fallback path** produced a given
result. The fallback fires only when the LLM call fails/times out, and its
catch-all turns any non-trigger utterance into `visual-qa` (never `unknown`).
Because the path is not in the return value:

- **LLM-path accuracy** and **fallback rate cannot be measured** from the return
  alone, and this harness does **not** report them or invent a split.
- Only what is observable end-to-end is reported: overall accuracy, per-intent
  P/R/F1, and OOD rejection.

Additional caveats, stated honestly for the committee:
- **Set quality is self-graded** — the corpus is author-curated, not an
  independent gold standard. We do not tune the router to the set; the set is
  test *data*.
- **LLM non-determinism** — identical inputs can yield different intents run to
  run; the σ figures and the σ>0.05 flag quantify this.

## Mapping to GP2 Table 13.11 (router rows)

| Table 13.11 router row | Source field in this harness |
| --- | --- |
| Overall intent accuracy (± σ) | `accuracy.overall.mean` / `.sigma` (JSON), console "Overall accuracy" |
| EN / AR accuracy | `accuracy.en` / `accuracy.ar` |
| Per-intent F1 (EN / AR) | `perIntent[].f1` (with `.lang`), console "Per-intent ... F1" |
| OOD rejection rate | `ood.rejectionRateMean` / `.rejectionRateSigma` |
| OOD misroute distribution | `ood.distribution` |
| Unstable intents (σ>0.05) | `flaggedUnstableIntents` |
| LLM-path accuracy / fallback rate | **Not measurable** — see limitation above; leave blank / mark N/A |
