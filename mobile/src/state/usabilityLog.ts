import { create } from "zustand";

/**
 * Session-scoped usability-test log. Unlike the rolling 20-entry Activity log
 * (state/activity.ts), this store is UNCAPPED: a 45-minute moderated session
 * with 8 task scenarios plus re-invocations would overflow a 20-entry buffer and
 * silently drop the early tasks. One row is recorded per completed command turn
 * (see utils/timeline.ts → endTimeline).
 *
 * `activeTask` is set by the moderator on the Usability Test screen so rows group
 * per task scenario; error recoveries for a task = (rows for that task − 1).
 *
 * This is testing-mode data only. Clear it between participants — that also keeps
 * it consistent with the report's "drop per session" privacy posture.
 */
export interface UsabilityRow {
  id: string;
  iso: string;            // ISO timestamp the row was recorded
  taskLabel: string;      // moderator-set active task (e.g. "1 · scene")
  command: string;        // routed command (e.g. "scene-summarize")
  transcript?: string;    // what the participant said (optional; session-only)
  /** Wake (forward swipe) → glasses start speaking the result. The headline metric. */
  timeToFirstWordMs?: number;
  /** End of user utterance → glasses start speaking (excludes the user's speech). */
  endUtteranceToFirstWordMs?: number;
  /** Wake → TTS playback finished (full cycle). */
  totalMs: number;
}

interface UsabilityLogStore {
  rows: UsabilityRow[];
  activeTask: string;
  setActiveTask: (label: string) => void;
  record: (row: Omit<UsabilityRow, "id" | "iso" | "taskLabel">) => void;
  clear: () => void;
}

let counter = 0;

export const useUsabilityLog = create<UsabilityLogStore>((set, get) => ({
  rows: [],
  activeTask: "",
  setActiveTask: (label) => set({ activeTask: label }),
  record: (row) =>
    set((s) => {
      counter += 1;
      const next: UsabilityRow = {
        ...row,
        id: `${Date.now()}-${counter}`,
        iso: new Date().toISOString(),
        taskLabel: get().activeTask,
      };
      return { rows: [...s.rows, next] };
    }),
  clear: () => set({ rows: [] }),
}));

/** CSV header — kept in lockstep with the Google Sheet "Data" tab. */
export const USABILITY_CSV_HEADER = [
  "iso",
  "task",
  "command",
  "timeToFirstWord_s",
  "endUtterance_to_firstWord_s",
  "total_s",
  "transcript",
] as const;

/** Escapes a CSV field per RFC 4180 (quote when it contains comma/quote/newline). */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function msToSeconds(ms: number | undefined): string {
  return ms == null ? "" : (ms / 1000).toFixed(2);
}

/** Builds an RFC-4180 CSV string of the recorded rows for sharing/pasting. */
export function buildUsabilityCsv(rows: UsabilityRow[]): string {
  const lines = [USABILITY_CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.iso,
        r.taskLabel,
        r.command,
        msToSeconds(r.timeToFirstWordMs),
        msToSeconds(r.endUtteranceToFirstWordMs),
        msToSeconds(r.totalMs),
        r.transcript ?? "",
      ]
        .map((f) => csvField(String(f)))
        .join(","),
    );
  }
  return lines.join("\n");
}
