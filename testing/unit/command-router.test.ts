import { afterEach, describe, expect, test } from "bun:test";
import { routeCommand, routeCommandByKeyword } from "../../src/commands/command-router";
import { config } from "../../src/utils/config";

const originalFetch = globalThis.fetch;
const originalApiKey = config.openRouterApiKey;

function setClassifierResponse(content: string, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  (config as any).openRouterApiKey = originalApiKey;
});

describe("hybrid intent router (decision table from Section 13.2.4)", () => {
  test("R1 returns a known parseable LLM intent", async () => {
    (config as any).openRouterApiKey = "test-key";
    setClassifierResponse(JSON.stringify({ intent: "find_object", param: "keys" }));

    const result = await routeCommand("where are my keys");

    expect(result?.command).toBe("find-object");
    expect(result?.params?.objectName).toBe("keys");
  });

  test("R2 falls back to keyword routing when LLM content is unparseable", async () => {
    (config as any).openRouterApiKey = "test-key";
    setClassifierResponse("not json");

    const result = await routeCommand("read this sign");

    expect(result?.command).toBe("ocr-read-text");
    expect(result?.params?.context).toBe("read this sign");
  });

  test("R3 falls back to visual QA when neither LLM nor keyword identifies a curated command", async () => {
    (config as any).openRouterApiKey = "test-key";
    setClassifierResponse("not json");

    const result = await routeCommand("is the cup full");

    expect(result?.command).toBe("visual-qa");
    expect(result?.params?.question).toBe("is the cup full");
  });

  test("R4 uses keyword routing when the LLM request fails", async () => {
    (config as any).openRouterApiKey = "test-key";
    setClassifierResponse("", false);

    const result = await routeCommand("money in my hand");

    expect(result?.command).toBe("currency-recognize");
  });

  test("R5 defaults to visual QA when LLM is unavailable and no keyword matches", async () => {
    (config as any).openRouterApiKey = "";

    const result = await routeCommand("how many cups are here");

    expect(result?.command).toBe("visual-qa");
    expect(result?.params?.question).toBe("how many cups are here");
  });

  test("returns unknown when the LLM explicitly classifies the utterance as non-visual", async () => {
    (config as any).openRouterApiKey = "test-key";
    setClassifierResponse(JSON.stringify({ intent: "unknown" }));

    const result = await routeCommand("tell me a joke");

    expect(result?.command).toBe("unknown");
  });
});

describe("keyword router partitions", () => {
  test("matches curated English and Arabic trigger words directly", () => {
    expect(routeCommandByKeyword("read this")?.command).toBe("ocr-read-text");
    expect(routeCommandByKeyword("اقرأ النص")?.command).toBe("ocr-read-text");
    expect(routeCommandByKeyword("وين المفاتيح")?.command).toBe("find-object");
  });

  test("extracts find-object params and defaults unknown keywords to visual QA", () => {
    expect(routeCommandByKeyword("find wallet")?.params?.objectName).toBe("wallet");
    expect(routeCommandByKeyword("is this door open")?.command).toBe("visual-qa");
  });
});
