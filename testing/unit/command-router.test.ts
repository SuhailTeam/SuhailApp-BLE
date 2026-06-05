import { afterEach, describe, expect, test } from "bun:test";
import { routeCommand } from "../../src/relay/command-router";
import {
  mockChatContent,
  mockFetchReject,
  mockHttpError,
  mockEmptyContent,
  type FetchMock,
} from "../helpers/mock-openrouter";

// Tests the REAL hybrid router (src/relay/command-router.ts). Keyword fast-path
// runs offline; the LLM path is exercised with a stubbed fetch.

let fm: FetchMock | undefined;
afterEach(() => {
  fm?.restore();
  fm = undefined;
});

describe("intent router — keyword fast-path (DT-R1, EP keyword partitions)", () => {
  const cases: Array<[string, string]> = [
    ["describe what's around me", "scene-summarize"],
    ["وصف ما حولي", "scene-summarize"],
    ["read this sign", "ocr-read-text"],
    ["اقرأ هذا", "ocr-read-text"],
    ["who is this", "face-recognize"],
    ["من هذا", "face-recognize"],
    ["enroll this person", "face-enroll"],
    ["سجل هذا الشخص", "face-enroll"],
    ["find my keys", "find-object"],
    ["وين مفاتيحي", "find-object"],
    ["money please", "currency-recognize"],
    ["فلوس", "currency-recognize"],
    ["color of this", "color-detect"],
    ["لون هذا", "color-detect"],
  ];

  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, async () => {
      const r = await routeCommand(text);
      expect(r?.command).toBe(expected as any);
    });
  }

  test("keyword match skips the LLM entirely (no fetch)", async () => {
    fm = mockChatContent('{"intent":"visual_qa"}'); // would mislead if called
    const r = await routeCommand("describe the room");
    expect(r?.command).toBe("scene-summarize");
    expect(fm.calls).toBe(0);
  });

  test("find-object extracts the bare object name as a param", async () => {
    const r = await routeCommand("find my keys");
    expect(r?.command).toBe("find-object");
    expect(r?.params?.objectName).toBe("my keys");
  });

  test("empty / whitespace transcription → null", async () => {
    expect(await routeCommand("")).toBeNull();
    expect(await routeCommand("   ")).toBeNull();
  });
});

describe("intent router — terse one-word commands with STT punctuation", () => {
  // ElevenLabs Scribe appends terminal punctuation; a blind user's one-word
  // command ("Describe.", "Who?") must still hit the keyword fast-path and never
  // pay the LLM round-trip (or misroute to visual-qa when the LLM is down).
  const cases: Array<[string, string]> = [
    ["Describe.", "scene-summarize"],
    ["Read.", "ocr-read-text"],
    ["Who?", "face-recognize"],
    ["Money.", "currency-recognize"],
    ["Color!", "color-detect"],
    ["وصف.", "scene-summarize"],
    ["من؟", "face-recognize"],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected} (punctuation stripped, no LLM)`, async () => {
      fm = mockChatContent('{"intent":"visual_qa"}'); // would mislead if the LLM were consulted
      const r = await routeCommand(text);
      expect(r?.command).toBe(expected as any);
      expect(fm.calls).toBe(0);
    });
  }

  test("trailing punctuation is trimmed off the find-object param", async () => {
    const r = await routeCommand("find my keys.");
    expect(r?.command).toBe("find-object");
    expect(r?.params?.objectName).toBe("my keys");
  });
});

describe("intent router — LLM path (DT-R2 known intent)", () => {
  test("paraphrase with no trigger word → LLM intent used", async () => {
    fm = mockChatContent('{"intent":"scene_summarize"}');
    const r = await routeCommand("what is in front of me");
    expect(r?.command).toBe("scene-summarize");
    expect(fm.calls).toBe(1);
  });

  test("LLM find_object param → objectName", async () => {
    fm = mockChatContent('{"intent":"find_object","param":"keys"}');
    const r = await routeCommand("where did I leave my keys");
    expect(r?.command).toBe("find-object");
    expect(r?.params?.objectName).toBe("keys");
  });

  test("LLM visual_qa param → question", async () => {
    fm = mockChatContent('{"intent":"visual_qa","param":"is the door open"}');
    const r = await routeCommand("tell me if the door is open");
    expect(r?.command).toBe("visual-qa");
    expect(r?.params?.question).toBe("is the door open");
  });

  test("strips markdown code fences around the JSON", async () => {
    fm = mockChatContent('```json\n{"intent":"color_detect"}\n```');
    const r = await routeCommand("what shade is this wall");
    expect(r?.command).toBe("color-detect");
  });
});

describe("intent router — clarification (DT-R3 unknown)", () => {
  test('LLM "unknown" → command "unknown" (no fabricated visual command)', async () => {
    fm = mockChatContent('{"intent":"unknown"}');
    const r = await routeCommand("what time is it");
    expect(r?.command).toBe("unknown" as any);
  });
});

describe("intent router — degraded fallback (DT-R4 → visual-qa)", () => {
  test("LLM abort/timeout → keyword fallback → visual-qa", async () => {
    fm = mockFetchReject("abort");
    const r = await routeCommand("how many people are in the room");
    expect(r?.command).toBe("visual-qa");
    expect(r?.params?.question).toBe("how many people are in the room");
  });

  test("LLM HTTP error → fallback → visual-qa", async () => {
    fm = mockHttpError(500);
    const r = await routeCommand("describe nothing in particular here please");
    // 'describe' is the first word → keyword fast-path actually wins; use a
    // trigger-less phrase to force the LLM path:
    const r2 = await routeCommand("is anyone waving at me");
    expect(r2?.command).toBe("visual-qa");
  });

  test("LLM malformed JSON → fallback → visual-qa", async () => {
    fm = mockChatContent("not json at all");
    const r = await routeCommand("anything interesting nearby");
    expect(r?.command).toBe("visual-qa");
  });

  test("LLM empty content → fallback → visual-qa", async () => {
    fm = mockEmptyContent();
    const r = await routeCommand("look around for me");
    expect(r?.command).toBe("visual-qa");
  });
});
