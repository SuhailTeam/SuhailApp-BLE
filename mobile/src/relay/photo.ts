import { getJson, postJson } from "./client";

export interface PhotoUploadUrl {
  photoToken: string;
  uploadUrl: string;
  /** Epoch ms when this token expires server-side (60s TTL by default). */
  expiresAt: number;
}

/**
 * Mints a one-shot upload URL the mobile app passes to
 * `BluetoothSdk.requestPhoto(..., webhookUrl)`. The glasses POST the photo
 * to that URL, server caches the bytes keyed by `photoToken`, and the mobile
 * then uses `photoToken` on any subsequent /api/vision/* or /api/faces/*
 * call (those endpoints accept `{ photoToken }` instead of `{ image }`).
 *
 * 60s server-side TTL; mobile should consume the token soon after upload.
 * 503 if too many photos are in flight server-side.
 */
export function mintPhotoUploadUrl(signal?: AbortSignal): Promise<PhotoUploadUrl> {
  return postJson<PhotoUploadUrl>("/api/photo/upload-url", {}, { signal, timeoutMs: 5_000 });
}

/**
 * Long-poll for photo upload completion. Resolves when the glasses have
 * finished POSTing to the upload URL (server fires storeBytes). Rejects on
 * timeout (408) or unknown token (404).
 *
 * Replaces the broken `photo_response` success event from
 * @mentra/bluetooth-sdk@0.1.6 — the iOS bridge never emits success, only
 * error. Mentra's own example uses server-side polling for completion.
 */
export function waitForPhotoUpload(token: string, signal?: AbortSignal): Promise<{ ok: true; bytes: number }> {
  // 25s — slightly higher than the server's 20s long-poll so the server, not
  // the client, controls the deadline.
  return getJson<{ ok: true; bytes: number }>(`/api/photo/wait/${token}`, { signal, timeoutMs: 25_000 });
}
