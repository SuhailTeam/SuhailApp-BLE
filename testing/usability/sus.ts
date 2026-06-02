/**
 * System Usability Scale (SUS) scoring for the usability study (Table 13.14 / 41).
 *
 * Standard 10-item, 1–5 Likert scoring:
 *   odd items  (q1,q3,q5,q7,q9):  contribution = value − 1
 *   even items (q2,q4,q6,q8,q10): contribution = 5 − value
 *   participant SUS = (sum of 10 contributions) × 2.5     → 0..100
 *   study SUS       = mean of participant SUS
 *
 * File format (one CSV per participant, testing/usability/sus/P<n>.csv):
 *   q1,q2,q3,q4,q5,q6,q7,q8,q9,q10
 *   4,2,5,1,4,1,5,2,4,1
 */

export const SUS_HEADER = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
  "q9",
  "q10",
] as const;

/**
 * Scores ten 1–5 answers into a 0..100 SUS value. Returns `null` if the input
 * isn't exactly ten integers in [1,5] (so a malformed file never fabricates a
 * score — the participant is reported as missing instead).
 */
export function scoreSus(values: number[]): number | null {
  if (values.length !== 10) return null;
  for (const v of values) {
    if (!Number.isInteger(v) || v < 1 || v > 5) return null;
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = values[i]!;
    // Array index i is 0-based: i even → odd SUS item (q1,q3,…) → v−1;
    // i odd → even SUS item (q2,q4,…) → 5−v.
    sum += i % 2 === 0 ? v - 1 : 5 - v;
  }
  return sum * 2.5;
}

/**
 * Decodes a parsed SUS CSV (header q1..q10 + one data row) into ten raw values.
 * Returns `null` when the header or row shape is wrong (caller treats as missing).
 */
export function decodeSus(rows: string[][]): number[] | null {
  if (rows.length < 2) return null;
  const header = rows[0]!;
  for (let i = 0; i < SUS_HEADER.length; i++) {
    if ((header[i] ?? "").trim().toLowerCase() !== SUS_HEADER[i]) return null;
  }
  const data = rows[1]!;
  const vals: number[] = [];
  for (let i = 0; i < SUS_HEADER.length; i++) {
    vals.push(Number((data[i] ?? "").trim()));
  }
  return vals;
}
