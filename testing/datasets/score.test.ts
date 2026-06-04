import { describe, expect, test } from "bun:test";
import { scoreAnyOf, scoreContains, scoreCurrency, scoreFound, scoreFaceName } from "./score";

describe("scoreAnyOf (scene / color)", () => {
  test("passes on any keyword, case/space-insensitive", () => {
    expect(scoreAnyOf("A tidy KITCHEN with a sink", ["kitchen", "مطبخ"]).pass).toBe(true);
    expect(scoreAnyOf("a red shirt", ["blue", "green"]).pass).toBe(false);
  });
});

describe("scoreContains (OCR / VQA)", () => {
  test("requires every substring", () => {
    expect(scoreContains("Coffee 12 SAR · Tea 8 SAR", ["coffee", "tea"]).pass).toBe(true);
    expect(scoreContains("Coffee only", ["coffee", "tea"]).pass).toBe(false);
  });
});

describe("scoreCurrency", () => {
  test("exact ISO + total within tolerance", () => {
    expect(scoreCurrency("sar", 150, { currency: "SAR", total: 150 }).pass).toBe(true);
    expect(scoreCurrency("SAR", 152, { currency: "SAR", total: 150, tolerance: 5 }).pass).toBe(true);
    expect(scoreCurrency("USD", 150, { currency: "SAR", total: 150 }).pass).toBe(false);
    expect(scoreCurrency("SAR", 200, { currency: "SAR", total: 150 }).pass).toBe(false);
  });
});

describe("scoreFound (find-object)", () => {
  test("found flag + location keyword", () => {
    expect(scoreFound(true, "on the desk to your left", { found: true, locationContains: ["desk"] }).pass).toBe(true);
    expect(scoreFound(true, "on the floor", { found: true, locationContains: ["desk"] }).pass).toBe(false);
    expect(scoreFound(false, "", { found: false }).pass).toBe(true);
    expect(scoreFound(true, "somewhere", { found: false }).pass).toBe(false);
  });
});

describe("scoreFaceName", () => {
  test("known person recognized", () => {
    expect(scoreFaceName(["Alice", "Bob"], "Alice").pass).toBe(true);
    expect(scoreFaceName(["Bob"], "Alice").pass).toBe(false);
  });
  test("stranger → no known face", () => {
    expect(scoreFaceName([], null).pass).toBe(true);
    expect(scoreFaceName(["Alice"], null).pass).toBe(false);
  });
});
