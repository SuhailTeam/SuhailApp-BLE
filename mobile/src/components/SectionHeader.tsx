import React, { useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { makeStyles, useTheme } from "../theme";

interface SectionHeaderProps {
  title: string;
}

/** Uppercase section label, exposed to VoiceOver as a heading. */
export function SectionHeader({ title }: SectionHeaderProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {title}
    </Text>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    title: {
      color: t.colors.textMuted,
      fontSize: t.type.caption.fontSize,
      lineHeight: t.type.caption.lineHeight,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
  }),
);
