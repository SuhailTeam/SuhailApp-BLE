import type { ThemeColors } from "./types";

export const lightColors: ThemeColors = {
  bg: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceAlt: "#EBEBEB",
  border: "#000000",
  borderStrong: "#000000",

  textPrimary: "#000000",
  textSecondary: "#666666",
  textMuted: "#666666",

  accent: "#000000",
  accentText: "#FFFFFF",
  accentFill: "#000000",
  onAccentFill: "#FFFFFF",

  success: "#000000",
  successText: "#000000",
  warning: "#666666",
  warningText: "#666666",
  danger: "#DC2626",
  dangerText: "#FFFFFF",

  dangerFill: "#DC2626",
  onDangerFill: "#FFFFFF",
  warnFill: "#666666",
  onWarnFill: "#FFFFFF",

  focusRing: "#666666",
  overlay: "rgba(0,0,0,0.4)",

  okCardBg: "#FFFFFF",
  okCardBorder: "#000000",
  warnCardBg: "#FFFFFF",
  warnCardBorder: "#DC2626",
};

export const darkColors: ThemeColors = {
  bg: "#0A0D0B",
  surface: "#1A1D1B",
  surfaceAlt: "#242826",
  border: "#2D3230",
  borderStrong: "#B0C9A1",

  textPrimary: "#E2EFE0",
  textSecondary: "#A2B0A6",
  textMuted: "#6D7A71",

  accent: "#B0C9A1",
  accentText: "#0A0D0B",
  accentFill: "#B0C9A1",
  onAccentFill: "#0A0D0B",

  success: "#ACDBB8",
  successText: "#ACDBB8",
  warning: "#D3F4D1",
  warningText: "#D3F4D1",
  danger: "#FCA397",
  dangerText: "#0A0D0B",

  dangerFill: "#FCA397",
  onDangerFill: "#0A0D0B",
  warnFill: "#D3F4D1",
  onWarnFill: "#0A0D0B",

  focusRing: "#B0C9A1",
  overlay: "rgba(10,13,11,0.72)",

  okCardBg: "#1A1D1B",
  okCardBorder: "#ACDBB8",
  warnCardBg: "#1A1D1B",
  warnCardBorder: "#FCA397",
};

// ── High contrast (target ~7:1+ everywhere, 2px borders) ──────────────────────
export const highContrastColors: ThemeColors = {
  bg: "#000000",
  surface: "#000000",
  surfaceAlt: "#000000",
  border: "#FFFFFF",
  borderStrong: "#FFFFFF",

  textPrimary: "#FFFFFF",
  textSecondary: "#FFFFFF",
  textMuted: "#FFFFFF",

  accent: "#FFFFFF",
  accentText: "#000000",
  accentFill: "#FFFFFF",
  onAccentFill: "#000000",

  success: "#FFFFFF",
  successText: "#FFFFFF",
  warning: "#FFFFFF",
  warningText: "#FFFFFF",
  danger: "#FFFFFF",
  dangerText: "#FFFFFF",

  dangerFill: "#FFFFFF",
  onDangerFill: "#000000",
  warnFill: "#FFFFFF",
  onWarnFill: "#000000",

  focusRing: "#FFFFFF",
  overlay: "rgba(0,0,0,0.88)",

  okCardBg: "#000000",
  okCardBorder: "#FFFFFF",
  warnCardBg: "#000000",
  warnCardBorder: "#FFFFFF",
};

/** Palettes lookup for each theme mode. */
export const palettes = {
  light: lightColors,
  dark: darkColors,
  highContrast: highContrastColors,
};
