/**
 * Spins up the relay's Express app in-process on an ephemeral port for Tier 2
 * integration tests (no glasses, no phone). Tests make real HTTP requests with
 * real HMAC headers against the REAL middleware/route handlers.
 */
import { config } from "../../src/utils/config";
import { computeDeviceToken } from "../../src/relay/auth";

export interface RunningApp {
  url: string;
  close: () => Promise<void>;
}

/** Set / clear the relay shared secret the auth middleware reads. */
export function setSharedSecret(secret: string): void {
  (config as { relaySharedSecret: string }).relaySharedSecret = secret;
}

const realSecret = config.relaySharedSecret;
export function restoreSharedSecret(): void {
  (config as { relaySharedSecret: string }).relaySharedSecret = realSecret;
}

/** Auth headers a well-behaved mobile client would send for `deviceId`. */
export function authHeaders(deviceId: string, secret: string): Record<string, string> {
  return {
    "X-Device-Id": deviceId,
    Authorization: `Bearer ${computeDeviceToken(deviceId, secret)}`,
  };
}

/**
 * Starts an Express app. `mount(app)` registers routes/middleware on it.
 * Listens on port 0 (OS-assigned) and resolves with the base URL + a closer.
 */
export async function startApp(mount: (app: any) => void): Promise<RunningApp> {
  const express = require("express");
  const app = express();
  mount(app);
  return await new Promise<RunningApp>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
