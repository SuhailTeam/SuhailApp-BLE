import { describe, expect, test } from "bun:test";
import { formatOcrSpeech, normalizeOcrText, OCR_MAX_CHARS } from "../../src/utils/ocr-format";

describe("OCR cap enforcement (Section 13.2.2)", () => {
  test("normalizes OCR whitespace before speech", () => {
    expect(normalizeOcrText("Line one\n\nLine two   Line three")).toBe("Line one Line two Line three");
  });

  test("does not truncate text at or below the cap", () => {
    const exact = "a".repeat(OCR_MAX_CHARS);

    expect(formatOcrSpeech(exact, "en")).toBe(exact);
  });

  test("truncates text above the cap and appends localized stop hint", () => {
    const over = "a".repeat(OCR_MAX_CHARS + 1);

    expect(formatOcrSpeech(over, "en")).toBe(`${"a".repeat(OCR_MAX_CHARS)} ...and more. Swipe forward to stop.`);
    expect(formatOcrSpeech(over, "ar")).toBe(`${"a".repeat(OCR_MAX_CHARS)} وغيره. اسحب للأمام للإيقاف.`);
  });
});
