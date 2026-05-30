import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";
import type { Theme } from "../theme";

export type AppButtonVariant = "primary" | "secondary" | "warn" | "danger" | "ghost";

interface AppButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: AppButtonVariant;
  iconName?: keyof typeof Ionicons.glyphMap;
  accessibilityHint?: string;
  /** Full-width by default; pass false for an inline/auto-width button. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one button. Owns minHeight 44, variant colours (each AA-checked against
 * its fill), pressed/disabled/busy states, and the button accessibility
 * contract so every button in the app is correct by construction.
 */
export function AppButton({
  label,
  onPress,
  disabled,
  busy,
  variant = "primary",
  iconName,
  accessibilityHint,
  fullWidth = true,
  style,
}: AppButtonProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const v = colorsFor(theme, variant);
  const isDisabled = !!disabled || !!busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator color={v.fg} />
        ) : (
          <>
            {iconName && <Ionicons name={iconName} size={Math.round(theme.type.label.fontSize * 1.2)} color={v.fg} />}
            <Text style={[styles.label, { color: v.fg }]} numberOfLines={1}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

function colorsFor(t: Theme, variant: AppButtonVariant): { bg: string; fg: string; border: string } {
  const c = t.colors;
  switch (variant) {
    case "secondary":
      return { bg: c.surfaceAlt, fg: c.textPrimary, border: c.borderStrong };
    case "warn":
      return { bg: c.warnFill, fg: c.onWarnFill, border: c.warnFill };
    case "danger":
      return { bg: c.dangerFill, fg: c.onDangerFill, border: c.dangerFill };
    case "ghost":
      return { bg: "transparent", fg: c.accent, border: "transparent" };
    case "primary":
    default:
      return { bg: c.accentFill, fg: c.onAccentFill, border: c.accentFill };
  }
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    base: {
      minHeight: t.minTouch,
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.lg,
      borderRadius: t.radii.md,
      borderWidth: t.borderWidth,
      alignItems: "center",
      justifyContent: "center",
    },
    fullWidth: { alignSelf: "stretch" },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.45 },
    row: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
    label: { fontSize: t.type.label.fontSize, lineHeight: t.type.label.lineHeight, fontWeight: t.type.label.fontWeight, textAlign: "center" },
  }),
);
