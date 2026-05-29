import { Logger } from "./logger";
import { useActivity } from "../state/activity";

const logger = new Logger("Timeline");

interface TimelineMark {
  label: string;
  t: number;
}

/**
 * Per-command latency spans. Ported from the server's src/utils/timeline.ts,
 * with two adaptations for mobile:
 *   - single in-flight timeline instead of a Map<sessionId> — on BLE the phone
 *     IS the session, so only one command runs at a time.
 *   - Date.now() instead of performance.now() — ms resolution is plenty for
 *     multi-second voice cycles and avoids any `performance` typing gaps under
 *     expo/tsconfig.base.
 *
 * dump() formatting is kept byte-identical to the server so mobile and server
 * timelines read the same in logs.
 */
export class Timeline {
  private readonly marks: TimelineMark[] = [];
  private readonly start: number;

  constructor(public readonly name: string) {
    this.start = Date.now();
  }

  mark(label: string): void {
    this.marks.push({ label, t: Date.now() });
  }

  /** Total elapsed since start, in ms. */
  total(): number {
    return Date.now() - this.start;
  }

  dump(): string {
    const lines: string[] = [`Timeline [${this.name}]`];
    let prev = this.start;
    for (const m of this.marks) {
      const delta = m.t - prev;
      const total = m.t - this.start;
      lines.push(
        `  +${delta.toFixed(0).padStart(5)}ms  (t=${total.toFixed(0).padStart(5)}ms)  ${m.label}`,
      );
      prev = m.t;
    }
    return lines.join("\n");
  }
}

let current: Timeline | undefined;

/**
 * Starts a fresh timeline, replacing any in-flight one (an interrupted command
 * never reached endTimeline). The replaced timeline is dumped so its partial
 * spans aren't lost.
 */
export function startTimeline(name = "cmd"): Timeline {
  if (current) {
    logger.info(`Replacing in-flight timeline:\n${current.dump()}`);
  }
  current = new Timeline(name);
  return current;
}

export function getTimeline(): Timeline | undefined {
  return current;
}

/** Marks the current timeline. No-op when none is running (e.g. test callers). */
export function mark(label: string): void {
  current?.mark(label);
}

/**
 * Dumps the current timeline to the log and surfaces the headline cycle time to
 * the Activity screen, then clears it. No-op when none is running. Instrumentation
 * must never break a command, so the Activity write is best-effort.
 */
export function endTimeline(): void {
  if (!current) return;
  const t = current;
  current = undefined;
  logger.info(`\n${t.dump()}`);
  try {
    useActivity.getState().log({
      type: "system",
      command: "latency",
      event: `${t.total().toFixed(0)}ms total`,
    });
  } catch {
    // Activity store unavailable — ignore.
  }
}
