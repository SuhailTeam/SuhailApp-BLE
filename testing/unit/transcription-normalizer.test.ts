import { afterEach, describe, expect, test } from "bun:test";
import { normalizeTranscription } from "../../src/utils/transcription-normalizer";
import { mockChatContent, mockFetchReject, mockEmptyContent, type FetchMock } from "../helpers/mock-openrouter";

let fm: FetchMock | undefined;
afterEach(() => {
  fm?.restore();
  fm = undefined;
});

describe("normalizeTranscription (script-normalization, EP)", () => {
  test("fast-path: no normalization needed → unchanged, no LLM call", async () => {
    fm = mockChatContent("SHOULD NOT BE USED");
    const out = await normalizeTranscription("what is in front of me", "en");
    expect(out).toBe("what is in front of me");
    expect(fm.calls).toBe(0);
  });

  test("genuine Arabic under ar → unchanged, no LLM call", async () => {
    fm = mockChatContent("SHOULD NOT BE USED");
    const out = await normalizeTranscription("مرحبا كيف حالك", "ar");
    expect(out).toBe("مرحبا كيف حالك");
    expect(fm.calls).toBe(0);
  });

  test("Arabic-script English under en → LLM converts to Latin", async () => {
    fm = mockChatContent("what's in front of me");
    const out = await normalizeTranscription("واتس ان فرونت اوف مي", "en");
    expect(out).toBe("what's in front of me");
    expect(fm.calls).toBe(1);
  });

  test("LLM failure → returns the original text", async () => {
    fm = mockFetchReject("network");
    const input = "واتس ان فرونت اوف مي";
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });

  test("LLM empty response → returns the original text", async () => {
    fm = mockEmptyContent();
    const input = "واتس ان فرونت اوف مي";
    expect(await normalizeTranscription(input, "en")).toBe(input);
  });
});
