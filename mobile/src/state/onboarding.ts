import { MMKV } from "react-native-mmkv";
import { create } from "zustand";

/**
 * First-launch onboarding gate. A single boolean in its own MMKV store. Read
 * synchronously at boot (MMKV is synchronous) so the root navigator can pick
 * the first screen with no async flash.
 */

const storage = new MMKV({ id: "suhail-onboarding" });
const KEY = "hasOnboarded.v1";

/** Synchronous read for boot-time gating. */
export function getHasOnboarded(): boolean {
  return storage.getBoolean(KEY) ?? false;
}

function persist(value: boolean): void {
  storage.set(KEY, value);
}

interface OnboardingStore {
  hasOnboarded: boolean;
  /** Mark onboarding finished (also persists). */
  complete: () => void;
  /** Re-show onboarding (used by a "replay onboarding" debug/settings action). */
  reset: () => void;
}

export const useOnboarding = create<OnboardingStore>((set) => ({
  hasOnboarded: getHasOnboarded(),
  complete: () => {
    persist(true);
    set({ hasOnboarded: true });
  },
  reset: () => {
    persist(false);
    set({ hasOnboarded: false });
  },
}));
