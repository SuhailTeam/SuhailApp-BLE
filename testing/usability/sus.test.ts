import { describe, expect, test } from "bun:test";
import { scoreSus, decodeSus, SUS_HEADER } from "./sus";
import { parseCsv } from "./csv";

describe("scoreSus (standard 10-item, 1–5)", () => {
  test("best-possible responses score 100", () => {
    // odd items (q1,q3,…) = 5, even items (q2,q4,…) = 1
    expect(scoreSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
  });

  test("worst-possible responses score 0", () => {
    expect(scoreSus([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  test("textbook mid example scores 75", () => {
    expect(scoreSus([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75);
  });

  test("all-neutral (3s) scores 50", () => {
    expect(scoreSus([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
  });

  test("returns null for out-of-range or wrong-length input", () => {
    expect(scoreSus([6, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBeNull();
    expect(scoreSus([5, 1, 5])).toBeNull();
    expect(scoreSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 2.5])).toBeNull();
  });
});

describe("decodeSus", () => {
  test("reads the q1..q10 + data-row format", () => {
    const csv = `${SUS_HEADER.join(",")}\n4,2,4,2,4,2,4,2,4,2`;
    const vals = decodeSus(parseCsv(csv));
    expect(vals).toEqual([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]);
    expect(scoreSus(vals!)).toBe(75);
  });

  test("returns null on a wrong header", () => {
    expect(decodeSus(parseCsv("a,b,c\n1,2,3"))).toBeNull();
  });

  test("returns null when the data row is missing", () => {
    expect(decodeSus(parseCsv(SUS_HEADER.join(",")))).toBeNull();
  });
});
