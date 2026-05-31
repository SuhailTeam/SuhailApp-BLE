import React, { useMemo } from "react";
import { Alert, I18nManager, StyleSheet, View } from "react-native";

import { AppButton, Card, Chip, SectionHeader, Screen, SettingRow, Stepper } from "../components";
import { makeStyles, useTheme, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from "../theme";
import { ui, useUi } from "../i18n/ui";
import type { Language } from "../i18n/messages";
import { useSettings } from "../state/settings";
import { useAppearance, TEXT_SCALE_STEP } from "../state/appearance";

export default function SettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useUi();
  const settings = useSettings();
  const themeMode = useAppearance((s) => s.themeMode);
  const textScale = useAppearance((s) => s.textScale);
  const updateAppearance = useAppearance((s) => s.update);
  const resetAppearance = useAppearance((s) => s.reset);

  const onLanguage = (next: Language) => {
    if (next === settings.language) return;
    settings.update({ language: next });
    // forceRTL only takes effect after a reload — prompt a restart on a
    // direction change so the layout mirrors correctly.
    const wantRTL = next === "ar";
    if (I18nManager.isRTL !== wantRTL) {
      I18nManager.forceRTL(wantRTL);
      Alert.alert(t(ui.settings.restartTitle), t(ui.settings.restartMsg), [{ text: t(ui.settings.ok) }]);
    }
  };

  const onReset = () => {
    settings.reset();
    resetAppearance();
  };

  return (
    <Screen scroll>
      {/* Voice output */}
      <SectionHeader title={t(ui.settings.voiceSection)} />
      <Card>
        <SettingRow label={t(ui.settings.language)}>
          <View style={styles.chipsRow}>
            <Chip label={t(ui.settings.arabic)} selected={settings.language === "ar"} onPress={() => onLanguage("ar")} />
            <Chip label={t(ui.settings.english)} selected={settings.language === "en"} onPress={() => onLanguage("en")} />
          </View>
        </SettingRow>
        <View style={styles.divider} />
        <SettingRow label={t(ui.settings.speechSpeed)}>
          <Stepper
            label={t(ui.settings.speechSpeed)}
            value={settings.speechSpeed}
            min={0.5}
            max={2.0}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => settings.update({ speechSpeed: v })}
          />
        </SettingRow>
        <View style={styles.divider} />
        <SettingRow label={t(ui.settings.volume)}>
          <Stepper
            label={t(ui.settings.volume)}
            value={settings.volume}
            min={0}
            max={1}
            step={0.1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => settings.update({ volume: v })}
          />
        </SettingRow>
        <View style={styles.divider} />
        <SettingRow label={t(ui.settings.voice)}>
          <View style={styles.chipsRow}>
            <Chip label={t(ui.settings.voiceDefault)} selected={settings.voicePreset === "default"} onPress={() => settings.update({ voicePreset: "default" })} />
            <Chip label={t(ui.settings.voiceMale)} selected={settings.voicePreset === "male"} onPress={() => settings.update({ voicePreset: "male" })} />
            <Chip label={t(ui.settings.voiceFemale)} selected={settings.voicePreset === "female"} onPress={() => settings.update({ voicePreset: "female" })} />
          </View>
        </SettingRow>
      </Card>

      {/* Appearance & accessibility */}
      <SectionHeader title={t(ui.settings.appearanceSection)} />
      <Card>
        <SettingRow label={t(ui.settings.theme)}>
          <View style={styles.chipsRow}>
            <Chip label={t(ui.settings.themeDark)} selected={themeMode === "dark"} onPress={() => updateAppearance({ themeMode: "dark" })} />
            <Chip label={t(ui.settings.themeHighContrast)} selected={themeMode === "highContrast"} onPress={() => updateAppearance({ themeMode: "highContrast" })} />
          </View>
        </SettingRow>
        <View style={styles.divider} />
        <SettingRow label={t(ui.settings.textSize)}>
          <Stepper
            label={t(ui.settings.textSize)}
            value={textScale}
            min={TEXT_SCALE_MIN}
            max={TEXT_SCALE_MAX}
            step={TEXT_SCALE_STEP}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => updateAppearance({ textScale: v })}
          />
        </SettingRow>
      </Card>

      <AppButton variant="secondary" label={t(ui.settings.reset)} onPress={onReset} fullWidth={false} />
    </Screen>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, justifyContent: "flex-end" },
    divider: { height: t.borderWidth, backgroundColor: t.colors.border },
  }),
);
