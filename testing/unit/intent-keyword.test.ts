/**
 * Tier 1 unit — IntentRouter keyword matcher.
 * Fills: Table 13.9 (IntentRouter keyword matcher).
 * Case IDs: §4.5 EP partitions — a curated trigger in Arabic and in English
 *           matches its command; an utterance with no curated trigger.
 *
 * The keyword matcher (routeCommandByKeyword) is PRIVATE in
 * src/commands/command-router.ts. Per "call production code, never reimplement
 * it", we drive it through the public routeCommand() with the OpenRouter key
 * cleared — that forces classifyIntent() to return null and the router to fall
 * straight through to the real keyword matcher with the real curated trigger
 * list. No network, no key.
 *
 * DIVERGENCE (reported in §12): the matcher has NO "no match" outcome. Any
 * utterance whose first word isn't a curated trigger falls through to
 * visual-qa (the catch-all), not to "unknown". The design doc's "no curated
 * trigger returns no match" is therefore "→ visual-qa" in the real build.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { routeCommand } from "../../src/commands/command-router";
import { setApiKey, restore } from "../helpers/openrouter-mock";

// Force the keyword fallback path for every test in this file.
setApiKey("");
afterEach(() => { setApiKey(""); }); // restore() would re-enable the real key

describe("English curated triggers (first word match)", () => {
  const cases: Array<[string, string]> = [
    ["describe the room", "scene-summarize"],
    ["read this sign", "ocr-read-text"],
    ["who is this", "face-recognize"],
    ["enroll this person", "face-enroll"],
    ["find my keys", "find-object"],
    ["money please", "currency-recognize"],
    ["color of this", "color-detect"],
  ];
  for (const [utterance, command] of cases) {
    test(`"${utterance}" → ${command}`, async () => {
      const r = await routeCommand(utterance);
      expect(r?.command as string | undefined).toBe(command);
    });
  }
});

describe("Arabic curated triggers", () => {
  const cases: Array<[string, string]> = [
    ["وصف ما حولي", "scene-summarize"],
    ["اقرأ هذا", "ocr-read-text"],
    ["من هذا الشخص", "face-recognize"],
    ["سجل هذا الشخص", "face-enroll"],
    ["وين مفاتيحي", "find-object"],
    ["فلوس", "currency-recognize"],
    ["لون هذا", "color-detect"],
  ];
  for (const [utterance, command] of cases) {
    test(`"${utterance}" → ${command}`, async () => {
      const r = await routeCommand(utterance);
      expect(r?.command as string | undefined).toBe(command);
    });
  }
});

describe("parameter extraction in the keyword path", () => {
  test("find-object extracts the object name (everything after the trigger)", async () => {
    const r = await routeCommand("find my keys");
    expect(r?.command as string | undefined).toBe("find-object");
    expect(r?.params?.objectName).toBe("my keys");
  });
  test("find with no object falls back to the literal 'object'", async () => {
    const r = await routeCommand("find");
    expect(r?.params?.objectName).toBe("object");
  });
});

describe("no curated trigger → visual-qa catch-all (divergence: not 'no match')", () => {
  test('"what is the meaning of life" → visual-qa', async () => {
    const r = await routeCommand("what is the meaning of life");
    expect(r?.command as string | undefined).toBe("visual-qa");
    expect(r?.params?.question).toBe("what is the meaning of life");
  });
  test("empty transcription → null (the one true 'no result')", async () => {
    expect(await routeCommand("   ")).toBeNull();
  });
});
