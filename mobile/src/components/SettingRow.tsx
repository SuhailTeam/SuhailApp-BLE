import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";

interface SettingRowProps {
  label: string;
  children: React.ReactNode;
  /** Optional helper text under the label. */
  hint?: string;
}

/**
 * Label + control row. Wraps when the control is wide or text scales up. The
 * label and control stay distinct VoiceOver nodes (the control carries its own
 * role/state).
 */
export function SettingRow({ label, children, hint }: SettingRowProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.row}>
      <View style={styles.labelWrap}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.control}>{children}</View>
    </View>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: t.spacing.md,
      minHeight: t.minTouch,
    },
    labelWrap: { flexShrink: 1, gap: 2 },
    label: { color: t.colors.textPrimary, fontSize: t.type.body.fontSize, lineHeight: t.type.body.lineHeight },
    hint: { color: t.colors.textMuted, fontSize: t.type.caption.fontSize, lineHeight: t.type.caption.lineHeight },
    control: { flexShrink: 0 },
  }),
);
