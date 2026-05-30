import { spacing, radii, hitSlop, MIN_TOUCH, baseType, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from "./tokens";
import { palettes } from "./palettes";
import type { Theme, ThemeMode, TypeRole, TypeStyle } from "./types";

function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, s));
}

/**
 * Folds the user textScale into the base type sizes. The OS Dynamic Type factor
 * is NOT applied here — RN's <Text allowFontScaling> re-scales by the OS factor
 * at render, so multiplying here too would double-apply it.
 */
function scaleType(scale: number): Record<TypeRole, TypeStyle> {
  const roles = Object.keys(baseType) as TypeRole[];
  const out = {} as Record<TypeRole, TypeStyle>;
  for (const role of roles) {
    const t = baseType[role];
    out[role] = {
      fontSize: Math.round(t.fontSize * scale),
      lineHeight: Math.round(t.lineHeight * scale),
      fontWeight: t.fontWeight,
    };
  }
  return out;
}

/**
 * Builds the immutable theme object for a mode + textScale. Call this once in
 * ThemeProvider behind a useMemo keyed on [mode, textScale] so the returned
 * identity is stable and every component's makeStyles only recomputes on a real
 * theme change.
 */
export function buildTheme(mode: ThemeMode, textScale: number): Theme {
  const scale = clampScale(textScale);
  const isHighContrast = mode === "highContrast";
  return {
    mode,
    isHighContrast,
    colors: palettes[mode],
    spacing,
    radii,
    type: scaleType(scale),
    hitSlop,
    minTouch: MIN_TOUCH,
    borderWidth: isHighContrast ? 2 : 1,
  };
}
