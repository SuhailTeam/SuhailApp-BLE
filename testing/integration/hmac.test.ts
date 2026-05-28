/**
 * Tier 2 integration — HMAC device-auth (no hardware).
 * Fills: Table 13.11 (HMAC rows).
 * Case IDs: BLE-04 (correct signature → accepted), BLE-05 (wrong signature →
 *           401), BLE-06 (timestamp outside skew window → 401).
 *
 * Drives the REAL relayAuth middleware + computeDeviceToken (src/relay/auth.ts)
 * mounted on an in-process Express app, over real HTTP.
 *
 * DIVERGENCE (reported in §12): BLE-06 (timestamp / clock-skew window) is NOT
 * implemented. The bearer token is a STATIC HMAC-SHA256(deviceId, secret) with
 * NO timestamp component, so there is no skew window to test and no replay
 * protection (by design — CLAUDE.md calls it a "soft rate-limiter, not real
 * auth"). We assert the real accept/reject behaviour and document BLE-06 as
 * not-applicable-to-this-build.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { relayAuth } from "../../src/relay/auth";
import { startApp, setSharedSecret, restoreSharedSecret, authHeaders, type RunningApp } from "../helpers/relay-app";

const SECRET = "test-shared-secret-123";
const DEVICE = "device-test-abcd1234";
let app: RunningApp;

beforeAll(async () => {
  setSharedSecret(SECRET);
  app = await startApp((a) => {
    const express = require("express");
    a.use(express.json());
    a.get("/protected", relayAuth, (req: any, res: any) => res.json({ ok: true, deviceId: req.deviceId }));
  });
});

afterAll(async () => {
  await app.close();
  restoreSharedSecret();
});

describe("BLE-04: correct signature is accepted", () => {
  test("valid HMAC(deviceId,secret) → 200 + deviceId echoed back", async () => {
    const res = await fetch(`${app.url}/protected`, { headers: authHeaders(DEVICE, SECRET) });
    expect(res.status).toBe(200);
    expect((await res.json()).deviceId).toBe(DEVICE);
  });
});

describe("BLE-05: wrong / missing signature is rejected", () => {
  test("tampered token → 401", async () => {
    const res = await fetch(`${app.url}/protected`, {
      headers: { "X-Device-Id": DEVICE, Authorization: "Bearer deadbeef" },
    });
    expect(res.status).toBe(401);
  });
  test("token for a DIFFERENT device → 401", async () => {
    const res = await fetch(`${app.url}/protected`, {
      headers: { "X-Device-Id": DEVICE, ...{ Authorization: authHeaders("someone-else", SECRET).Authorization } },
    });
    expect(res.status).toBe(401);
  });
  test("missing X-Device-Id → 401", async () => {
    const res = await fetch(`${app.url}/protected`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(401);
  });
  test("missing Authorization → 401", async () => {
    const res = await fetch(`${app.url}/protected`, { headers: { "X-Device-Id": DEVICE } });
    expect(res.status).toBe(401);
  });
  test("malformed Authorization (no Bearer) → 401", async () => {
    const res = await fetch(`${app.url}/protected`, {
      headers: { "X-Device-Id": DEVICE, Authorization: computeValid() },
    });
    expect(res.status).toBe(401);
  });
});

describe("invalid-signature rejection rate", () => {
  test("100 random wrong tokens are ALL rejected (100% rejection)", async () => {
    let rejected = 0;
    const N = 100;
    for (let i = 0; i < N; i++) {
      const res = await fetch(`${app.url}/protected`, {
        headers: { "X-Device-Id": DEVICE, Authorization: `Bearer ${(i * 2654435761).toString(16)}` },
      });
      if (res.status === 401) rejected++;
    }
    expect(rejected).toBe(N); // 100% — reported to Table 13.11
  });
});

describe("BLE-06: timestamp/clock-skew window — NOT IMPLEMENTED (documented)", () => {
  test("token has no timestamp component → the same token is accepted regardless of time", async () => {
    // Re-using the exact same valid token twice succeeds both times: there is
    // no nonce/timestamp, so no skew window exists to test. Documented as a
    // build divergence, not a test failure.
    const h = authHeaders(DEVICE, SECRET);
    expect((await fetch(`${app.url}/protected`, { headers: h })).status).toBe(200);
    expect((await fetch(`${app.url}/protected`, { headers: h })).status).toBe(200);
  });
});

// Helper: a syntactically valid token but WITHOUT the "Bearer " prefix.
function computeValid(): string {
  return authHeaders(DEVICE, SECRET).Authorization.replace("Bearer ", "");
}
