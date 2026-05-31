import { afterEach, describe, expect, test } from "bun:test";
import { computeDeviceToken, relayAuth } from "../../src/relay/auth";
import { config } from "../../src/utils/config";

const originalSecret = config.relaySharedSecret;

function mockReq(headers: Record<string, string | undefined>) {
  return {
    header(name: string) {
      return headers[name];
    },
  } as any;
}

function mockRes() {
  const state = { statusCode: 200, body: undefined as unknown };
  return {
    state,
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as any;
}

afterEach(() => {
  (config as any).relaySharedSecret = originalSecret;
});

describe("relay HMAC authentication (Phase 2 Section 13.2 cases)", () => {
  test("computes a stable SHA-256 HMAC bearer token", () => {
    const token = computeDeviceToken("device-123", "secret");

    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(computeDeviceToken("device-123", "secret")).toBe(token);
    expect(computeDeviceToken("device-456", "secret")).not.toBe(token);
  });

  test("accepts a valid authenticated request and stores the device id", () => {
    (config as any).relaySharedSecret = "secret";
    const req = mockReq({
      "X-Device-Id": "device-123",
      Authorization: `Bearer ${computeDeviceToken("device-123", "secret")}`,
    });
    const res = mockRes();
    let nextCalled = false;

    relayAuth(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.deviceId).toBe("device-123");
    expect(res.state.statusCode).toBe(200);
  });

  test("rejects missing, malformed, and invalid credentials", () => {
    (config as any).relaySharedSecret = "secret";

    for (const headers of [
      { Authorization: "Bearer abc" },
      { "X-Device-Id": "device-123" },
      { "X-Device-Id": "device-123", Authorization: "Bearer abc" },
    ]) {
      const res = mockRes();
      let nextCalled = false;
      relayAuth(mockReq(headers), res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(res.state.statusCode).toBe(401);
    }
  });

  test("allows requests in dev mode when the shared secret is empty", () => {
    (config as any).relaySharedSecret = "";
    const res = mockRes();
    let nextCalled = false;

    relayAuth(mockReq({}), res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.state.statusCode).toBe(200);
  });
});
