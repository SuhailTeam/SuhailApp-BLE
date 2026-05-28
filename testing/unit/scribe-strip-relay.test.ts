/**
 * Tier 1 unit — Scribe annotation stripping (relay copy).
 * Fills: Table 13.9 (Scribe annotation stripping).
 * Case IDs: BLE-08 / BLE-09.
 *
 * The relay runs stripAnnotations in /api/intent + /api/normalize before
 * routing. This is the server copy of the function (declared byte-for-byte
 * identical to the mobile copy tested in mobile/testing/unit/scribe-strip).
 * Trace from the SAME case IDs so the result doc can cite either copy.
 */
import { test, expect, describe } from "bun:test";
import { stripAnnotations } from "../../src/utils/transcription-filter";

describe("BLE-08: strips annotations, keeps real content", () => {
  test('"(knocks on table) Faisal" → "Faisal"', () => {
    expect(stripAnnotations("(knocks on table) Faisal")).toBe("Faisal");
  });
  test("multiple annotations", () => {
    expect(stripAnnotations("(knock) read (cough) this")).toBe("read this");
  });
  test("space before punctuation removed + whitespace collapsed", () => {
    expect(stripAnnotations("  describe  (beep)  the   room . ")).toBe("describe the room.");
  });
});

describe("BLE-09: annotation-only → empty (router then returns 'unknown')", () => {
  test('"(coughs)" → ""', () => {
    expect(stripAnnotations("(coughs)")).toBe("");
  });
});
