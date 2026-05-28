# Tier 4 — On-device latency instrumentation

This tier turns a **human-run hardware trial** into automatically-recorded
latency data, so the GP2 latency cells (Table 13.10 latency; Table 13.11
pre-capture + cue rows) come from real measurement, not a stopwatch.

## How it works

`mobile/src/perf/perf-logger.ts` is a session-scoped `PerfLogger`. It timestamps
each stage of a command (`span()` reads the clock **before** the awaited call and
**after** it resolves, so the recorded duration is true wall time). Spans are
buffered in memory and written once on session end by
`mobile/src/perf/session-perf.ts` to:

```
<documentDirectory>/logs/perf/<YYYY-MM-DD>/<sessionId>-<epoch>.jsonl
```

one JSON record per line: `{ session, commandSeq, name, start, end, durationMs, meta }`.

It is gated by `EXPO_PUBLIC_PERF_LOGGING` (default **on** in dev, off otherwise),
so it is a no-op in production unless explicitly enabled. Overhead is an array
push per span plus one file write at flush — no synchronous IO in the hot path.

### Span names (the wake→speech path, GP2 §7)

`listening.idle_to_active`, `listening.active_to_processing`, `precapture.photo`,
`transcription.received`, `transcription.normalize`, `intent.classify`
(+ `meta.fallbackUsed`), `handler.process`, `relay.request` (per command),
`vision.llm_call`, `face.detect`, `face.search` (+ `meta.faceIndex`),
`tts.fetch`, `tts.playback_start`, `cue.play`, `command.total`.

`command.total` carries `meta.command` (which command) and, for the A/B test,
`meta.precaptureDisabled`.

## Collecting data (human, on Mentra Live)

1. Build the mobile app with `EXPO_PUBLIC_PERF_LOGGING=1`.
2. Run each voice command ≥ 10 times (the report **gates any row with N < 10**).
3. For the pre-capture A/B, run a second batch with `DISABLE_PRECAPTURE=1`.
4. Copy the device's `logs/perf/` into this repo's `logs/perf/`
   (gitignored — raw measurement data is not committed).

## Aggregating

```bash
bun run testing/perf/report.ts          # per-command median/p95/p99/N, cold vs warm,
                                         # per-stage, wall-time vs raw-compute
bun run testing/perf/precapture_ab.ts   # command.total delta with/without pre-capture
```

Both write into `testing/results/` and are also invoked by `testing/run_all.ts`.
With no logs present they print **needs measurement** and exit 0 — they never
invent numbers.

## Wall-time vs raw compute

Pre-capture and the multi-face searches run in parallel, so the sum of raw stage
durations can exceed `command.total` (wall time). The report shows both and the
ratio; the gap is the parallelism win. Wall-time shares never silently exceed
100%.

## Latency budgets (Section 5.2 / 13.5)

Acknowledgement cue: **sub-second**. Complete spoken response: **a few seconds**.
The report records measured values against these; it does not assert pass/fail on
aspirational targets.

## Wiring status

The `PerfLogger` module + aggregators + the boundary-correctness regression test
(`mobile/testing/unit/perf-logger.test.ts`, the 500 ms check) are complete and
green offline. Wiring the `span()` calls into the live listening/command path is
a low-risk, env-gated edit done at the start of the hardware-trial phase (the
spans are no-ops until `EXPO_PUBLIC_PERF_LOGGING` is set). See §12 of
`testing/results/gp2_test_results.md`.
