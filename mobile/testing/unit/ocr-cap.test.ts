/**
 * Tier 1 unit — OCR cap enforcement (mobile read command).
 * Fills: Table 13.9 (OCR cap enforcement).
 * Case IDs: BV-09 (length == OCR_CAP → full text, no "swipe to stop" hint),
 *           BV-10 (OCR_CAP + 1 → capped + hint).
 *
 * The cap is pure string logic inside the production executeRead()
 * (mobile/src/commands/read.ts, OCR_MAX_CHARS = 400, identical to the cloud
 * src/commands/ocr-read-text.ts). We call the REAL executeRead and stub only
 * the two adapter calls it makes: resolvePhoto (BLE camera) and ocr (relay
 * vision) — the latter returns the controlled text whose length we vary across
 * the 400 boundary.
 */
import { test, expect, describe, mock } from "bun:test";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../../src");
const OCR_CAP = 400;

// Adapter stubs. Only `ocr`'s return value drives the assertions; resolvePhoto
// just needs to yield a photoToken.
let ocrText = "";
mock.module(SRC + "/relay/vision.ts", () => ({
  ocr: async () => ({ text: ocrText }),
}));
mock.module(SRC + "/ble/camera.ts", () => ({
  resolvePhoto: async () => ({ photoToken: "tok", requestId: "tok", uploadUrl: "u", bytes: 1 }),
  capturePhoto: async () => ({ photoToken: "tok", requestId: "tok", uploadUrl: "u", bytes: 1 }),
}));

const { executeRead } = await import(SRC + "/commands/read.ts");

const EN_SUFFIX = " ...and more. Swipe forward to stop.";
const AR_SUFFIX = " وغيره. اسحب للأمام للإيقاف.";

describe("BV-09: text of exactly OCR_CAP chars is spoken in full, no hint", () => {
  test("en: 400 chars → unchanged, no suffix", async () => {
    ocrText = "a".repeat(OCR_CAP);
    const out = await executeRead({ language: "en" });
    expect(out.length).toBe(OCR_CAP);
    expect(out.endsWith(EN_SUFFIX)).toBe(false);
    expect(out).toBe("a".repeat(OCR_CAP));
  });
});

describe("BV-10: text of OCR_CAP + 1 chars is capped and gets the hint", () => {
  test("en: 401 chars → 400 + English hint", async () => {
    ocrText = "b".repeat(OCR_CAP + 1);
    const out = await executeRead({ language: "en" });
    expect(out).toBe("b".repeat(OCR_CAP) + EN_SUFFIX);
    expect(out.endsWith(EN_SUFFIX)).toBe(true);
  });

  test("ar: 401 chars → 400 + Arabic hint", async () => {
    ocrText = "ب".repeat(OCR_CAP + 1);
    const out = await executeRead({ language: "ar" });
    expect(out).toBe("ب".repeat(OCR_CAP) + AR_SUFFIX);
  });
});

describe("edge cases", () => {
  test("empty OCR result → localized 'no text' message", async () => {
    ocrText = "";
    expect(await executeRead({ language: "en" })).toBe("I couldn't find any text in the image.");
    expect(await executeRead({ language: "ar" })).toBe("ما قدرت ألاقي نص في الصورة.");
  });

  test("newlines/whitespace are collapsed before the cap is measured", async () => {
    ocrText = "line one\n\nline   two\n";
    const out = await executeRead({ language: "en" });
    expect(out).toBe("line one line two");
  });
});
