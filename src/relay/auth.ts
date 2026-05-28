import * as crypto from "node:crypto";
import { config } from "../utils/config";
import { Logger } from "../utils/logger";

const logger = new Logger("RelayAuth");

/**
 * Computes the bearer token for a given device id.
 * Token = hex(HMAC-SHA256(deviceId, RELAY_SHARED_SECRET)).
 * Both the mobile app and this server compute the same value independently.
 */
export function computeDeviceToken(deviceId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(deviceId).digest("hex");
}

/**
 * Express middleware that authenticates BLE-mobile relay requests.
 *
 * Required headers:
 *   - X-Device-Id: the device's UUID (stable per install)
 *   - Authorization: "Bearer <token>" where token = HMAC-SHA256(deviceId, secret)
 *
 * When RELAY_SHARED_SECRET is empty (dev mode), authentication is skipped and
 * requests are allowed through with a warning logged once at startup.
 */
export function relayAuth(req: any, res: any, next: any): void {
  const secret = config.relaySharedSecret;

  // Dev mode — no secret configured, allow all
  if (!secret) {
    next();
    return;
  }

  const deviceId = req.header("X-Device-Id");
  if (!deviceId || typeof deviceId !== "string" || deviceId.length === 0 || deviceId.length > 128) {
    res.status(401).json({ error: "Missing or invalid X-Device-Id header" });
    return;
  }

  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const provided = authHeader.slice("Bearer ".length).trim();
  const expected = computeDeviceToken(deviceId, secret);

  // Constant-time comparison — guards against timing-side-channel
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    logger.warn(`Auth failed for device "${deviceId.slice(0, 8)}..."`);
    res.status(401).json({ error: "Invalid bearer token" });
    return;
  }

  // Stash deviceId on the request so handlers can rate-limit / log per device
  (req as any).deviceId = deviceId;
  next();
}

/** Logs a one-time startup warning when running in dev (no secret). */
export function warnIfDevAuth(): void {
  if (!config.relaySharedSecret) {
    logger.warn("RELAY_SHARED_SECRET is empty — relay endpoints are OPEN (dev mode). Set RELAY_SHARED_SECRET before deploying.");
  }
}
