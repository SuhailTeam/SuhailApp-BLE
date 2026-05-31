import { afterEach, describe, expect, test } from "bun:test";
import { routeCommand } from "../../src/relay/command-router";
import { evict, getBytes, mintToken, storeBytes, waitForBytes } from "../../src/services/photo-cache";
import { decodeExternalImageId, encodeExternalImageId } from "../../src/utils/external-image-id";
import { stripAnnotations } from "../../src/utils/transcription-filter";
import { config } from "../../src/utils/config";
import {
  clearPending,
  getPendingPhoto,
  hasPending,
  interrupt,
  setPendingPhoto,
  takeInterruptedFlag,
  unmarkProcessing,
} from "../../mobile/src/state/enrollment";

const originalFetch = globalThis.fetch;
const originalApiKey = config.openRouterApiKey;
const mintedTokens: string[] = [];

function mintTracked() {
  const minted = mintToken("regression-device");
  mintedTokens.push(minted.photoToken);
  return minted;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  (config as any).openRouterApiKey = originalApiKey;

  for (const token of mintedTokens.splice(0)) {
    evict(token);
  }

  clearPending();
  unmarkProcessing();
  takeInterruptedFlag();
});

describe("regression coverage for known fixed Suhail edge cases", () => {
  test("Scribe parenthetical annotations do not leave stray spaces before punctuation", () => {
    expect(stripAnnotations("Describe my surroundings (clicks tongue).")).toBe(
      "Describe my surroundings."
    );
    expect(stripAnnotations("Read (coughs) this sign")).toBe("Read this sign");
  });

  test("unparseable LLM output still falls back to deterministic keyword routing", async () => {
    (config as any).openRouterApiKey = "test-key";
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "```json\nnot-json\n```" } }] }),
    })) as typeof fetch;

    const result = await routeCommand("color of this shirt");

    expect(result?.command).toBe("color-detect");
  });

  test("Arabic and mixed-script enrolled names survive ExternalImageId encoding", () => {
    const names = ["عبدالله", "فaisal مختلط", "اسم فيه مسافة"];

    for (const name of names) {
      expect(decodeExternalImageId(encodeExternalImageId(name))).toBe(name);
    }
  });

  test("photo upload waiters are woken when the BLE webhook stores bytes", async () => {
    const { photoToken } = mintTracked();
    const firstWaiter = waitForBytes(photoToken, 100);
    const secondWaiter = waitForBytes(photoToken, 100);
    const uploaded = Buffer.from("same-photo-for-parallel-consumers");

    expect(storeBytes(photoToken, uploaded)).toBe(true);

    expect(await firstWaiter).toEqual(uploaded);
    expect(await secondWaiter).toEqual(uploaded);
    expect(getBytes(photoToken)).toEqual(uploaded);
  });

  test("face-enrollment interrupt suppresses stale success after pending state is cleared", () => {
    setPendingPhoto("stale-photo-token");

    expect(interrupt()).toBe(true);
    expect(hasPending()).toBe(false);
    expect(getPendingPhoto()).toBeNull();
    expect(takeInterruptedFlag()).toBe(true);
    expect(takeInterruptedFlag()).toBe(false);
  });
});
