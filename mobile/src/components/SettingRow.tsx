import React, { useMemo } from "react";
import { I18nManager, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles, useTheme } from "../theme";
import { useUi } from "../i18n/ui";

interface SettingRowProps {
  label: string;
  children: React.ReactNode;
  /** Optional helper text under the label. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Label + control row. Wraps when the control is wide or text scales up. The
 * label and control stay distinct VoiceOver nodes (the control carries its own
 * role/state).
 */
export function SettingRow({ label, children, hint, style }: SettingRowProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { lang } = useUi();
  const isRTL = lang === "ar";
  
  const labelAlignItems = isRTL
    ? (I18nManager.isRTL ? "flex-start" : "flex-end")
    : (I18nManager.isRTL ? "flex-end" : "flex-start");

  const labelTextAlign = isRTL
    ? (I18nManager.isRTL ? "left" : "right")
    : (I18nManager.isRTL ? "right" : "left");

  const flexDirection = isRTL ? (I18nManager.isRTL ? "row" : "row-reverse") : (I18nManager.isRTL ? "row-reverse" : "row");

  return (
    <View style={[styles.row, { flexDirection }, style]}>
      <View style={[styles.labelWrap, { alignItems: labelAlignItems }]}>
        <Text style={[styles.label, { textAlign: labelTextAlign }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { textAlign: labelTextAlign }]}>{hint}</Text> : null}
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
