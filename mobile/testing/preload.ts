/**
 * Bun test preload (mobile). Stubs the native modules that don't load outside a
 * device/Metro runtime, so the REAL app modules (state, commands, utils) can be
 * imported and exercised under bun:test. No device, no network.
 */
import { mock } from "bun:test";

// Deterministic env (relay client + settings read these at module load).
process.env.EXPO_PUBLIC_RELAY_BASE_URL = "https://relay.test";
process.env.EXPO_PUBLIC_RELAY_SHARED_SECRET = "test-shared-secret";
process.env.EXPO_PUBLIC_LOG_LEVEL = "error";

// MMKV → in-memory map.
class MMKVStub {
  private store = new Map<string, string>();
  getString(k: string): string | undefined {
    return this.store.get(k);
  }
  set(k: string, v: unknown): void {
    this.store.set(k, String(v));
  }
  getBoolean(k: string): boolean | undefined {
    const v = this.store.get(k);
    return v === undefined ? undefined : v === "true";
  }
  getNumber(k: string): number | undefined {
    const v = this.store.get(k);
    return v === undefined ? undefined : Number(v);
  }
  delete(k: string): void {
    this.store.delete(k);
  }
  contains(k: string): boolean {
    return this.store.has(k);
  }
  clearAll(): void {
    this.store.clear();
  }
}
mock.module("react-native-mmkv", () => ({ MMKV: MMKVStub }));

// react-native's index.js uses Flow syntax bun can't parse. Stub the handful of
// APIs the non-UI modules touch.
mock.module("react-native", () => ({
  Platform: { OS: "ios", select: (o: any) => o?.ios ?? o?.default },
  NativeModules: {},
  I18nManager: { isRTL: false, allowRTL() {}, forceRTL() {} },
  AppState: { addEventListener: () => ({ remove() {} }), currentState: "active" },
  Alert: { alert() {} },
  Share: { share: async () => ({}) },
}));

// BLE SDK → any method returns a resolved promise / no-op.
mock.module("@mentra/bluetooth-sdk", () => ({
  default: new Proxy(
    {},
    { get: () => async () => undefined },
  ),
}));

// App-level BLE wrappers import the native SDK + expo modules transitively.
// Stub them here so modules under test (e.g. commands/read.ts) load offline.
// The listening-machine suite re-mocks these with controllable behaviour
// (testing/helpers/listening-harness.ts), which takes precedence.
mock.module("../src/ble/camera", () => ({
  GLASSES_DISCONNECTED_ERROR: "glasses-disconnected",
  capturePhoto: async () => ({ photoToken: "stub-token" }),
  resolvePhoto: async () => ({ photoToken: "stub-token" }),
}));
mock.module("../src/ble/mic", () => ({
  startCapture: async () => null,
  cancelCapture: async () => {},
}));
mock.module("../src/ble/connection", () => ({
  onGlassesDisconnected: () => {},
  setGlassesConnected: () => {},
  isGlassesConnected: () => false,
}));

// More RN/Expo leaves that ship Flow/TS-typed source bun can't parse.
mock.module("@react-native/assets-registry/registry", () => ({
  registerAsset: () => 1,
  getAssetByID: () => undefined,
}));
mock.module("expo-asset", () => ({
  Asset: { fromModule: () => ({ downloadAsync: async () => ({ localUri: "" }), uri: "" }) },
}));

// expo-audio → inert player.
mock.module("expo-audio", () => ({
  createAudioPlayer: () => ({
    play() {},
    pause() {},
    remove() {},
    addListener() {
      return { remove() {} };
    },
    volume: 1,
  }),
  setAudioModeAsync: async () => {},
}));

// expo/fetch (streaming fetch) → stub. Unit tests import relay/answer for the
// pure NDJSON decoder; the streaming fetch itself is exercised on-device only.
mock.module("expo/fetch", () => ({
  fetch: async () => {
    throw new Error("expo/fetch is stubbed in tests");
  },
}));

// expo-file-system → no-op fs.
mock.module("expo-file-system", () => ({
  cacheDirectory: "/tmp/",
  documentDirectory: "/tmp/",
  writeAsStringAsync: async () => {},
  readAsStringAsync: async () => "",
  deleteAsync: async () => {},
  getInfoAsync: async () => ({ exists: false }),
  EncodingType: { Base64: "base64", UTF8: "utf8" },
}));
