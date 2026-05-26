import * as crypto from "node:crypto";
import { Logger } from "../utils/logger";

const logger = new Logger("PhotoCache");

/**
 * In-memory photo cache for the BLE relay's two-step capture flow:
 *   1. Mobile calls POST /api/photo/upload-url → server mints a token, caches
 *      an entry with bytes=null.
 *   2. Mobile asks the glasses to upload to /api/photo/upload/<token>;
 *      glasses POST multipart photo → server fills bytes.
 *   3. Mobile calls /api/vision/scene (or any vision/face endpoint) with
 *      { photoToken }; server pulls bytes, evicts on consumption.
 *
 * Caps: 20 concurrent in-flight photos (memory protection — ~3MB each at
 * "large" + medium compress), 60s TTL.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 20;
const SWEEP_INTERVAL_MS = 30_000;

export interface PhotoEntry {
  bytes: Buffer | null;       // null until the glasses upload
  expiresAt: number;          // epoch ms — evicted past this regardless of state
  deviceId: string;           // who minted this token (audit / future rate-limit)
  uploadedAt?: number;        // when the glasses finished uploading
}

const cache = new Map<string, PhotoEntry>();

/** Background sweep of expired entries — runs every 30s. */
let sweeperHandle: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(): void {
  if (sweeperHandle) return;
  sweeperHandle = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
  // Don't keep the process alive just for this timer.
  if (typeof sweeperHandle.unref === "function") sweeperHandle.unref();
}

function sweepExpired(): void {
  const now = Date.now();
  let removed = 0;
  for (const [token, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(token);
      removed++;
    }
  }
  if (removed > 0) logger.debug(`swept ${removed} expired entries (${cache.size} remain)`);
}

/**
 * Mints a new photo token + cache entry. Throws if the cache is at capacity
 * — caller should return 503 to mobile.
 */
export function mintToken(deviceId: string): { photoToken: string; expiresAt: number } {
  ensureSweeper();
  sweepExpired(); // opportunistic — keeps the cap accurate

  if (cache.size >= MAX_ENTRIES) {
    throw new Error("photo cache at capacity");
  }

  const photoToken = crypto.randomBytes(16).toString("hex"); // 32 hex chars
  const expiresAt = Date.now() + TTL_MS;
  cache.set(photoToken, { bytes: null, expiresAt, deviceId });
  logger.debug(`minted token ${photoToken.slice(0, 8)}... for device ${deviceId.slice(0, 8)}... (cache: ${cache.size}/${MAX_ENTRIES})`);
  return { photoToken, expiresAt };
}

/** Stores photo bytes against an existing token. Returns false if token is unknown or expired. */
export function storeBytes(photoToken: string, bytes: Buffer): boolean {
  const entry = cache.get(photoToken);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(photoToken);
    return false;
  }
  entry.bytes = bytes;
  entry.uploadedAt = Date.now();
  logger.debug(`stored ${bytes.length} bytes for ${photoToken.slice(0, 8)}...`);
  return true;
}

/**
 * Returns the bytes for a token without evicting. Returns null if the token
 * doesn't exist, is expired, or never received an upload.
 *
 * NOT one-shot — describe-scene (and any future multi-endpoint command) reads
 * the same photo from both /api/vision/scene and /api/faces/recognize-all in
 * parallel. TTL handles cleanup; the 20-entry cap protects memory.
 */
export function getBytes(photoToken: string): Buffer | null {
  const entry = cache.get(photoToken);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(photoToken);
    return null;
  }
  if (!entry.bytes) return null;
  return entry.bytes;
}

/** Manual eviction. Optional for callers — TTL will sweep eventually. */
export function evict(photoToken: string): void {
  cache.delete(photoToken);
}

/** Test / debug helper. */
export function size(): number {
  return cache.size;
}
