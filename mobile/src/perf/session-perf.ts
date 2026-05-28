/**
 * Wires a session-scoped PerfLogger to a JSONL file on device (GP2 Tier 4).
 *
 * On the phone the spans are buffered in memory and written once on session end
 * (flush) to documentDirectory/logs/perf/<date>/<sessionId>-<epoch>.jsonl —
 * matching the layout the relay-side report (testing/perf/report.ts) reads.
 * No synchronous IO in the command hot path: the only write is the flush.
 *
 * This module is the on-device EDGE (it imports expo-file-system). The timing
 * core (perf-logger.ts) is import-clean and is what the unit test exercises.
 */
import * as FileSystem from "expo-file-system";
import { PerfLogger, perfEnabledFromEnv } from "./perf-logger";

export interface SessionPerf {
  logger: PerfLogger;
  /** Write all buffered spans to the per-session JSONL file. Call on session end. */
  flush: () => Promise<void>;
}

function twoDigit(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD from an epoch (used for the logs/perf/<date>/ directory). */
function dateDir(epoch: number): string {
  const d = new Date(epoch);
  return `${d.getUTCFullYear()}-${twoDigit(d.getUTCMonth() + 1)}-${twoDigit(d.getUTCDate())}`;
}

/**
 * Creates a PerfLogger for one session plus a flush() that persists its JSONL.
 * `epoch` is passed in (caller supplies Date.now()) so the filename is stable.
 */
export function createSessionPerf(sessionId: string, epoch: number): SessionPerf {
  const logger = new PerfLogger(sessionId, { enabled: perfEnabledFromEnv() });

  const flush = async (): Promise<void> => {
    if (!logger.isEnabled() || logger.entries.length === 0) return;
    const base = `${FileSystem.documentDirectory ?? ""}logs/perf/${dateDir(epoch)}/`;
    try {
      await FileSystem.makeDirectoryAsync(base, { intermediates: true });
    } catch {
      // directory may already exist — ignore
    }
    const path = `${base}${sessionId}-${epoch}.jsonl`;
    await FileSystem.writeAsStringAsync(path, logger.toJSONL());
  };

  return { logger, flush };
}
