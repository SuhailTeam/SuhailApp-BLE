import { useMemo } from "react";
import { MMKV } from "react-native-mmkv";
import {
  useMentraBluetooth,
  type MentraBluetoothSession,
} from "@mentra/bluetooth-sdk/react";
import { DeviceModels, type Device } from "@mentra/bluetooth-sdk";
import { Logger } from "../utils/logger";

const logger = new Logger("BLE.Connection");

const storage = new MMKV({ id: "suhail-ble" });
const DEFAULT_DEVICE_KEY = "defaultDevice.v1";

/** MMKV-backed storage for the SDK's auto-reconnect default device. */
const mmkvDefaultDeviceStorage = {
  async load(): Promise<Device | null> {
    const raw = storage.getString(DEFAULT_DEVICE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Device;
    } catch {
      return null;
    }
  },
  async save(device: Device | null): Promise<void> {
    if (device) {
      storage.set(DEFAULT_DEVICE_KEY, JSON.stringify(device));
    } else {
      storage.delete(DEFAULT_DEVICE_KEY);
    }
  },
};

/**
 * High-level glasses connection hook with Suhail defaults (Mentra Live,
 * MMKV-backed default-device persistence, auto-reconnect, 15s scan).
 * Use in screens that need to scan / connect / show status.
 */
export function useSuhailBluetooth(): MentraBluetoothSession {
  const options = useMemo(
    () => ({
      autoConnectDefault: true,
      defaultDeviceStorage: mmkvDefaultDeviceStorage,
      defaultModel: DeviceModels.MentraLive,
      scanTimeoutMs: 15_000,
      onError: (err: unknown) => logger.error("BLE session error:", err),
    }),
    [],
  );
  return useMentraBluetooth(options);
}

/* ── Imperative connection state (for non-React modules) ──────────────────── */

/**
 * The `@mentra/bluetooth-sdk` public `addListener` / `useBluetoothEvent` event
 * map does NOT include `glasses_status`, so connection state can only be
 * observed through the React `useMentraBluetooth` session. This tiny store lets
 * the non-React modules — the camera capture flow and the listening state
 * machine — read connectivity and react to drops without re-rendering. The
 * React layer (HomeScreen) mirrors `session.glasses.connected` into it on every
 * change via {@link setGlassesConnected}.
 */
let glassesConnected = false;
const disconnectListeners = new Set<() => void>();

/** Last connection state pushed from the React session. Best-effort: lets the
 *  camera flow fail fast instead of hanging on a dead BLE link. */
export function isGlassesConnected(): boolean {
  return glassesConnected;
}

/**
 * Subscribe to glasses disconnects (connected → disconnected transitions).
 * Returns an unsubscribe fn. Fired synchronously by {@link setGlassesConnected}.
 */
export function onGlassesDisconnected(cb: () => void): () => void {
  disconnectListeners.add(cb);
  return () => {
    disconnectListeners.delete(cb);
  };
}

/**
 * Push the latest connection state from the React session. Call from a
 * `useEffect` keyed on `session.glasses.connected`. Fires the disconnect
 * listeners on a true → false transition; idempotent otherwise.
 */
export function setGlassesConnected(next: boolean): void {
  const was = glassesConnected;
  glassesConnected = next;
  if (was && !next) {
    logger.warn("glasses disconnected — notifying listeners");
    for (const cb of [...disconnectListeners]) {
      try {
        cb();
      } catch (err) {
        logger.error("disconnect listener threw:", err);
      }
    }
  }
}
