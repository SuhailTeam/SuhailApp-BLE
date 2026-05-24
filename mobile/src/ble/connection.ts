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
