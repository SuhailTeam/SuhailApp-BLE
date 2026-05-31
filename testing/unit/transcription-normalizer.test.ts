import { afterEach, describe, expect, test } from "bun:test";
import { normalizeTranscription } from "../../src/utils/transcription-normalizer";
import { config } from "../../src/utils/config";

const originalFetch = globalThis.fetch;
const originalApiKey = config.openRouterApiKey;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (config as any).openRouterApiKey = originalApiKey;
});

describe("Arabic-script normalization regression set", () => {
  test("skips the network and returns original text when normalization is not needed", async () => {
    (config as any).openRouterApiKey = "test-key";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    await expect(normalizeTranscription("read the sign", "en")).resolves.toBe("read the sign");
    expect(called).toBe(false);
  });

  test("normalizes Arabic-script English when the LLM returns text", async () => {
    (config as any).openRouterApiKey = "test-key";
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "what is in front of me" } }] }),
    })) as typeof fetch;

    await expect(normalizeTranscription("واتس ان فرونت اوف مي", "en")).resolves.toBe("what is in front of me");
  });

  test("returns original text when normalization provider fails", async () => {
    (config as any).openRouterApiKey = "test-key";
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as typeof fetch;

    await expect(normalizeTranscription("واتس ان فرونت اوف مي", "en")).resolves.toBe("واتس ان فرونت اوف مي");
  });
});
