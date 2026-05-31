import React, { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles, useTheme } from "../theme";
import type { Theme } from "../theme";

export type CardTone = "default" | "ok" | "warn" | "danger";

interface CardProps {
  children: React.ReactNode;
  tone?: CardTone;
  style?: StyleProp<ViewStyle>;
}

/** Themed surface container. `tone` tints the border/background for status. */
export function Card({ children, tone = "default", style }: CardProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={[styles.card, toneStyle(theme, tone), style]}>{children}</View>;
}

function toneStyle(t: Theme, tone: CardTone): ViewStyle {
  const c = t.colors;
  switch (tone) {
    case "ok":
      return { backgroundColor: c.okCardBg, borderColor: c.okCardBorder };
    case "warn":
      return { backgroundColor: c.warnCardBg, borderColor: c.warnCardBorder };
    case "danger":
      return { backgroundColor: c.surface, borderColor: c.danger };
    case "default":
    default:
      return { backgroundColor: c.surface, borderColor: c.border };
  }
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    card: {
      padding: t.spacing.lg,
      borderRadius: t.radii.lg,
      borderWidth: t.borderWidth,
      gap: t.spacing.sm,
    },
  }),
);
