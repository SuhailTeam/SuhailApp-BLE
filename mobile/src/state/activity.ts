import { create } from "zustand";

export type ActivityType = "system" | "command" | "ble" | "error";

export interface ActivityEntry {
  id: string;
  time: string;          // ISO timestamp
  type: ActivityType;
  command: string;       // short label (e.g. "scene", "left-short")
  event: string;         // human-readable description (bilingual-friendly)
  result?: string;
}

const MAX = 20;

interface ActivityStore {
  entries: ActivityEntry[];
  log: (entry: Omit<ActivityEntry, "id" | "time">) => void;
  clear: () => void;
}

let counter = 0;

export const useActivity = create<ActivityStore>((set) => ({
  entries: [],
  log: (entry) =>
    set((s) => {
      counter += 1;
      const next: ActivityEntry = {
        ...entry,
        id: `${Date.now()}-${counter}`,
        time: new Date().toISOString(),
      };
      const trimmed = [...s.entries, next].slice(-MAX);
      return { entries: trimmed };
    }),
  clear: () => set({ entries: [] }),
}));
