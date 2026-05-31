import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Accessible name (VoiceOver reads "<label>, adjustable, <value>"). */
  label: string;
}

/**
 * Numeric stepper exposed to VoiceOver as a single `adjustable` element: the row
 * is one a11y node with the formatted value and increment/decrement actions, so
 * a screen-reader user swipes up/down to change it. The visible +/- buttons are
 * hidden from the a11y tree (so VO doesn't read three controls for one value)
 * but remain tappable for sighted users, each a 44px target.
 */
export function Stepper({ value, min, max, step, format, onChange, label }: StepperProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const dec = () => onChange(clamp(round(value - step), min, max));
  const inc = () => onChange(clamp(round(value + step), min, max));
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") inc();
        else if (e.nativeEvent.actionName === "decrement") dec();
      }}
      style={styles.row}
    >
      <Pressable
        onPress={dec}
        disabled={atMin}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.btn, atMin && styles.btnDisabled]}
      >
        <Ionicons name="remove" size={22} color={theme.colors.textPrimary} />
      </Pressable>
      <Text style={styles.value}>{format(value)}</Text>
      <Pressable
        onPress={inc}
        disabled={atMax}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.btn, atMax && styles.btnDisabled]}
      >
        <Ionicons name="add" size={22} color={theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function round(v: number): number {
  return +v.toFixed(2);
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: t.spacing.md },
    btn: {
      width: t.minTouch,
      height: t.minTouch,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.surfaceAlt,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDisabled: { opacity: 0.4 },
    value: {
      color: t.colors.textPrimary,
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: t.type.title.fontWeight,
      fontVariant: ["tabular-nums"],
      minWidth: 72,
      textAlign: "center",
    },
  }),
);
