import { MMKV } from "react-native-mmkv";
import { create } from "zustand";
import type { ThemeMode } from "../theme/types";
import { TEXT_SCALE_MIN, TEXT_SCALE_MAX } from "../theme/tokens";

/**
 * Display-only preferences (theme mode + text size). Kept in a SEPARATE MMKV
 * store from settings.ts on purpose: settings.ts holds the server-contract
 * `AppSettings` (speech/voice/language), so display prefs must not live there.
 * Mirrors settings.ts's clamp/sanitise/persist pattern.
 */

const storage = new MMKV({ id: "suhail-appearance" });
const STORAGE_KEY = "appearance.v1";

export const TEXT_SCALE_STEP = 0.15;

export interface AppearanceState {
  themeMode: ThemeMode;
  textScale: number; // 0.85 – 1.5
}

const DEFAULTS: AppearanceState = { themeMode: "dark", textScale: 1.0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Validates + sanitises a partial update. Drops unknown keys. */
function sanitise(partial: Partial<AppearanceState>, base: AppearanceState): AppearanceState {
  return {
    themeMode:
      partial.themeMode === "dark" || partial.themeMode === "highContrast"
        ? partial.themeMode
        : base.themeMode,
    textScale:
      typeof partial.textScale === "number" && Number.isFinite(partial.textScale)
        ? clamp(partial.textScale, TEXT_SCALE_MIN, TEXT_SCALE_MAX)
        : base.textScale,
  };
}

function loadInitial(): AppearanceState {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    return sanitise(JSON.parse(raw) as Partial<AppearanceState>, DEFAULTS);
  } catch {
    return DEFAULTS;
  }
}

function persist(value: AppearanceState): void {
  storage.set(STORAGE_KEY, JSON.stringify(value));
}

interface AppearanceStore extends AppearanceState {
  update: (partial: Partial<AppearanceState>) => void;
  reset: () => void;
}

export const useAppearance = create<AppearanceStore>((set, get) => ({
  ...loadInitial(),
  update: (partial) => {
    const next = sanitise(partial, get());
    persist(next);
    set(next);
  },
  reset: () => {
    persist(DEFAULTS);
    set(DEFAULTS);
  },
}));

/** Imperative getter for non-React contexts. */
export function getAppearance(): AppearanceState {
  const s = useAppearance.getState();
  return { themeMode: s.themeMode, textScale: s.textScale };
}
