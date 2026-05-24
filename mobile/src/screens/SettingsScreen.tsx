import React from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSettings, type VoicePreset } from "../state/settings";

export default function SettingsScreen() {
  const settings = useSettings();
  const isArabic = settings.language === "ar";

  const labels = isArabic
    ? {
        language: "اللغة",
        arabic: "العربية",
        english: "English",
        speechSpeed: "سرعة الكلام",
        volume: "مستوى الصوت",
        voice: "الصوت",
        voiceDefault: "افتراضي",
        voiceMale: "ذكر",
        voiceFemale: "أنثى",
        reset: "إعادة الضبط",
      }
    : {
        language: "Language",
        arabic: "Arabic",
        english: "English",
        speechSpeed: "Speech speed",
        volume: "Volume",
        voice: "Voice",
        voiceDefault: "Default",
        voiceMale: "Male",
        voiceFemale: "Female",
        reset: "Reset to defaults",
      };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Section title={labels.language}>
          <View style={styles.row}>
            <Text style={styles.label}>{labels.arabic}</Text>
            <Switch
              value={isArabic}
              onValueChange={(v) => settings.update({ language: v ? "ar" : "en" })}
              trackColor={{ false: "#334155", true: "#38BDF8" }}
              thumbColor="#F8FAFC"
            />
            <Text style={styles.label}>{labels.english}</Text>
          </View>
        </Section>

        <Section title={labels.speechSpeed}>
          <StepperRow
            value={settings.speechSpeed}
            min={0.5}
            max={2.0}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => settings.update({ speechSpeed: v })}
          />
        </Section>

        <Section title={labels.volume}>
          <StepperRow
            value={settings.volume}
            min={0}
            max={1}
            step={0.1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => settings.update({ volume: v })}
          />
        </Section>

        <Section title={labels.voice}>
          <View style={styles.row}>
            <VoiceChip label={labels.voiceDefault} active={settings.voicePreset === "default"} onPress={() => settings.update({ voicePreset: "default" })} />
            <VoiceChip label={labels.voiceMale} active={settings.voicePreset === "male"} onPress={() => settings.update({ voicePreset: "male" })} />
            <VoiceChip label={labels.voiceFemale} active={settings.voicePreset === "female"} onPress={() => settings.update({ voicePreset: "female" })} />
          </View>
        </Section>

        <Pressable style={styles.resetBtn} onPress={() => settings.reset()}>
          <Text style={styles.resetText}>{labels.reset}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StepperRow({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.stepBtn, value <= min && styles.stepBtnDisabled]}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, +(value - step).toFixed(2)))}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format(value)}</Text>
      <Pressable
        style={[styles.stepBtn, value >= max && styles.stepBtnDisabled]}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, +(value + step).toFixed(2)))}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

function VoiceChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  container: { padding: 20, gap: 20 },
  section: { gap: 10 },
  sectionTitle: { color: "#F8FAFC", fontSize: 14, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  label: { color: "#CBD5E1", fontSize: 15 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", borderColor: "#1E293B", borderWidth: 1 },
  stepBtnDisabled: { opacity: 0.4 },
  stepText: { color: "#F8FAFC", fontSize: 22, fontWeight: "600" },
  stepValue: { color: "#F8FAFC", fontSize: 18, fontVariant: ["tabular-nums"], minWidth: 60, textAlign: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#1E293B", backgroundColor: "#0F172A" },
  chipActive: { borderColor: "#38BDF8", backgroundColor: "#0C4A6E" },
  chipText: { color: "#94A3B8", fontSize: 14 },
  chipTextActive: { color: "#F8FAFC", fontWeight: "600" },
  resetBtn: { marginTop: 16, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#1E293B" },
  resetText: { color: "#CBD5E1", fontSize: 13 },
});
