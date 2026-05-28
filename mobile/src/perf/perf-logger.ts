/**
 * Session-scoped latency instrumentation (GP2 Tier 4).
 *
 * Purpose: timestamp each stage of a command so a HUMAN-run hardware trial
 * automatically records latency (no stopwatch). Append-only JSONL, one line per
 * span, flushed on session end. Gated by an env flag so it is a no-op in
 * production unless explicitly enabled.
 *
 * DESIGN FOR TESTABILITY (instructions §2): the timing core takes an injectable
 * `now()` and an injectable `sink` (where span records go). The default `now`
 * is the real monotonic clock and the default sink buffers in memory; the
 * mobile app wires a JSONL file-writer sink (expo-file-system) at the edge.
 * This keeps the timed boundary unit-testable offline with no fs/expo/network —
 * see mobile/testing/unit/perf-logger.test.ts (the 500 ms regression test).
 *
 * Overhead is minimal: spans are pushed to an in-memory array and serialized
 * lazily; the file write happens on flush (or batched), never synchronously in
 * a hot path.
 */

/** Canonical span names — the wake→speech path stages required by GP2 §7. */
export type SpanName =
  | "listening.idle_to_active"
  | "listening.active_to_processing"
  | "precapture.photo"
  | "transcription.received"
  | "transcription.normalize"
  | "intent.classify"
  | "handler.process"
  | "relay.request"
  | "vision.llm_call"
  | "face.detect"
  | "face.search"
  | "tts.fetch"
  | "tts.playback_start"
  | "cue.play"
  | "command.total";

export interface SpanRecord {
  session: string;
  /** Monotonic command counter within the session (1 = first command). */
  commandSeq: number;
  name: SpanName | string;
  /** Epoch-ish ms from the injected clock at span start. */
  start: number;
  /** ms at span end (equal to start for point-in-time marks). */
  end: number;
  /** end - start. 0 for marks. */
  durationMs: number;
  /** Arbitrary structured context (e.g. { command, faceIndex, fallbackUsed }). */
  meta?: Record<string, unknown>;
}

export interface PerfLoggerOptions {
  enabled?: boolean;
  /** Monotonic clock in ms. Default: performance.now() if present, else Date.now(). */
  now?: () => number;
  /** Receives each completed span record. Default: in-memory buffer. */
  sink?: (record: SpanRecord) => void;
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Is perf logging enabled? Reads EXPO_PUBLIC_PERF_LOGGING (default ON in dev). */
export function perfEnabledFromEnv(): boolean {
  const v = process.env.EXPO_PUBLIC_PERF_LOGGING;
  if (v === undefined || v === "") {
    // Default on in dev, off otherwise.
    return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  }
  return v !== "0" && v.toLowerCase() !== "false";
}

export class PerfLogger {
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly sink: (r: SpanRecord) => void;
  private readonly buffer: SpanRecord[] = [];
  private commandSeq = 0;

  constructor(public readonly sessionId: string, opts: PerfLoggerOptions = {}) {
    this.enabled = opts.enabled ?? perfEnabledFromEnv();
    this.now = opts.now ?? defaultNow;
    this.sink = opts.sink ?? ((r) => this.buffer.push(r));
  }

  /** True if this logger records anything. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Begin a new command (cold vs warm split comes from commandSeq === 1). */
  beginCommand(): number {
    return ++this.commandSeq;
  }

  /** Point-in-time event (durationMs = 0). */
  mark(name: SpanName | string, meta?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const t = this.now();
    this.emit({ session: this.sessionId, commandSeq: this.commandSeq, name, start: t, end: t, durationMs: 0, meta });
  }

  /**
   * Times an awaited operation. The clock is read BEFORE the awaited call and
   * AFTER it resolves/rejects, so the recorded duration is the true wall time
   * of the async work (the property the 500 ms regression test verifies).
   */
  async span<T>(name: SpanName | string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    if (!this.enabled) return fn();
    const start = this.now();
    try {
      return await fn();
    } finally {
      const end = this.now();
      this.emit({ session: this.sessionId, commandSeq: this.commandSeq, name, start, end, durationMs: end - start, meta });
    }
  }

  /**
   * Manual span for code that can't be wrapped in a single callback. Returns an
   * `end(meta?)` function; call it after the awaited work resolves.
   */
  startSpan(name: SpanName | string, meta?: Record<string, unknown>): (extraMeta?: Record<string, unknown>) => void {
    const start = this.now();
    return (extraMeta?: Record<string, unknown>) => {
      if (!this.enabled) return;
      const end = this.now();
      this.emit({
        session: this.sessionId,
        commandSeq: this.commandSeq,
        name,
        start,
        end,
        durationMs: end - start,
        meta: { ...meta, ...extraMeta },
      });
    };
  }

  /** Recorded spans (in-memory buffer; empty if a custom sink was supplied). */
  get entries(): readonly SpanRecord[] {
    return this.buffer;
  }

  /** Serialize the buffered spans to JSONL (one record per line). */
  toJSONL(): string {
    return this.buffer.map((r) => JSON.stringify(r)).join("\n") + (this.buffer.length ? "\n" : "");
  }

  private emit(record: SpanRecord): void {
    this.sink(record);
  }
}
