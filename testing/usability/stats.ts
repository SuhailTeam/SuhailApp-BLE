/**
 * Pure descriptive statistics for the usability analysis (report Table 13.14 / 41).
 *
 * The headline measure is the median + IQR of time-to-first-spoken-word, so the
 * quantile method matters and must be reproducible by a reader in a spreadsheet:
 * we use the linear-interpolation / inclusive method — Hyndman & Fan type 7,
 * identical to Excel QUARTILE.INC and NumPy's default percentile("linear").
 *
 * No external deps (Bun only). Every function is total and never invents a number:
 * an empty sample yields `null` (the caller then emits needs-participants) rather
 * than 0 or NaN.
 */

export interface FiveStat {
  /** Sample size (number of finite observations). */
  n: number;
  /** First quartile (25th percentile). */
  q1: number;
  /** Median (50th percentile). */
  median: number;
  /** Third quartile (75th percentile). */
  q3: number;
  /** Inter-quartile range (q3 − q1). */
  iqr: number;
}

/**
 * Linear-interpolation quantile (Hyndman–Fan type 7 == Excel QUARTILE.INC).
 * `xs` need not be pre-sorted; `q` is in [0, 1]. Throws on an empty sample so
 * callers must guard (use {@link fiveStat}, which returns null instead).
 */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) throw new Error("quantile of empty sample");
  if (s.length === 1) return s[0]!;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (pos - lo) * (s[hi]! - s[lo]!);
}

/** Median (50th percentile) via {@link quantile}. Throws on an empty sample. */
export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/**
 * Five-number summary used for every latency cell. Returns `null` for an empty
 * sample so the report shows needs-participants instead of a fabricated 0.
 */
export function fiveStat(xs: number[]): FiveStat | null {
  if (xs.length === 0) return null;
  const q1 = quantile(xs, 0.25);
  const med = quantile(xs, 0.5);
  const q3 = quantile(xs, 0.75);
  return { n: xs.length, q1, median: med, q3, iqr: q3 - q1 };
}

/** Arithmetic mean, or `null` for an empty sample. */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
