import { MMKV } from "react-native-mmkv";

const storage = new MMKV({ id: "suhail-device" });
const KEY = "deviceId.v1";

/**
 * Returns a stable per-install device id. Generated once on first call and
 * persisted to MMKV. Used as the HMAC subject for relay auth.
 *
 * Format: "dev-<env hint>-<8 random hex>" so it's recognisable in logs but
 * still unique. For the server side it's just an opaque string.
 */
export function getDeviceId(): string {
  // Optional override for development — set EXPO_PUBLIC_DEV_DEVICE_ID in .env
  // to use a fixed device id across builds.
  const override = process.env.EXPO_PUBLIC_DEV_DEVICE_ID;
  if (override && override.length > 0) return override;

  const existing = storage.getString(KEY);
  if (existing) return existing;

  const rand = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  const envHint = __DEV__ ? "dev" : "prod";
  const generated = `device-${envHint}-${rand}`;
  storage.set(KEY, generated);
  return generated;
}
