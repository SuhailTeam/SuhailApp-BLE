import { afterEach, describe, expect, test } from "bun:test";
import { evict, getBytes, mintToken, size, storeBytes, waitForBytes } from "../../src/services/photo-cache";

const originalDateNow = Date.now;
const mintedTokens: string[] = [];

function mintTracked(deviceId = "device-test") {
  const minted = mintToken(deviceId);
  mintedTokens.push(minted.photoToken);
  return minted;
}

afterEach(() => {
  Date.now = originalDateNow;
  for (const token of mintedTokens.splice(0)) {
    evict(token);
  }
});

describe("photo token lifecycle (Phase 2 EP/BVA from Section 13.2)", () => {
  test("mints a 32-hex-character token with a 60-second TTL", () => {
    Date.now = () => 1_000;

    const { photoToken, expiresAt } = mintTracked();

    expect(photoToken).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt).toBe(61_000);
    expect(size()).toBeGreaterThanOrEqual(1);
  });

  test("stores bytes, returns them, and wakes waiters", async () => {
    const { photoToken } = mintTracked();
    const waiter = waitForBytes(photoToken, 100);
    const bytes = Buffer.from("photo-bytes");

    expect(storeBytes(photoToken, bytes)).toBe(true);

    expect(await waiter).toEqual(bytes);
    expect(getBytes(photoToken)).toEqual(bytes);
  });

  test("waitForBytes returns null for unknown tokens and on timeout", async () => {
    expect(await waitForBytes("missing", 1)).toBeNull();

    const { photoToken } = mintTracked();
    expect(await waitForBytes(photoToken, 1)).toBeNull();
  });

  test("rejects expired tokens at the TTL boundary", () => {
    let now = 1_000;
    Date.now = () => now;
    const { photoToken } = mintTracked();

    now = 60_999;
    expect(storeBytes(photoToken, Buffer.from("before-expiry"))).toBe(true);

    const second = mintTracked();
    now = second.expiresAt;
    expect(storeBytes(second.photoToken, Buffer.from("at-expiry"))).toBe(false);
    expect(getBytes(second.photoToken)).toBeNull();
  });

  test("manual eviction removes cached bytes", () => {
    const { photoToken } = mintTracked();
    storeBytes(photoToken, Buffer.from("photo"));

    evict(photoToken);

    expect(getBytes(photoToken)).toBeNull();
  });
});
