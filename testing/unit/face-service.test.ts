import { describe, expect, test } from "bun:test";
import { decodeExternalImageId, encodeExternalImageId } from "../../src/utils/external-image-id";

describe("ExternalImageId encoding (round-trip property from Section 13.4)", () => {
  test("round-trips Arabic, English, whitespace, and punctuation through hex", () => {
    const names = [
      "Faisal Alqahtani",
      "عبدالله القبيسي",
      "Nasser-Alaboud 2",
      "Abdullah Alyousef.",
      "اسم مختلط Faisal",
    ];

    for (const name of names) {
      const encoded = encodeExternalImageId(name);
      expect(encoded).toMatch(/^[0-9a-f]+$/);
      expect(decodeExternalImageId(encoded)).toBe(name);
    }
  });
});
