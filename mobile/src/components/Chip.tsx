import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * Selectable pill. Selected state is conveyed by BOTH a colour change AND a
 * check glyph (never colour alone), and announced to VoiceOver via
 * accessibilityState.selected.
 */
export function Chip({ label, selected, onPress }: ChipProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        {selected && <Ionicons name="checkmark" size={16} color={theme.colors.textPrimary} />}
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    chip: {
      minHeight: t.minTouch,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.sm,
      borderRadius: t.radii.pill,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surface,
      justifyContent: "center",
    },
    chipSelected: { borderColor: t.colors.accent, backgroundColor: t.colors.surfaceAlt },
    pressed: { opacity: 0.85 },
    row: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
    label: { color: t.colors.textMuted, fontSize: t.type.label.fontSize, lineHeight: t.type.label.lineHeight },
    labelSelected: { color: t.colors.textPrimary, fontWeight: t.type.label.fontWeight },
  }),
);
