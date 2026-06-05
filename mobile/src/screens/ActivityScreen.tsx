import React, { useMemo, useLayoutEffect } from "react";
import { FlatList, I18nManager, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { makeStyles, useTheme } from "../theme";
import type { ThemeColors } from "../theme";
import { ui, useUi } from "../i18n/ui";
import { useActivity, type ActivityType } from "../state/activity";

/** Token colour per activity type. Distinct hues, all AA on the tinted tag. */
function typeColor(c: ThemeColors, type: ActivityType): string {
  switch (type) {
    case "command":
      return c.accent;
    case "ble":
      return c.warningText;
    case "error":
      return c.danger;
    case "system":
    default:
      return c.textMuted;
  }
}

export default function ActivityScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const navigation = useNavigation();
  const isRTL = lang === "ar";
  const entries = useActivity((s) => s.entries);

  useLayoutEffect(() => {
    navigation.setOptions({ title: t(ui.activity.title) });
  }, [navigation, lang]);

  const bodyAlignItems = isRTL
    ? (I18nManager.isRTL ? "flex-start" : "flex-end")
    : (I18nManager.isRTL ? "flex-end" : "flex-start");

  const textAlignStyle = {
    textAlign: isRTL
      ? (I18nManager.isRTL ? "left" : "right")
      : (I18nManager.isRTL ? "right" : "left"),
  } as const;

  const rowDirection = isRTL
    ? (I18nManager.isRTL ? "row-reverse" : "row")
    : (I18nManager.isRTL ? "row" : "row-reverse");

  if (entries.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="time-outline" size={56} color={theme.colors.textMuted} />
          <Text style={styles.empty}>{t(ui.activity.empty)}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <FlatList
        data={[...entries].reverse()}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const color = typeColor(theme.colors, item.type);
          return (
            <View style={[styles.row, { flexDirection: rowDirection }]}>
              <View style={[styles.tag, { backgroundColor: `${color}26`, borderColor: color }]}>
                <Text style={[styles.tagText, { color }]}>{t(ui.activity.types[item.type])}</Text>
              </View>
              <View style={[styles.body, { alignItems: bodyAlignItems }]}>
                <Text style={[styles.event, textAlignStyle]}>{item.event}</Text>
                {item.result ? <Text style={[styles.sub, textAlignStyle]}>{`→ ${item.result}`}</Text> : null}
                <Text style={[styles.time, textAlignStyle]}>{new Date(item.time).toLocaleTimeString()}</Text>
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </SafeAreaView>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: t.spacing.md, padding: t.spacing.xl },
    empty: { color: t.colors.textSecondary, fontSize: t.type.body.fontSize, textAlign: "center" },
    listContent: { padding: t.spacing.lg },
    row: { flexDirection: "row", gap: t.spacing.md, paddingVertical: t.spacing.md },
    tag: {
      paddingHorizontal: t.spacing.sm,
      paddingVertical: 3,
      borderRadius: t.radii.sm,
      borderWidth: t.borderWidth,
      alignSelf: "flex-start",
    },
    tagText: { fontSize: t.type.caption.fontSize, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    body: { flex: 1, gap: 2 },
    event: { color: t.colors.textPrimary, fontSize: t.type.body.fontSize, lineHeight: t.type.body.lineHeight },
    sub: { color: t.colors.textSecondary, fontSize: t.type.caption.fontSize },
    time: { color: t.colors.textMuted, fontSize: t.type.caption.fontSize },
    sep: { height: t.borderWidth, backgroundColor: t.colors.border },
    textLeft: { textAlign: "left" },
    textRight: { textAlign: "right" },
  }),
);
