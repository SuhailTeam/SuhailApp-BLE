import { afterEach, describe, expect, test } from "bun:test";
import { stripAnnotations } from "../../src/utils/transcription-filter";
import { routeCommand } from "../../src/relay/command-router";
import { encodeName, decodeName } from "../../src/services/face-service";
import { mintToken, storeBytes, waitForBytes, evict } from "../../src/services/photo-cache";
import { mockChatContent, type FetchMock } from "../helpers/mock-openrouter";

// One reproduction per previously-fixed defect (report Table 13.11). Each guards
// the corrected behaviour against future regressions.

let fm: FetchMock | undefined;
afterEach(() => {
  fm?.restore();
  fm = undefined;
});

describe("Regression: Scribe annotation cleanup preserves punctuation (PR #7/#10)", () => {
  test('no stray space before the period: "surroundings (clicks tongue)." ', () => {
    // The original single-regex version left "surroundings ." with a stray space.
    expect(stripAnnotations("Describe my surroundings (clicks tongue).")).toBe(
      "Describe my surroundings.",
    );
  });
});

describe("Regression: invalid LLM output falls back to deterministic keyword routing", () => {
  test("malformed (non-JSON) LLM content does not break routing", async () => {
    fm = mockChatContent("totally not json");
    // trigger-less phrase forces the LLM path, which then falls back to keywords
    const r = await routeCommand("anything noteworthy nearby");
    expect(r?.command).toBe("visual-qa");
  });
});

describe("Regression: Arabic/mixed names survive ExternalImageId encoding", () => {
  for (const name of ["نورة", "Mohammed محمد", "José", "Ali-7"]) {
    test(`"${name}" round-trips unchanged`, () => {
      expect(decodeName(encodeName(name))).toBe(name);
    });
  }
});

describe("Regression: BLE photo upload wakes waiting consumers", () => {
  test("a pending waitForBytes resolves the instant storeBytes fires", async () => {
    const { photoToken } = mintToken("regress");
    try {
      const pending = waitForBytes(photoToken, 1000);
      storeBytes(photoToken, Buffer.from("woke-up"));
      expect(await pending).toEqual(Buffer.from("woke-up"));
    } finally {
      evict(photoToken);
    }
  });
});
