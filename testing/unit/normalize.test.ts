/**
 * Tier 1 unit — Arabic-script-English normalization.
 * Fills: Table 13.9 (Arabic-script English normalization).
 * Case IDs: §4.7 — offline corpus of (transliteration → expected) pairs, the
 *           gate (needsScriptNormalization), and the pass-through/fallback
 *           guarantee.
 *
 * normalizeTranscription (src/utils/transcription-normalizer.ts) itself calls
 * an LLM, so per instructions §4.7 we stub that LLM and test the SURROUNDING
 * CONTRACT + the fallback path — not the model's translation quality:
 *   - the script-mismatch GATE (only en + Arabic-script-no-latin is sent),
 *   - that the LLM's answer is returned when the call succeeds,
 *   - that the ORIGINAL text is returned unchanged on every failure path
 *     (no key, HTTP error, abort/timeout, empty response) and when no
 *     normalization is needed.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { normalizeTranscription } from "../../src/utils/transcription-normalizer";
import { needsScriptNormalization } from "../../src/utils/transcription-filter";
import { setApiKey, restore, mockLLMContent, mockLLMAbort, mockLLMHttpStatus } from "../helpers/openrouter-mock";

afterEach(() => restore());

// Author-curated offline corpus: Arabic-script phonetic English → expected Latin.
// (The mapping is what we PROGRAM the stubbed LLM to return; the test asserts
//  the contract carries it through, not that the model is correct.)
const CORPUS: Array<[string, string]> = [
  ["واتس ان فرونت أوف مي", "what's in front of me"],
  ["ريد ذا تيكست", "read the text"],
  ["هوايت كولور از ذيس", "what color is this"],
  ["كاونت ذا موني", "count the money"],
];

describe("the script-mismatch gate (needsScriptNormalization)", () => {
  test("en + Arabic-script-only → needs normalization", () => {
    expect(needsScriptNormalization("واتس ان فرونت", "en")).toBe(true);
  });
  test("en + Latin text → does NOT need normalization", () => {
    expect(needsScriptNormalization("what's in front of me", "en")).toBe(false);
  });
  test("ar language → never needs normalization", () => {
    expect(needsScriptNormalization("واتس ان فرونت", "ar")).toBe(false);
  });
  test("short text (<=3 chars) → never", () => {
    expect(needsScriptNormalization("من", "en")).toBe(false);
  });
});

describe("corpus: a needed normalization returns the LLM's Latin output", () => {
  for (const [input, expected] of CORPUS) {
    test(`"${input}" → "${expected}"`, async () => {
      setApiKey("test-key");
      mockLLMContent(expected);
      expect(await normalizeTranscription(input, "en")).toBe(expected);
    });
  }
});

describe("no-op cases (no LLM call, input returned unchanged)", () => {
  test("Latin English passes through untouched", async () => {
    setApiKey("test-key");
    mockLLMContent("SHOULD-NOT-BE-USED");
    expect(await normalizeTranscription("what's in front of me", "en")).toBe("what's in front of me");
  });
  test("Arabic language passes through untouched", async () => {
    setApiKey("test-key");
    mockLLMContent("SHOULD-NOT-BE-USED");
    expect(await normalizeTranscription("صف ما حولي", "ar")).toBe("صف ما حولي");
  });
});

describe("pass-through guarantee: every failure returns the ORIGINAL text", () => {
  const input = "واتس ان فرونت أوف مي";
  test("no API key configured", async () => {
    setApiKey("");
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });
  test("LLM HTTP error", async () => {
    setApiKey("test-key");
    mockLLMHttpStatus(500);
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });
  test("LLM abort/timeout", async () => {
    setApiKey("test-key");
    mockLLMAbort();
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });
  test("LLM empty response", async () => {
    setApiKey("test-key");
    mockLLMContent("   ");
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });
});
