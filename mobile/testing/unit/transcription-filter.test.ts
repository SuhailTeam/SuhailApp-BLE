import { describe, expect, test } from "bun:test";
import {
  isValidTranscription,
  needsScriptNormalization,
  stripAnnotations,
} from "../../src/utils/transcription-filter";

// REAL mobile transcription-filter (ported verbatim from the server; must stay
// in lockstep). Covers garbled-input rejection + Scribe annotation stripping.

describe("isValidTranscription (mobile)", () => {
  test("rejects < 2 chars; accepts the 2-char Arabic command", () => {
    expect(isValidTranscription("a", "en")).toBe(false);
    expect(isValidTranscription("من", "ar")).toBe(true);
  });
  test("rejects mostly-special-character junk", () => {
    expect(isValidTranscription("@@##$$%%", "en")).toBe(false);
  });
  test("rejects stutter repetition", () => {
    expect(isValidTranscription("no no no no no", "en")).toBe(false);
  });
  test("rejects ar-labelled text with no Arabic script", () => {
    expect(isValidTranscription("hello there", "ar")).toBe(false);
  });
  test("accepts valid commands in both languages", () => {
    expect(isValidTranscription("describe the room", "en")).toBe(true);
    expect(isValidTranscription("اقرأ هذا النص", "ar")).toBe(true);
  });
});

describe("needsScriptNormalization (mobile)", () => {
  test("Arabic-script-only under en → true", () => {
    expect(needsScriptNormalization("ريد ذيس", "en")).toBe(true);
  });
  test("ar / latin-containing → false", () => {
    expect(needsScriptNormalization("اقرأ", "ar")).toBe(false);
    expect(needsScriptNormalization("read this", "en")).toBe(false);
  });
});

describe("stripAnnotations (mobile — enrollment-name cleanup)", () => {
  test("strips a (knocks on table) annotation cleanly", () => {
    expect(stripAnnotations("(knocks on table) Sara")).toBe("Sara");
  });
  test("strips trailing annotation + fixes the space before the period", () => {
    expect(stripAnnotations("read this (coughs).")).toBe("read this.");
  });
  test("annotation-only input → empty (caught by the <2 char check upstream)", () => {
    expect(stripAnnotations("(knocks on table)")).toBe("");
  });
});
