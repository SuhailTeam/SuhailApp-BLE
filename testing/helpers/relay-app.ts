/**
 * Boots the real relay Express app (src/server.ts → buildApp) on an ephemeral
 * port for in-process HTTP integration tests, and builds valid HMAC auth headers
 * the same way the mobile client does.
 */
import { buildApp } from "../../src/server";
import { computeDeviceToken } from "../../src/relay/auth";
import { config } from "../../src/utils/config";

export interface TestServer {
  base: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = buildApp();
  const server: any = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Headers for an authenticated relay request (valid bearer token). */
export function authHeaders(deviceId = "test-device"): Record<string, string> {
  const token = computeDeviceToken(deviceId, config.relaySharedSecret);
  return {
    "X-Device-Id": deviceId,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Uploads photo bytes to the unauthenticated glasses webhook (multipart). */
export async function uploadPhoto(base: string, token: string, bytes: Buffer): Promise<Response> {
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array(bytes)]), "photo.jpg");
  return fetch(`${base}/api/photo/upload/${token}`, { method: "POST", body: form });
}
