import type { TextStyle } from "react-native";
import { spacing, radii, hitSlop, MIN_TOUCH, baseType, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from "./tokens";
import { palettes } from "./palettes";
import type { Theme, ThemeMode, TypeRole, TypeStyle } from "./types";

function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, s));
}

function getArabicFontFamily(fontWeight: TextStyle["fontWeight"]): string {
  switch (fontWeight) {
    case "700":
    case "800":
    case "bold":
      return "Cairo_700Bold";
    case "600":
      return "Cairo_600SemiBold";
    case "500":
      return "Cairo_500Medium";
    case "400":
    case "normal":
    default:
      return "Cairo_400Regular";
  }
}

function scaleType(scale: number, language?: string): Record<TypeRole, TypeStyle> {
  const roles = Object.keys(baseType) as TypeRole[];
  const out = {} as Record<TypeRole, TypeStyle>;
  for (const role of roles) {
    const t = baseType[role];
    out[role] = {
      fontSize: Math.round(t.fontSize * scale),
      lineHeight: Math.round(t.lineHeight * scale),
      fontWeight: t.fontWeight,
    };
    if (language === "ar") {
      out[role].fontFamily = getArabicFontFamily(t.fontWeight);
    }
  }
  return out;
}

export function buildTheme(mode: ThemeMode, textScale: number, language?: string): Theme {
  const scale = clampScale(textScale);
  const isHighContrast = mode === "highContrast";
  return {
    mode,
    isHighContrast,
    colors: palettes[mode],
    spacing,
    radii,
    type: scaleType(scale, language),
    hitSlop,
    minTouch: MIN_TOUCH,
    borderWidth: isHighContrast ? 2 : 1,
  };
}
