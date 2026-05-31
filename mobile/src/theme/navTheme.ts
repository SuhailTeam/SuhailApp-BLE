import { DarkTheme, type Theme as NavigationTheme } from "@react-navigation/native";
import type { Theme } from "./types";

/**
 * Maps our theme onto React Navigation's theme so the header + tab bar + screen
 * backgrounds are driven from tokens. React Navigation v7's Theme type REQUIRES
 * a `fonts` block, so spread `DarkTheme` (which supplies it + dark:true) and
 * override only `colors`.
 */
export function toNavigationTheme(t: Theme): NavigationTheme {
  return {
    ...DarkTheme,
    dark: true,
    colors: {
      ...DarkTheme.colors,
      primary: t.colors.accent,
      background: t.colors.bg,
      card: t.colors.surface,
      text: t.colors.textPrimary,
      border: t.colors.border,
      notification: t.colors.danger,
    },
  };
}
