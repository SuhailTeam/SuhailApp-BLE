import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestServer, authHeaders, uploadPhoto, type TestServer } from "../helpers/relay-app";

// Token-mediated BLE photo flow end-to-end through the relay (BLE-01/02/03):
// mint → glasses upload (unauthenticated webhook) → mobile long-poll resolves.

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => {
  await srv.close();
});

async function mint(): Promise<{ photoToken: string; uploadUrl: string }> {
  const res = await fetch(`${srv.base}/api/photo/upload-url`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe("photo flow", () => {
  test("upload-url mints a token + reachable uploadUrl (BLE-01)", async () => {
    const { photoToken, uploadUrl } = await mint();
    expect(photoToken).toMatch(/^[0-9a-f]{32}$/);
    expect(uploadUrl).toContain(`/api/photo/upload/${photoToken}`);
  });

  test("upload-url requires auth", async () => {
    const res = await fetch(`${srv.base}/api/photo/upload-url`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("glasses upload (unauthenticated) then wait resolves with byte count (BLE-01/03)", async () => {
    const { photoToken } = await mint();
    const up = await uploadPhoto(srv.base, photoToken, Buffer.from("fake-jpeg-bytes"));
    expect(up.status).toBe(200);
    expect((await up.json()).success).toBe(true);

    const waitRes = await fetch(`${srv.base}/api/photo/wait/${photoToken}`, { headers: authHeaders() });
    expect(waitRes.status).toBe(200);
    const body = await waitRes.json();
    expect(body.ok).toBe(true);
    expect(body.bytes).toBe("fake-jpeg-bytes".length);
  });

  test("long-poll resolves when the upload arrives mid-wait (BLE-03)", async () => {
    const { photoToken } = await mint();
    const waitP = fetch(`${srv.base}/api/photo/wait/${photoToken}`, { headers: authHeaders() });
    await new Promise((r) => setTimeout(r, 50)); // let the waiter register
    await uploadPhoto(srv.base, photoToken, Buffer.from("xy"));
    const waitRes = await waitP;
    expect(waitRes.status).toBe(200);
    expect((await waitRes.json()).bytes).toBe(2);
  });

  test("upload to an unknown/expired token → 404 (BLE-02)", async () => {
    const up = await uploadPhoto(srv.base, "ffffffffffffffffffffffffffffffff", Buffer.from("x"));
    expect(up.status).toBe(404);
  });

  test("consuming an unknown photoToken on a vision endpoint → 404", async () => {
    const res = await fetch(`${srv.base}/api/vision/scene`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ photoToken: "ffffffffffffffffffffffffffffffff" }),
    });
    expect(res.status).toBe(404);
  });
});
