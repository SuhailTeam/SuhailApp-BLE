/**
 * Tier 1 unit — color-detect dominant-color extraction.
 * Fills: Table 13.9 (color-detect dominant-color extraction).
 * Case IDs: EP-10 (deterministic given a fixture → asserts color name + hex).
 *
 * detectColor (src/services/vision-service.ts) calls the vision LLM and parses
 * its JSON. We stub the `fetch` so the parse + fallback logic runs
 * deterministically (no network). Asserts the parsed name+hex and the
 * localized fallback when the model output is unusable.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { detectColor } from "../../src/services/vision-service";
import { setApiKey, restore, mockLLMContent } from "../helpers/openrouter-mock";

const IMG = "ZmFrZQ==";
afterEach(() => restore());

describe("EP-10: parses colorName + hex from the model JSON", () => {
  test("red", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({ colorName: "red", hex: "#FF0000" }));
    const r = await detectColor(IMG, "en");
    expect(r.colorName).toBe("red");
    expect(r.hex).toBe("#FF0000");
  });
  test("markdown-fenced JSON is tolerated", async () => {
    setApiKey("test-key");
    mockLLMContent("```json\n{\"colorName\":\"navy blue\",\"hex\":\"#000080\"}\n```");
    const r = await detectColor(IMG, "en");
    expect(r.colorName).toBe("navy blue");
    expect(r.hex).toBe("#000080");
  });
});

describe("output handling when the model is unusable", () => {
  // ACTUAL behaviour (verified): detectColor re-throws on UNPARSEABLE JSON —
  // the command handler catches it and speaks generalError. The localized
  // default ("unknown"/"غير معروف", #000000) applies only to VALID-but-empty
  // JSON. We assert both real paths rather than assume a swallow-all fallback.
  test("unparseable model output → detectColor rejects (handler speaks error)", async () => {
    setApiKey("test-key");
    mockLLMContent("???");
    await expect(detectColor(IMG, "en")).rejects.toThrow();
  });
  test("valid-but-empty JSON → localized default (en)", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({}));
    const r = await detectColor(IMG, "en");
    expect(r.colorName).toBe("unknown");
    expect(r.hex).toBe("#000000");
  });
  test("valid-but-empty JSON → localized default (ar)", async () => {
    setApiKey("test-key");
    mockLLMContent(JSON.stringify({}));
    const r = await detectColor(IMG, "ar");
    expect(r.colorName).toBe("غير معروف");
  });
});
