import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "../theme";

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap content in a ScrollView (for screens taller than the viewport). */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Safe-area edges. Default ["bottom"] (tab screens have a header up top). */
  edges?: readonly Edge[];
}

/** Themed screen shell: safe-area background + padded content host. */
export function Screen({ children, scroll, contentStyle, edges = ["bottom"] }: ScreenProps): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    content: { padding: t.spacing.xl, gap: t.spacing.lg },
    fill: { flex: 1 },
  }),
);
