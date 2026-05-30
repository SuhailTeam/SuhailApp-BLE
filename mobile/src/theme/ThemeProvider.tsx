import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAppearance } from "../state/appearance";
import { buildTheme } from "./buildTheme";
import type { Theme } from "./types";

const ThemeContext = createContext<Theme | null>(null);

/**
 * Provides the active theme to the tree. Reads themeMode + textScale from the
 * appearance store and memoises the built theme on those two values, so the
 * theme object identity only changes on a real toggle — keeping every
 * component's `useMemo(() => createStyles(theme), [theme])` cheap.
 */
export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const themeMode = useAppearance((s) => s.themeMode);
  const textScale = useAppearance((s) => s.textScale);
  const theme = useMemo(() => buildTheme(themeMode, textScale), [themeMode, textScale]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
