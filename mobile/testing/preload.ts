/**
 * Bun test preload for the mobile package.
 *
 * The mobile app is React Native / Expo. Its pure-logic modules (listening
 * state machine, enrollment state, transcription filter, command result
 * shaping) are what we unit-test — but they transitively import native
 * packages (MMKV, the Bluetooth SDK, expo-audio) that have no JS
 * implementation outside a device. We stub those packages here so the units
 * under test load in plain Bun with no native runtime, no network, no keys.
 *
 * This is the "stub external services at the Adapter boundary" rule from the
 * GP2 test plan (Section 11 / instructions §1): the BLE SDK, audio I/O and
 * device storage are adapters; we replace them with inert doubles so the
 * logic above them runs deterministically and offline.
 *
 * Individual test files additionally `mock.module(...)` the specific
 * collaborator modules they want to observe (e.g. audio/cues, relay/intent)
 * via testing/helpers/listening-harness.ts — those are app modules, not
 * packages, and are mocked per-file so assertions stay local.
 *
 * Wired by mobile/bunfig.toml ([test].preload).
 */
import { mock } from "bun:test";

// react-native-mmkv — synchronous device KV store (settings, deviceId).
// Back it with an in-memory Map so settings round-trip in tests if needed.
mock.module("react-native-mmkv", () => {
  class MMKV {
    private store = new Map<string, string>();
    getString(key: string): string | undefined {
      return this.store.get(key);
    }
    set(key: string, value: string): void {
      this.store.set(key, value);
    }
    delete(key: string): void {
      this.store.delete(key);
    }
    clearAll(): void {
      this.store.clear();
    }
    contains(key: string): boolean {
      return this.store.has(key);
    }
  }
  return { MMKV };
});

// @mentra/bluetooth-sdk — the BLE adapter (mic PCM, camera, events). Inert:
// listeners never fire, requestPhoto / setMicState resolve immediately. Tests
// that need to drive these behaviours mock ble/mic.ts and ble/camera.ts
// directly (a layer above this) so they control the orchestration, not the SDK.
mock.module("@mentra/bluetooth-sdk", () => ({
  default: {
    addListener: () => ({ remove() {} }),
    requestPhoto: async () => {},
    setMicState: async () => {},
    setOwnAppAudioPlaying: () => {},
    stopAudio: async () => {},
  },
}));

// expo-audio — TTS / cue playback. Inert player.
mock.module("expo-audio", () => ({
  createAudioPlayer: () => ({
    play() {},
    pause() {},
    remove() {},
    replace() {},
    addListener: () => ({ remove() {} }),
    seekTo: async () => {},
    volume: 1,
  }),
  setAudioModeAsync: async () => {},
  AudioModule: { setAudioModeAsync: async () => {} },
}));

// expo-file-system — used by the audio path to stage TTS bytes to a temp file.
mock.module("expo-file-system", () => ({
  cacheDirectory: "/tmp/",
  documentDirectory: "/tmp/",
  writeAsStringAsync: async () => {},
  deleteAsync: async () => {},
  readAsStringAsync: async () => "",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
}));

// __DEV__ is a React Native global referenced by some modules (e.g. deviceId).
(globalThis as unknown as { __DEV__?: boolean }).__DEV__ = true;
