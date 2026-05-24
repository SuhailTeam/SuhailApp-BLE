import { MMKV } from "react-native-mmkv";
import { create } from "zustand";
import type { Language } from "../i18n/messages";

const storage = new MMKV({ id: "suhail-settings" });

const STORAGE_KEY = "settings.v1";

export type VoicePreset = "default" | "male" | "female";

export interface AppSettings {
  speechSpeed: number;   // 0.5 – 2.0
  volume: number;        // 0.0 – 1.0
  voicePreset: VoicePreset;
  language: Language;
}

const DEFAULTS: AppSettings = {
  speechSpeed: 1.0,
  volume: 1.0,
  voicePreset: "default",
  language: "ar",
};

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Validates + sanitises a partial settings update. Drops unknown keys. */
function sanitise(partial: Partial<AppSettings>, base: AppSettings): AppSettings {
  return {
    speechSpeed:
      typeof partial.speechSpeed === "number" && Number.isFinite(partial.speechSpeed)
        ? clamp(partial.speechSpeed, 0.5, 2.0)
        : base.speechSpeed,
    volume:
      typeof partial.volume === "number" && Number.isFinite(partial.volume)
        ? clamp(partial.volume, 0, 1)
        : base.volume,
    voicePreset:
      partial.voicePreset === "male" || partial.voicePreset === "female" || partial.voicePreset === "default"
        ? partial.voicePreset
        : base.voicePreset,
    language:
      partial.language === "ar" || partial.language === "en" ? partial.language : base.language,
  };
}

function loadInitial(): AppSettings {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return sanitise(parsed, DEFAULTS);
  } catch {
    return DEFAULTS;
  }
}

function persist(value: AppSettings): void {
  storage.set(STORAGE_KEY, JSON.stringify(value));
}

interface SettingsStore extends AppSettings {
  update: (partial: Partial<AppSettings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
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

/** Imperative getter for non-React contexts (BLE/relay layers). */
export function getSettings(): AppSettings {
  const s = useSettings.getState();
  return {
    speechSpeed: s.speechSpeed,
    volume: s.volume,
    voicePreset: s.voicePreset,
    language: s.language,
  };
}
