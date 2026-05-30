import type { Theme } from "./types";

export { ThemeProvider, useTheme } from "./ThemeProvider";
export { buildTheme } from "./buildTheme";
export { toNavigationTheme } from "./navTheme";
export { palettes, darkColors, highContrastColors } from "./palettes";
export { spacing, radii, hitSlop, MIN_TOUCH, baseType, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from "./tokens";
export type { Theme, ThemeColors, ThemeMode, TypeRole, TypeStyle } from "./types";

/**
 * Inference helper so components can write:
 *   const createStyles = makeStyles((t) => StyleSheet.create({ ... }));
 *   const styles = useMemo(() => createStyles(theme), [theme]);
 * It only fixes the `t` parameter type — the return type is inferred from the factory.
 */
export function makeStyles<T>(factory: (t: Theme) => T): (t: Theme) => T {
  return factory;
}
