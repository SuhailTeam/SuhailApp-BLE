import { postJson } from "./client";

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
