import type { TypeRole, TypeStyle } from "./types";

/**
 * Mode-independent design tokens: spacing rhythm, corner radii, touch helpers,
 * and the base typography scale (authored at textScale = 1.0; buildTheme folds
 * the user's textScale in). Colours live in palettes.ts.
 */

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** WCAG 2.5.5 / Apple HIG minimum tappable size. */
export const MIN_TOUCH = 44;

export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.5;

/**
 * Base type scale. Generous defaults for a vision-assistive app: 16px body,
 * 15px labels/buttons (still needs AA 4.5:1 — not "large text"), 13px captions.
 * All scale up with the in-app textScale AND the OS Dynamic Type setting.
 */
export const baseType: Record<TypeRole, TypeStyle> = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
};
