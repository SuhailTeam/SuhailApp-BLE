import type { ThemeColors, ThemeMode } from "./types";

/**
 * WCAG-checked palettes. Contrast ratios (sRGB relative-luminance formula) are
 * noted for the load-bearing pairs. AA text = 4.5:1, AA large/UI = 3:1,
 * AAA text = 7:1.
 *
 * Key fixes vs the old hardcoded colours:
 *  - muted text was #475569/#64748B (failed AA on cards) -> #94A3B8 (~6:1 AA+).
 *  - primary button was #0284C7 + white (~4.2:1 FAIL) -> #0369A1 + #F8FAFC
 *    (~5.9:1 AA) — keeps the blue-button identity rather than inverting.
 *  - interactive borders use borderStrong (#64748B, ~3.3:1 on surface) so they
 *    clear the 3:1 non-text-contrast rule.
 */

// ── Dark (default) ──────────────────────────────────────────────────────────
export const darkColors: ThemeColors = {
  bg: "#020617", // slate-950
  surface: "#0F172A", // slate-900
  surfaceAlt: "#1E293B", // slate-800
  border: "#334155", // hairline separators (decorative)
  borderStrong: "#64748B", // interactive borders — ~3.3:1 on surface

  textPrimary: "#F8FAFC", // ~15.3:1 on surface (AAA)
  textSecondary: "#CBD5E1", // ~10.9:1 on surface (AAA)
  textMuted: "#94A3B8", // ~6.1:1 on surface (AA+)

  accent: "#38BDF8", // sky-400 — non-text/active (~8.6:1 on bg)
  accentText: "#E0F2FE",
  accentFill: "#0369A1", // sky-700 button fill
  onAccentFill: "#F8FAFC", // ~5.9:1 on accentFill (AA)

  success: "#16A34A",
  successText: "#4ADE80", // ~7.4:1 on surface (AAA)
  warning: "#D97706",
  warningText: "#FBBF24", // ~9.6:1 on surface (AAA)
  danger: "#DC2626",
  dangerText: "#F87171", // ~6.0:1 on surface (AA)

  dangerFill: "#B91C1C",
  onDangerFill: "#F8FAFC", // ~6.5:1 (AA)
  warnFill: "#A16207",
  onWarnFill: "#F8FAFC", // ~5.4:1 (AA)

  focusRing: "#7DD3FC", // sky-300 — ring clears 3:1 easily
  overlay: "rgba(2,6,23,0.72)",

  okCardBg: "#052E16",
  okCardBorder: "#16A34A",
  warnCardBg: "#1C1917",
  warnCardBorder: "#A16207",
};

// ── High contrast (target ~7:1+ everywhere, 2px borders) ──────────────────────
export const highContrastColors: ThemeColors = {
  bg: "#000000",
  surface: "#0A0A0A", // separation comes from borders, not fills
  surfaceAlt: "#1A1A1A",
  border: "#A3A3A3", // always-visible separators
  borderStrong: "#FFFFFF", // 2px interactive borders — 21:1 on bg

  textPrimary: "#FFFFFF", // 21:1 on bg
  textSecondary: "#F1F5F9", // ~18:1 on bg
  textMuted: "#E2E8F0", // ~16:1 — "muted" via size/weight, never low contrast

  accent: "#7DD3FC", // ~13:1 on black
  accentText: "#FFFFFF",
  accentFill: "#0B3B5C", // dark fill + white text ~11.6:1
  onAccentFill: "#FFFFFF",

  success: "#22C55E",
  successText: "#86EFAC", // ~13:1 on black
  warning: "#FBBF24",
  warningText: "#FDE047", // ~16:1 on black
  danger: "#F87171",
  dangerText: "#FCA5A5", // ~9:1 on black

  dangerFill: "#7F1D1D",
  onDangerFill: "#FFFFFF", // ~12:1
  warnFill: "#7C4A03",
  onWarnFill: "#FFFFFF",

  focusRing: "#FFFFFF",
  overlay: "rgba(0,0,0,0.88)",

  okCardBg: "#00140A",
  okCardBorder: "#22C55E",
  warnCardBg: "#1A1206",
  warnCardBorder: "#FBBF24",
};

/** Finite-key lookup (not an index signature — safe under noUncheckedIndexedAccess). */
export const palettes: Record<ThemeMode, ThemeColors> = {
  dark: darkColors,
  highContrast: highContrastColors,
};
