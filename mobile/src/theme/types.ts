import type { TextStyle } from "react-native";

/**
 * Theme types for the Suhail mobile app. Two modes ship today — a refined dark
 * palette and a high-contrast palette. The union is intentionally open-ended so
 * a future "light" mode is one palette + one union member away (no consumer
 * changes). See palettes.ts for the WCAG-checked hex values.
 */
export type ThemeMode = "dark" | "highContrast";

export type TypeRole = "display" | "title" | "body" | "label" | "caption";

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle["fontWeight"];
}

/**
 * Semantic colour tokens. Every coloured fill has a paired foreground (`*Text`
 * / `on*`) chosen to clear WCAG AA against it, so no screen ever has to guess a
 * text colour for a coloured background.
 */
export interface ThemeColors {
  /** App background. */
  bg: string;
  /** Card / raised surface. */
  surface: string;
  /** Nested rows / chips on a surface. */
  surfaceAlt: string;
  /** Hairline separators (decorative — exempt from the 3:1 rule). */
  border: string;
  /** Interactive / input borders — clears 3:1 non-text contrast. */
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  /** Muted text that still clears AA at body size (not a faint grey). */
  textMuted: string;

  /** Accent for icons / active states / non-text marks. */
  accent: string;
  /** Text / icon when placed ON an accent fill. */
  accentText: string;
  /** Primary button fill. */
  accentFill: string;
  /** Text on `accentFill`. */
  onAccentFill: string;

  success: string;
  successText: string;
  warning: string;
  warningText: string;
  danger: string;
  dangerText: string;

  /** Destructive button fill + its foreground. */
  dangerFill: string;
  onDangerFill: string;
  /** Warning button fill + its foreground. */
  warnFill: string;
  onWarnFill: string;

  /** Focus / selected ring (>=3:1 against surfaces). */
  focusRing: string;
  /** Modal backdrop. */
  overlay: string;

  /** Connection "ok" status card tint. */
  okCardBg: string;
  okCardBorder: string;
  /** Connection "warn"/disconnected status card tint. */
  warnCardBg: string;
  warnCardBorder: string;
}

export interface Theme {
  mode: ThemeMode;
  isHighContrast: boolean;
  colors: ThemeColors;
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  radii: { sm: number; md: number; lg: number; pill: number };
  /** Typography scale with the user textScale already folded in. */
  type: Record<TypeRole, TypeStyle>;
  /** Default hitSlop for small visual targets to reach the 44px touch area. */
  hitSlop: { top: number; bottom: number; left: number; right: number };
  /** Minimum touch-target size (px) — WCAG 2.5.5 / Apple HIG. */
  minTouch: number;
  /** Border width: 1 in dark, 2 in high-contrast. */
  borderWidth: number;
}
