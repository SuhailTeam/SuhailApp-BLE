import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestServer, authHeaders, type TestServer } from "../helpers/relay-app";

// HMAC device auth on the live relay router (BLE-04/05/06). Uses /api/intent
// with a keyword utterance so the request never reaches an external service.

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

describe("relay auth (HMAC bearer)", () => {
  test("valid token → 200 (BLE-04)", async () => {
    const res = await fetch(`${srv.base}/api/intent`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text: "describe the room" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.command).toBe("scene-summarize");
  });

  test("invalid bearer token → 401 (BLE-05)", async () => {
    const res = await fetch(`${srv.base}/api/intent`, {
      method: "POST",
      headers: {
        "X-Device-Id": "test-device",
        Authorization: "Bearer 00deadbeef",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "describe the room" }),
    });
    expect(res.status).toBe(401);
  });

  test("missing X-Device-Id → 401 (BLE-06)", async () => {
    const res = await fetch(`${srv.base}/api/intent`, {
      method: "POST",
      headers: { Authorization: "Bearer abc", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "describe the room" }),
    });
    expect(res.status).toBe(401);
  });

  test("missing Authorization header → 401 (BLE-06)", async () => {
    const res = await fetch(`${srv.base}/api/intent`, {
      method: "POST",
      headers: { "X-Device-Id": "test-device", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "describe the room" }),
    });
    expect(res.status).toBe(401);
  });

  test("health probe is open (no auth)", async () => {
    const res = await fetch(`${srv.base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
