/**
 * Tier 1 unit — ExternalImageId hex encode/decode.
 * Fills: Table 13.9 (ExternalImageId hex encode/decode).
 * Case IDs: §4.11 — round-trip property test over random names incl.
 *           Arabic/unicode (decode∘encode = identity).
 *
 * encodeName/decodeName (src/services/face-service.ts) map an enrollment name
 * to the ASCII-safe ExternalImageId AWS Rekognition stores. They were private;
 * exported for this test (documented, behaviour-preserving deviation — see the
 * results-doc methodology notes). We call the REAL functions.
 */
import { test, expect, describe } from "bun:test";
import { encodeName, decodeName } from "../../src/services/face-service";

const HEX_ONLY = /^[0-9a-f]*$/;

describe("round-trip identity (decode∘encode = name)", () => {
  const fixed = [
    "Abdullah",
    "Sara",
    "عبدالله",
    "محمد بن سلمان",
    "José",
    "Anaïs-Marie",
    "名前",
    "Name (with) punctuation!?",
    "  leading and trailing  ",
    "",
    "x".repeat(256),
  ];
  for (const name of fixed) {
    test(`"${name.slice(0, 24)}${name.length > 24 ? "…" : ""}"`, () => {
      expect(decodeName(encodeName(name))).toBe(name);
    });
  }

  test("randomized property sweep (200 random unicode strings)", () => {
    // Deterministic PRNG (no Math.random — keeps the test reproducible).
    let seed = 0x1234abcd;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(rand() * 30);
      let s = "";
      for (let j = 0; j < len; j++) {
        // Mix BMP ranges: Latin, Arabic, CJK, punctuation.
        const ranges = [[0x20, 0x7e], [0x600, 0x6ff], [0x4e00, 0x4f00], [0xa0, 0x17f]];
        const [lo, hi] = ranges[Math.floor(rand() * ranges.length)]!;
        s += String.fromCodePoint(lo + Math.floor(rand() * (hi - lo)));
      }
      expect(decodeName(encodeName(s))).toBe(s);
    }
  });
});

describe("encode output is an ASCII-safe hex string", () => {
  test("hex chars only", () => {
    expect(HEX_ONLY.test(encodeName("عبدالله Abdullah 123"))).toBe(true);
  });
  test("UTF-8 byte length → 2 hex chars per byte", () => {
    // "ع" is 2 UTF-8 bytes → 4 hex chars.
    expect(encodeName("ع").length).toBe(4);
    expect(encodeName("A").length).toBe(2);
  });
});
