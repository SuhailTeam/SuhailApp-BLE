import { describe, expect, test } from "bun:test";
import { encodeName, decodeName, getSimilarityThreshold } from "../../src/services/face-service";

// Rekognition ExternalImageId must be ASCII-safe, so names are hex-encoded.
// Round-trip fidelity across scripts is the regression that matters (BLE names).

describe("ExternalImageId hex encode/decode", () => {
  const names = ["Alice", "نورة", "José", "Ali محمد", "  spaced  ", "O'Brien-7"];
  for (const name of names) {
    test(`round-trips "${name}"`, () => {
      const encoded = encodeName(name);
      expect(encoded).toMatch(/^[0-9a-f]*$/); // ASCII-safe hex
      expect(decodeName(encoded)).toBe(name);
    });
  }

  test("empty name round-trips to empty", () => {
    expect(decodeName(encodeName(""))).toBe("");
  });
});

describe("getSimilarityThreshold (ratio↔percent)", () => {
  test("returns a percent in (0, 100] for the configured threshold", () => {
    const t = getSimilarityThreshold();
    // CONFIDENCE_THRESHOLD=0.5 (ratio) in preload → 50 (percent)
    expect(t).toBe(50);
  });
});
