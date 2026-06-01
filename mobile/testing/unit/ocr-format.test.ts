import { describe, expect, test } from "bun:test";
import { formatOcrResult, OCR_MAX_CHARS } from "../../src/commands/read";

// REAL OCR cap/format logic (BV-09 on-boundary, BV-10 over-boundary).

describe("formatOcrResult (OCR cap)", () => {
  test("empty / whitespace OCR → localised no-text message", () => {
    expect(formatOcrResult("", "en")).toBe("I couldn't find any text in the image.");
    expect(formatOcrResult("   \n ", "ar")).toBe("ما قدرت ألاقي نص في الصورة.");
  });

  test("collapses newlines and runs of whitespace into single spaces", () => {
    expect(formatOcrResult("hello\n\nthere   world", "en")).toBe("hello there world");
  });

  test("BV-09: text exactly at the cap is returned in full, no hint", () => {
    const exact = "a".repeat(OCR_MAX_CHARS);
    const out = formatOcrResult(exact, "en");
    expect(out).toBe(exact);
    expect(out.length).toBe(OCR_MAX_CHARS);
    expect(out).not.toContain("Swipe forward to stop");
  });

  test("BV-10: text past the cap is truncated and gets the swipe-to-stop hint", () => {
    const long = "b".repeat(OCR_MAX_CHARS + 50);
    const out = formatOcrResult(long, "en");
    expect(out.startsWith("b".repeat(OCR_MAX_CHARS))).toBe(true);
    expect(out.endsWith("...and more. Swipe forward to stop.")).toBe(true);
  });

  test("Arabic over-cap uses the Arabic hint", () => {
    const long = "ب".repeat(OCR_MAX_CHARS + 10);
    expect(formatOcrResult(long, "ar").endsWith("وغيره. اسحب للأمام للإيقاف.")).toBe(true);
  });
});
