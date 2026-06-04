import { describe, expect, test } from "bun:test";
import {
  isValidTranscription,
  needsScriptNormalization,
  stripAnnotations,
} from "../../src/utils/transcription-filter";

// Pure functions — no mocks. Covers grace/echo input validation (BV-04/07
// helpers), script handling, and Scribe annotation stripping (BLE-08/09).

describe("isValidTranscription (EP / garbled-input partitions)", () => {
  test("rejects text shorter than 2 chars", () => {
    expect(isValidTranscription("م", "ar")).toBe(false);
    expect(isValidTranscription("a", "en")).toBe(false);
  });

  test("accepts the shortest valid command (2 chars)", () => {
    expect(isValidTranscription("من", "ar")).toBe(true);
  });

  test("rejects > 40% special characters (garbled STT)", () => {
    expect(isValidTranscription("!!!@@@##", "en")).toBe(false);
  });

  test("rejects excessive word repetition (STT stutter)", () => {
    expect(isValidTranscription("go go go go go", "en")).toBe(false);
  });

  test("rejects Arabic-script stutter (Unicode-aware repetition guard)", () => {
    expect(isValidTranscription("من من من من من", "ar")).toBe(false);
    expect(isValidTranscription("وصف وصف وصف وصف", "ar")).toBe(false);
  });

  test("does not flag a normal Arabic command as stutter", () => {
    expect(isValidTranscription("صف ما حولي", "ar")).toBe(true);
  });

  test("rejects ar-labelled text containing no Arabic script", () => {
    expect(isValidTranscription("hello there friend", "ar")).toBe(false);
  });

  test("allows Arabic-script text under en (transliteration handled downstream)", () => {
    expect(isValidTranscription("واتس ان فرونت", "en")).toBe(true);
  });

  test("accepts normal English and Arabic commands", () => {
    expect(isValidTranscription("read this sign", "en")).toBe(true);
    expect(isValidTranscription("صف ما حولي", "ar")).toBe(true);
  });
});

describe("needsScriptNormalization (EP script-mismatch partition)", () => {
  test("true for Arabic-script-only text under en", () => {
    expect(needsScriptNormalization("واتس ان فرونت اوف مي", "en")).toBe(true);
  });
  test("false under ar regardless of script", () => {
    expect(needsScriptNormalization("واتس ان فرونت", "ar")).toBe(false);
  });
  test("false when latin characters are present", () => {
    expect(needsScriptNormalization("what is this", "en")).toBe(false);
    expect(needsScriptNormalization("واتس this", "en")).toBe(false);
  });
  test("false for trivially short text", () => {
    expect(needsScriptNormalization("من", "en")).toBe(false);
  });
});

describe("stripAnnotations (Scribe annotation removal, BLE-08)", () => {
  test("removes a trailing annotation and the stray space before the period", () => {
    expect(stripAnnotations("Describe my surroundings (clicks tongue).")).toBe(
      "Describe my surroundings.",
    );
  });
  test("removes a mid-sentence annotation keeping word separation", () => {
    expect(stripAnnotations("I said (coughs) hello")).toBe("I said hello");
  });
  test("an utterance that is only an annotation collapses to empty", () => {
    expect(stripAnnotations("(coughs)")).toBe("");
  });
  test("removes multiple annotations", () => {
    expect(stripAnnotations("hello (a) (b) world")).toBe("hello world");
  });
  test("leaves clean text unchanged", () => {
    expect(stripAnnotations("read this sign")).toBe("read this sign");
  });
});
