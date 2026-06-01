import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { computeDeviceToken } from "../../src/relay/auth";

// Device-token derivation: token = hex(HMAC-SHA256(deviceId, secret)) (BLE-04).

describe("computeDeviceToken (HMAC device auth)", () => {
  test("matches an independent HMAC-SHA256 computation", () => {
    const deviceId = "device-abc-123";
    const secret = "shared-secret";
    const expected = crypto.createHmac("sha256", secret).update(deviceId).digest("hex");
    expect(computeDeviceToken(deviceId, secret)).toBe(expected);
  });

  test("is 64 lowercase hex characters", () => {
    const token = computeDeviceToken("anything", "key");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic for identical inputs", () => {
    expect(computeDeviceToken("d", "s")).toBe(computeDeviceToken("d", "s"));
  });

  test("differs when the deviceId differs", () => {
    expect(computeDeviceToken("d1", "s")).not.toBe(computeDeviceToken("d2", "s"));
  });

  test("differs when the secret differs", () => {
    expect(computeDeviceToken("d", "s1")).not.toBe(computeDeviceToken("d", "s2"));
  });
});
