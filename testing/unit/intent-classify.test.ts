/**
 * Tier 1 unit — IntentRouter.classify decision-table dispatch.
 * Fills: Table 13.9 (IntentRouter.classify) + Table 13.11 router rows (DT-R1).
 * Case IDs: DT-R1…DT-R5 (Table 13.7), with a stubbed LLM adapter.
 *
 * We drive the REAL routeCommand() (src/commands/command-router.ts) and stub
 * only the OpenRouter `fetch`. Assertions are on the routing ACTION (resulting
 * command), never on LLM content.
 *
 * DECISION TABLE — DESIGN (Table 13.7) vs ACTUAL behaviour. Two genuine
 * divergences are found and reported in §12 of the results doc; we test what
 * the code ACTUALLY does (instructions: "fix only genuine labeling errors, do
 * NOT tune the router"):
 *
 *   R1  LLM timely + known intent              → LLM intent            (matches design)
 *   R2  LLM timely + 'unknown' + keyword match → DESIGN: keyword intent
 *                                                ACTUAL: 'unknown'  ◀ DIVERGENCE
 *       (when the LLM itself returns 'unknown', the router returns unknown and
 *        does NOT consult the keyword table — fallback only runs when the LLM
 *        CALL fails/times out, i.e. classifyIntent returns null.)
 *   R3  LLM timely + 'unknown' + no keyword    → 'unknown'             (matches design)
 *   R4  LLM timeout + keyword match            → keyword intent        (matches design)
 *   R5  LLM timeout + no keyword               → DESIGN: 'unknown'
 *                                                ACTUAL: 'visual-qa' ◀ DIVERGENCE
 *       (the keyword fallback's catch-all is visual-qa, never 'unknown'.)
 */
import { test, expect, describe, afterEach, jest } from "bun:test";
import { routeCommand } from "../../src/commands/command-router";
import {
  setApiKey, restore, mockLLMContent, mockLLMAbort, mockLLMHangUntilAbort,
} from "../helpers/openrouter-mock";

afterEach(() => restore());

describe("DT-R1: LLM timely + known intent → LLM intent", () => {
  test("scene_summarize", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({ intent: "scene_summarize" }));
    expect((await routeCommand("what's around me"))?.command).toBe("scene-summarize");
  });
  test("find_object carries the param", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({ intent: "find_object", param: "keys" }));
    const r = await routeCommand("where did I leave my keys");
    expect(r?.command as string | undefined).toBe("find-object");
    expect(r?.params?.objectName).toBe("keys");
  });
  test("markdown-fenced JSON from the LLM is still parsed", async () => {
    setApiKey("test-key");
    mockLLMContent("```json\n{\"intent\":\"color_detect\"}\n```");
    expect((await routeCommand("what colour"))?.command).toBe("color-detect");
  });
});

describe("DT-R2: LLM timely + 'unknown' + keyword present → ACTUAL 'unknown' (divergence)", () => {
  test("'describe' would match a keyword, but the LLM's 'unknown' wins", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({ intent: "unknown" }));
    // "describe ..." DOES match the keyword table, yet the router returns
    // unknown because the LLM call succeeded with intent=unknown.
    expect((await routeCommand("describe my surroundings"))?.command as string | undefined).toBe("unknown");
  });
});

describe("DT-R3: LLM timely + 'unknown' + no keyword → 'unknown'", () => {
  test("non-visual utterance", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({ intent: "unknown" }));
    expect((await routeCommand("what time is it"))?.command as string | undefined).toBe("unknown");
  });
});

describe("DT-R4: LLM timeout + keyword match → keyword intent", () => {
  test("aborted LLM call falls back to the keyword 'read' → ocr-read-text", async () => {
    setApiKey("test-key");
    mockLLMAbort(); // classifyIntent catches AbortError → null → keyword fallback
    expect((await routeCommand("read this menu"))?.command).toBe("ocr-read-text");
  });
});

describe("DT-R5: LLM timeout + no keyword → ACTUAL 'visual-qa' (divergence)", () => {
  test("aborted LLM call + non-trigger utterance falls back to visual-qa", async () => {
    setApiKey("test-key");
    mockLLMAbort();
    const r = await routeCommand("is it going to rain later");
    expect(r?.command as string | undefined).toBe("visual-qa");
    expect(r?.params?.question).toBe("is it going to rain later");
  });
});

describe("the 3 s classification timeout actually fires (fake timers)", () => {
  test("a hung LLM request is aborted at CLASSIFY_TIMEOUT_MS → keyword fallback", async () => {
    setApiKey("test-key");
    mockLLMHangUntilAbort();
    jest.useFakeTimers();
    try {
      const p = routeCommand("read this label");
      // The fetch never resolves on its own; only the internal 3 s timeout
      // aborts it. Advance past CLASSIFY_TIMEOUT_MS (3000 ms).
      jest.advanceTimersByTime(3_001);
      const r = await p;
      expect(r?.command as string | undefined).toBe("ocr-read-text"); // keyword fallback fired
    } finally {
      jest.useRealTimers();
    }
  });
});
