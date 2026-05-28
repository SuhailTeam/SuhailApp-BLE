/**
 * Tier 1 unit — Scribe annotation stripping (mobile copy).
 * Fills: Table 13.9 (Scribe annotation stripping).
 * Case IDs: BLE-08 ("(knocks on table) Faisal" → "Faisal"),
 *           BLE-09 (input that is ONLY an annotation → "" → enrollment rejects
 *           it + re-prompts; the re-prompt lives in listening.ts and is also
 *           exercised in enrollment-flow.test.ts).
 *
 * stripAnnotations is pure (mobile/src/utils/transcription-filter.ts), declared
 * byte-for-byte identical to the relay copy. We call the REAL function.
 */
import { test, expect, describe } from "bun:test";
import { stripAnnotations, isValidTranscription } from "../../src/utils/transcription-filter";

describe("BLE-08: strips a leading annotation, keeps the real name", () => {
  test('"(knocks on table) Faisal" → "Faisal"', () => {
    expect(stripAnnotations("(knocks on table) Faisal")).toBe("Faisal");
  });
  test("trailing annotation", () => {
    expect(stripAnnotations("Sara (coughs)")).toBe("Sara");
  });
  test("annotation in the middle", () => {
    expect(stripAnnotations("read (clears throat) this sign")).toBe("read this sign");
  });
  test("leading/trailing whitespace is trimmed", () => {
    expect(stripAnnotations("   (sigh)  Omar   ")).toBe("Omar");
  });
  test("space before sentence-final punctuation is removed", () => {
    expect(stripAnnotations("hello (beep) .")).toBe("hello.");
  });
});

describe("multiple annotations", () => {
  test("two separate annotations are both removed", () => {
    expect(stripAnnotations("(knock) Abdullah (cough)")).toBe("Abdullah");
  });
  test("two adjacent annotations collapse cleanly", () => {
    expect(stripAnnotations("(a)(b) Noura")).toBe("Noura");
  });
});

describe("nested annotations (documented regex limitation)", () => {
  // The regex \([^)]*\) is non-recursive: it matches from the first '(' to the
  // first ')', so a NESTED annotation leaves a dangling tail. This is the real
  // behaviour — we assert it rather than pretend nesting is handled. Reported
  // as a minor limitation in §12 of the results doc.
  test('"(laughs (loudly)) Lina" leaves the inner tail', () => {
    expect(stripAnnotations("(laughs (loudly)) Lina")).toBe(") Lina");
  });
});

describe("BLE-09: annotation-only input strips to empty (→ rejected upstream)", () => {
  test('"(coughs)" → ""', () => {
    expect(stripAnnotations("(coughs)")).toBe("");
  });
  test('"(knocks on table)" → ""', () => {
    expect(stripAnnotations("(knocks on table)")).toBe("");
  });
  test("an empty stripped name fails the <2-char enrollment gate (length proxy)", () => {
    // listening.ts rejects names whose stripped length < 2 and re-prompts.
    expect(stripAnnotations("(beep)").length).toBeLessThan(2);
  });
});

describe("non-annotated text passes through unchanged", () => {
  test("plain name", () => {
    expect(stripAnnotations("Faisal")).toBe("Faisal");
  });
  test("a stripped real name is still a valid transcription (en)", () => {
    const cleaned = stripAnnotations("(door slams) Mohammed");
    expect(cleaned).toBe("Mohammed");
    expect(isValidTranscription(cleaned, "en")).toBe(true);
  });
});
