import { describe, expect, test } from "bun:test";
import { quantile, median, fiveStat, mean } from "./stats";

// Headline usability statistic: median + IQR of time-to-first-spoken-word, using
// the inclusive / linear-interpolation method (Excel QUARTILE.INC == NumPy linear
// == Hyndman & Fan type 7). Values below are cross-checked against Excel.

describe("quantile (inclusive / linear interpolation)", () => {
  test("odd-length sample matches Excel QUARTILE.INC", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(quantile(xs, 0.25)).toBe(2);
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0.75)).toBe(4);
  });

  test("even-length sample interpolates between neighbours", () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0.25)).toBe(1.75);
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(quantile(xs, 0.75)).toBe(3.25);
  });

  test("ten-element sample (1..10)", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(xs, 0.25)).toBe(3.25);
    expect(quantile(xs, 0.5)).toBe(5.5);
    expect(quantile(xs, 0.75)).toBe(7.75);
  });

  test("does not require pre-sorted input", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  test("throws on an empty sample (never invents a number)", () => {
    expect(() => quantile([], 0.5)).toThrow();
  });
});

describe("fiveStat", () => {
  test("returns the five-number summary with IQR", () => {
    const s = fiveStat([1, 2, 3, 4, 5]);
    expect(s).toEqual({ n: 5, q1: 2, median: 3, q3: 4, iqr: 2 });
  });

  test("returns null for an empty sample (→ needs-participants)", () => {
    expect(fiveStat([])).toBeNull();
  });

  test("single observation has zero spread", () => {
    expect(fiveStat([4.2])).toEqual({ n: 1, q1: 4.2, median: 4.2, q3: 4.2, iqr: 0 });
  });
});

describe("mean", () => {
  test("averages a sample", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
  test("null for an empty sample", () => {
    expect(mean([])).toBeNull();
  });
});
