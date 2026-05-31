import { describe, expect, test } from "bun:test";
import {
  isValidTranscription as isValidServerTranscription,
  needsScriptNormalization as serverNeedsScriptNormalization,
  stripAnnotations as stripServerAnnotations,
} from "../../src/utils/transcription-filter";
import {
  isValidTranscription as isValidMobileTranscription,
  needsScriptNormalization as mobileNeedsScriptNormalization,
  stripAnnotations as stripMobileAnnotations,
} from "../../mobile/src/utils/transcription-filter";

describe("transcription filters (EP/BVA from Section 13.2)", () => {
  test("rejects too-short transcripts and accepts the shortest Arabic command", () => {
    expect(isValidServerTranscription("", "en")).toBe(false);
    expect(isValidServerTranscription("a", "en")).toBe(false);
    expect(isValidServerTranscription("من", "ar")).toBe(true);
  });

  test("rejects garbled special-character transcripts over the 40% partition", () => {
    expect(isValidServerTranscription("read text", "en")).toBe(true);
    expect(isValidServerTranscription("read !!!!!!", "en")).toBe(false);
  });

  test("rejects repeated-word STT artifacts", () => {
    expect(isValidServerTranscription("read read read read text", "en")).toBe(false);
  });

  test("rejects Arabic-mode transcripts with no Arabic script once non-trivial", () => {
    expect(isValidServerTranscription("describe scene", "ar")).toBe(false);
    expect(isValidServerTranscription("وصف المكان", "ar")).toBe(true);
  });

  test("detects Arabic-script English candidates only for English mode", () => {
    expect(serverNeedsScriptNormalization("واتس ان فرونت اوف مي", "en")).toBe(true);
    expect(serverNeedsScriptNormalization("واتس ان فرونت اوف مي", "ar")).toBe(false);
    expect(serverNeedsScriptNormalization("what is in front of me", "en")).toBe(false);
  });

  test("strips Scribe parenthetical annotations without leaving punctuation gaps", () => {
    const input = "Describe my surroundings (clicks tongue).";
    expect(stripServerAnnotations(input)).toBe("Describe my surroundings.");
    expect(stripMobileAnnotations(input)).toBe("Describe my surroundings.");
  });

  test("server and mobile filters stay behaviorally aligned", () => {
    const samples = [
      { text: "read the sign", lang: "en" as const },
      { text: "اقرأ اللوحة", lang: "ar" as const },
      { text: "(coughs)", lang: "en" as const },
      { text: "واتس ان فرونت اوف مي", lang: "en" as const },
    ];

    for (const sample of samples) {
      expect(isValidMobileTranscription(sample.text, sample.lang)).toBe(
        isValidServerTranscription(sample.text, sample.lang)
      );
      expect(mobileNeedsScriptNormalization(sample.text, sample.lang)).toBe(
        serverNeedsScriptNormalization(sample.text, sample.lang)
      );
    }
  });
});
