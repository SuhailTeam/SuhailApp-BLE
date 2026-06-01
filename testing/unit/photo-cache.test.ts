import { afterEach, describe, expect, test, setSystemTime } from "bun:test";
import { mintToken, storeBytes, getBytes, waitForBytes, evict, size } from "../../src/services/photo-cache";

// Token lifecycle for the BLE two-step photo flow (BLE-01/02; BV photo TTL).
// The cache is a module singleton, so each test evicts the tokens it mints.

const minted: string[] = [];
function mint(): string {
  const { photoToken } = mintToken("dev-test");
  minted.push(photoToken);
  return photoToken;
}

afterEach(() => {
  setSystemTime(); // reset any faked clock
  for (const t of minted.splice(0)) evict(t);
});

describe("photo-cache token lifecycle", () => {
  test("mintToken returns a 32-hex token and a ~60s expiry", () => {
    const before = Date.now();
    const { photoToken, expiresAt } = mintToken("dev-test");
    minted.push(photoToken);
    expect(photoToken).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(expiresAt).toBeLessThanOrEqual(before + 61_000);
  });

  test("store → get round-trips the bytes (non-evicting read)", () => {
    const t = mint();
    const bytes = Buffer.from("jpeg-data");
    expect(storeBytes(t, bytes)).toBe(true);
    expect(getBytes(t)).toEqual(bytes);
    expect(getBytes(t)).toEqual(bytes); // still there — read does not evict
  });

  test("getBytes on an unknown token → null", () => {
    expect(getBytes("deadbeef")).toBeNull();
  });

  test("storeBytes on an unknown token → false", () => {
    expect(storeBytes("deadbeef", Buffer.from("x"))).toBe(false);
  });

  test("evict removes the entry", () => {
    const t = mint();
    storeBytes(t, Buffer.from("x"));
    evict(t);
    expect(getBytes(t)).toBeNull();
  });

  test("expired token (past 60s TTL) reads as null (BV photo TTL)", () => {
    const t = mint();
    storeBytes(t, Buffer.from("x"));
    setSystemTime(new Date(Date.now() + 61_000));
    expect(getBytes(t)).toBeNull();
  });
});

describe("photo-cache long-poll (waitForBytes)", () => {
  test("resolves immediately when bytes are already cached", async () => {
    const t = mint();
    storeBytes(t, Buffer.from("ready"));
    expect(await waitForBytes(t, 1000)).toEqual(Buffer.from("ready"));
  });

  test("resolves when storeBytes fires while waiting", async () => {
    const t = mint();
    const p = waitForBytes(t, 1000);
    storeBytes(t, Buffer.from("late"));
    expect(await p).toEqual(Buffer.from("late"));
  });

  test("resolves null on timeout (BLE-03)", async () => {
    const t = mint();
    expect(await waitForBytes(t, 20)).toBeNull();
  });

  test("unknown token → resolves null immediately", async () => {
    expect(await waitForBytes("deadbeef", 1000)).toBeNull();
  });
});

describe("photo-cache capacity cap", () => {
  test("minting beyond 20 in-flight entries throws", () => {
    const tokens: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { photoToken } = mintToken("dev-cap");
      tokens.push(photoToken);
      minted.push(photoToken);
    }
    expect(size()).toBeGreaterThanOrEqual(20);
    expect(() => mintToken("dev-cap")).toThrow(/capacity/);
  });
});
