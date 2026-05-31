import { afterEach, describe, expect, test } from "bun:test";
import { routeCommand } from "../../src/relay/command-router";
import { isValidTranscription, stripAnnotations } from "../../src/utils/transcription-filter";
import { normalizeTranscription } from "../../src/utils/transcription-normalizer";
import { config } from "../../src/utils/config";
import type { Language, RouteResult } from "../../src/types";

const originalFetch = globalThis.fetch;
const originalApiKey = config.openRouterApiKey;

async function runOfflineIntentPipeline(
  rawText: string,
  language: Language,
): Promise<RouteResult | { command: "rejected"; rawText: string } | null> {
  const cleaned = stripAnnotations(rawText);
  if (!cleaned || !isValidTranscription(cleaned, language)) {
    return { command: "rejected", rawText };
  }

  const normalized = await normalizeTranscription(cleaned, language);
  return routeCommand(normalized);
}

function makeLLMReturn(content: string, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  (config as any).openRouterApiKey = originalApiKey;
});

describe("speech intent pipeline integration", () => {
  test("annotation cleanup feeds a valid OCR command into the router", async () => {
    (config as any).openRouterApiKey = "";

    const result = await runOfflineIntentPipeline("read this sign (clicks tongue).", "en");

    expect(result?.command).toBe("ocr-read-text");
    expect((result as RouteResult).params?.context).toBe("read this sign.");
    expect((result as RouteResult).rawText).toBe("read this sign.");
  });

  test("garbled transcription is rejected before intent routing", async () => {
    const result = await runOfflineIntentPipeline("!!!! ?????", "en");

    expect(result).toEqual({ command: "rejected", rawText: "!!!! ?????" });
  });

  test("LLM failure falls through to keyword routing inside the integrated path", async () => {
    (config as any).openRouterApiKey = "test-key";
    makeLLMReturn("not json");

    const result = await runOfflineIntentPipeline("find wallet", "en");

    expect(result?.command).toBe("find-object");
    expect((result as RouteResult).params?.objectName).toBe("wallet");
  });

  test("LLM classification can override keyword position for paraphrased visual commands", async () => {
    (config as any).openRouterApiKey = "test-key";
    makeLLMReturn(JSON.stringify({ intent: "scene_summarize" }));

    const result = await runOfflineIntentPipeline("what is around me", "en");

    expect(result?.command).toBe("scene-summarize");
  });
});
