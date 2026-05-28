/**
 * Tier 2 integration — photo-token lifecycle (no hardware).
 * Fills: Table 13.11 (photo-token rows).
 * Case IDs: BLE-01 (valid unexpired token → bytes cached + returned),
 *           BLE-02 (token older than 60 s → rejected; boundary 59 999 /
 *           60 000 / 60 001 ms).
 *
 * Drives the REAL photo-cache (src/services/photo-cache.ts). The 60 s TTL is a
 * Date.now() comparison (expiresAt <= now), so we use setSystemTime for an
 * exact boundary. A route-level round trip (upload-url → glasses upload → wait)
 * exercises the production Express handlers end to end in-process.
 */
import { test, expect, describe, afterEach, setSystemTime } from "bun:test";
import { mintToken, storeBytes, getBytes, waitForBytes, evict, size } from "../../src/services/photo-cache";
import { registerRelayRoutes } from "../../src/relay/routes";
import { startApp, setSharedSecret, restoreSharedSecret, authHeaders, type RunningApp } from "../helpers/relay-app";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T0ms = T0.getTime();

afterEach(() => setSystemTime()); // reset to real clock

describe("BLE-01: valid unexpired token caches + returns bytes", () => {
  test("mint → store → getBytes returns the same bytes", () => {
    const { photoToken } = mintToken("dev-1");
    expect(getBytes(photoToken)).toBeNull(); // not uploaded yet
    const buf = Buffer.from("jpegdata");
    expect(storeBytes(photoToken, buf)).toBe(true);
    expect(getBytes(photoToken)?.toString()).toBe("jpegdata");
    evict(photoToken);
  });

  test("getBytes is non-evicting (two parallel reads both succeed)", () => {
    const { photoToken } = mintToken("dev-1");
    storeBytes(photoToken, Buffer.from("x"));
    expect(getBytes(photoToken)).not.toBeNull();
    expect(getBytes(photoToken)).not.toBeNull(); // describe-scene reads twice
    evict(photoToken);
  });

  test("unknown token → null; storeBytes to unknown token → false", () => {
    expect(getBytes("deadbeef")).toBeNull();
    expect(storeBytes("deadbeef", Buffer.from("x"))).toBe(false);
  });
});

describe("BLE-02: 60 s TTL boundary (59 999 / 60 000 / 60 001 ms)", () => {
  test("at 59 999 ms the token is still valid", () => {
    setSystemTime(T0);
    const { photoToken } = mintToken("dev-1");
    storeBytes(photoToken, Buffer.from("x"));
    setSystemTime(new Date(T0ms + 59_999));
    expect(getBytes(photoToken)).not.toBeNull();
    evict(photoToken);
  });

  test("at exactly 60 000 ms the token is expired (expiresAt <= now)", () => {
    setSystemTime(T0);
    const { photoToken } = mintToken("dev-1");
    storeBytes(photoToken, Buffer.from("x"));
    setSystemTime(new Date(T0ms + 60_000));
    expect(getBytes(photoToken)).toBeNull(); // boundary: 60 000 → rejected
  });

  test("at 60 001 ms it is rejected and storeBytes returns false", () => {
    setSystemTime(T0);
    const { photoToken } = mintToken("dev-1");
    setSystemTime(new Date(T0ms + 60_001));
    expect(getBytes(photoToken)).toBeNull();
    expect(storeBytes(photoToken, Buffer.from("x"))).toBe(false); // expired
  });

  test("waitForBytes on an already-expired token resolves null immediately", async () => {
    setSystemTime(T0);
    const { photoToken } = mintToken("dev-1");
    setSystemTime(new Date(T0ms + 60_001));
    expect(await waitForBytes(photoToken, 5_000)).toBeNull();
  });
});

describe("route-level round trip: upload-url → upload → wait (BLE-01 end to end)", () => {
  const SECRET = "relay-secret";
  const DEVICE = "device-int-1";
  let app: RunningApp;

  test("the full production relay path returns the uploaded bytes", async () => {
    setSharedSecret(SECRET);
    app = await startApp((a) => registerRelayRoutes(a));
    try {
      // 1. mint upload URL (authed)
      const mintRes = await fetch(`${app.url}/api/photo/upload-url`, {
        method: "POST",
        headers: { ...authHeaders(DEVICE, SECRET), "Content-Type": "application/json" },
        body: "{}",
      });
      expect(mintRes.status).toBe(200);
      const { photoToken, uploadUrl } = await mintRes.json();
      expect(typeof photoToken).toBe("string");

      // 2. glasses upload (UNAUTHENTICATED — token in URL is the auth)
      const form = new FormData();
      form.append("photo", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }), "p.jpg");
      form.append("requestId", photoToken);
      const upRes = await fetch(uploadUrl, { method: "POST", body: form });
      expect(upRes.status).toBe(200);
      expect((await upRes.json()).bytes).toBe(4);

      // 3. wait long-poll resolves immediately (bytes already present), authed
      const waitRes = await fetch(`${app.url}/api/photo/wait/${photoToken}`, { headers: authHeaders(DEVICE, SECRET) });
      expect(waitRes.status).toBe(200);
      const waitBody = await waitRes.json();
      expect(waitBody.ok).toBe(true);
      expect(waitBody.bytes).toBe(4);
    } finally {
      await app.close();
      restoreSharedSecret();
    }
  });
});
