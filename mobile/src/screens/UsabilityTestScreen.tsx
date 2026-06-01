import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, Share, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { AppButton, Card, SectionHeader, Screen, SettingRow, Stepper } from "../components";
import { makeStyles, useTheme } from "../theme";
import { ui, useUi } from "../i18n/ui";
import { useUsabilityLog, buildUsabilityCsv } from "../state/usabilityLog";

/**
 * Testing-mode screen (reached from Settings → Testing). Lets the moderator tag
 * the active task so auto-recorded command rows group per scenario, shows live
 * per-task counts, and exports the session as CSV to paste into the Google Sheet.
 *
 * The objective timings (wake → glasses start speaking) are recorded
 * automatically by the latency timeline (utils/timeline.ts) — there is no
 * stopwatch and no Metro-log scraping. Sighted-helper screen; the core voice
 * flow stays screen-free.
 */
const TASK_COUNT = 8;

/** Stable, language-independent command labels — keep aligned with ui.usability.tasks order. */
const TASK_COMMANDS = [
  "scene-summarize",
  "ocr-read-text",
  "face-recognize",
  "face-enroll",
  "find-object",
  "currency-recognize",
  "visual-qa",
  "color-detect",
] as const;

/** Stable task tag stored on each row, independent of UI language. */
function labelFor(index: number): string {
  return `${index} · ${TASK_COMMANDS[index - 1]}`;
}

function secondsOrDash(ms: number | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`;
}

export default function UsabilityTestScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const navigation = useNavigation();

  const rows = useUsabilityLog((s) => s.rows);
  const activeTask = useUsabilityLog((s) => s.activeTask);
  const setActiveTask = useUsabilityLog((s) => s.setActiveTask);
  const clear = useUsabilityLog((s) => s.clear);

  // Local index, seeded from any task already tagged this session.
  const seeded = parseInt(activeTask, 10);
  const [index, setIndex] = useState(
    Number.isFinite(seeded) && seeded >= 1 && seeded <= TASK_COUNT ? seeded : 1,
  );

  // Title follows the UI language.
  useLayoutEffect(() => {
    navigation.setOptions({ title: t(ui.usability.title) });
  }, [navigation, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the store's active task tag in sync with the picker.
  useEffect(() => {
    setActiveTask(labelFor(index));
  }, [index, setActiveTask]);

  const activeLabel = labelFor(index);
  const taskRows = rows.filter((r) => r.taskLabel === activeLabel);
  const invocations = taskRows.length;
  const recoveries = Math.max(0, invocations - 1);
  // Live latency = end-of-speech → first spoken word (the true system
  // response time). NOT wake→first-word, which would also include the
  // listening cue, the participant's own spoken command, and the
  // silence-detection tail — inflating it ~2×.
  const lastFirstWord = taskRows[taskRows.length - 1]?.endUtteranceToFirstWordMs;

  const onExport = async () => {
    if (rows.length === 0) {
      Alert.alert(t(ui.usability.notice), t(ui.usability.nothingToExport), [{ text: t(ui.settings.ok) }]);
      return;
    }
    try {
      await Share.share({ title: t(ui.usability.shareTitle), message: buildUsabilityCsv(rows) });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const onClear = () => {
    Alert.alert(t(ui.usability.clearTitle), t(ui.usability.clearMsg), [
      { text: t(ui.usability.cancel), style: "cancel" },
      { text: t(ui.usability.clear), style: "destructive", onPress: () => clear() },
    ]);
  };

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.intro}>{t(ui.usability.intro)}</Text>
      </Card>

      <SectionHeader title={t(ui.usability.activeTask)} />
      <Card>
        <SettingRow label={t(ui.usability.activeTask)}>
          <Stepper
            label={t(ui.usability.activeTask)}
            value={index}
            min={1}
            max={TASK_COUNT}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => setIndex(v)}
          />
        </SettingRow>
        <Text style={styles.taskName} accessibilityRole="header">
          {`${index}. ${t(ui.usability.tasks[index - 1]!)}`}
        </Text>
        <View style={styles.divider} />
        <InfoRow styles={styles} label={t(ui.usability.invocations)} value={String(invocations)} />
        <InfoRow styles={styles} label={t(ui.usability.recoveries)} value={String(recoveries)} />
        <InfoRow styles={styles} label={t(ui.usability.lastFirstWord)} value={secondsOrDash(lastFirstWord)} />
        <InfoRow styles={styles} label={t(ui.usability.totalRows)} value={String(rows.length)} />
      </Card>

      <AppButton variant="primary" iconName="share-outline" label={t(ui.usability.export)} onPress={onExport} />
      <AppButton variant="danger" iconName="trash-outline" label={t(ui.usability.clear)} onPress={onClear} />
    </Screen>
  );
}

function InfoRow({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    intro: {
      color: t.colors.textSecondary,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
    },
    taskName: {
      color: t.colors.accent,
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: t.type.title.fontWeight,
      marginTop: t.spacing.sm,
    },
    divider: { height: t.borderWidth, backgroundColor: t.colors.border, marginVertical: t.spacing.sm },
    infoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: t.spacing.xs,
      gap: t.spacing.md,
    },
    infoLabel: {
      color: t.colors.textSecondary,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      flexShrink: 1,
    },
    infoValue: {
      color: t.colors.textPrimary,
      fontSize: t.type.title.fontSize,
      lineHeight: t.type.title.lineHeight,
      fontWeight: t.type.title.fontWeight,
      fontVariant: ["tabular-nums"],
    },
  }),
);
