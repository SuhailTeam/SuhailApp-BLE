/**
 * RFC-4180 CSV parsing for the usability session export.
 *
 * A real state machine is required because the app's exported `transcript`
 * column can contain quoted commas / quotes / newlines
 * (see mobile/src/state/usabilityLog.ts → buildUsabilityCsv). No external deps.
 *
 * The expected header mirrors USABILITY_CSV_HEADER in the mobile app exactly; we
 * re-declare it locally (rather than import the zustand-backed store into the
 * Bun test runtime) and assert equality in a unit test so drift fails loudly.
 */

/** The 7 columns the app exports, in order. Mirrors USABILITY_CSV_HEADER. */
export const SESSION_HEADER_7 = [
  "iso",
  "task",
  "command",
  "timeToFirstWord_s",
  "endUtterance_to_firstWord_s",
  "total_s",
  "transcript",
] as const;

/** One decoded session turn. Missing numeric cells are `null`, never 0/NaN. */
export interface SessionRow {
  iso: string;
  /** Moderator-set active task label, e.g. "1 · scene-summarize". */
  task: string;
  /** Routed CommandType, e.g. "scene-summarize". */
  command: string;
  /** Wake (forward swipe) → glasses start speaking, in seconds. */
  timeToFirstWordS: number | null;
  /** End of user utterance → glasses start speaking, in seconds. */
  endUtteranceToFirstWordS: number | null;
  /** Wake → TTS finished (full cycle), in seconds. */
  totalS: number | null;
  transcript: string;
  /** Optional moderator grade from an 8th `success` column (1/0). */
  success: 0 | 1 | null;
}

/**
 * Parses RFC-4180 text into rows of string cells. Handles `""` escaping and
 * embedded commas / newlines inside quoted fields. A trailing newline is
 * optional and does not produce a spurious empty row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush the final field/row unless the input ended exactly on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function numOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decodes a parsed session CSV against {@link SESSION_HEADER_7} (+ optional 8th
 * `success` column). Throws a precise error if the first 7 headers don't match.
 * Blank lines are skipped.
 */
export function decodeSession(rows: string[][]): SessionRow[] {
  if (rows.length === 0) return [];
  const header = rows[0]!;
  for (let i = 0; i < SESSION_HEADER_7.length; i++) {
    if ((header[i] ?? "").trim() !== SESSION_HEADER_7[i]) {
      throw new Error(
        `session CSV header mismatch at column ${i}: expected "${SESSION_HEADER_7[i]}", got "${(header[i] ?? "").trim()}"`,
      );
    }
  }
  const hasSuccess = (header[7] ?? "").trim().toLowerCase() === "success";

  const out: SessionRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const isBlank = cells.length === 0 || (cells.length === 1 && (cells[0] ?? "").trim() === "");
    if (isBlank) continue;

    let success: 0 | 1 | null = null;
    if (hasSuccess) {
      const raw = (cells[7] ?? "").trim().toLowerCase();
      if (raw !== "") success = raw === "1" || raw === "true" || raw === "pass" || raw === "yes" ? 1 : 0;
    }

    out.push({
      iso: cells[0] ?? "",
      task: cells[1] ?? "",
      command: cells[2] ?? "",
      timeToFirstWordS: numOrNull(cells[3]),
      endUtteranceToFirstWordS: numOrNull(cells[4]),
      totalS: numOrNull(cells[5]),
      transcript: cells[6] ?? "",
      success,
    });
  }
  return out;
}
