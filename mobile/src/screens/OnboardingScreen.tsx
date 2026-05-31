import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppButton, Card } from "../components";
import { makeStyles, useTheme } from "../theme";
import { ui, useUi } from "../i18n/ui";
import { useBluetoothSession } from "../ble/connection";
import { useOnboarding } from "../state/onboarding";
import { Logger } from "../utils/logger";

const logger = new Logger("Onboarding");
const LOGO = require("../../assets/logo-white.png");
const TOTAL_STEPS = 4;

/**
 * First-launch wizard: welcome -> permissions explainer -> scan & pair -> done.
 * Reads the single shared BLE session via useBluetoothSession() (NOT a second
 * useSuhailBluetooth() — the provider owns the one instance). Fully themed +
 * VoiceOver-friendly: heading focus on each step, a step indicator that isn't
 * colour-only, and 44px targets. A "Skip for now" path lets the demo proceed
 * without glasses present.
 */
export default function OnboardingScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const session = useBluetoothSession();
  const complete = useOnboarding((s) => s.complete);

  const [step, setStep] = useState(0);
  const [scannedOnce, setScannedOnce] = useState(false);
  const headingRef = useRef<Text>(null);

  const connected = session.glasses.connected;

  // Move VoiceOver focus to the step heading whenever the step changes.
  useEffect(() => {
    const tag = headingRef.current ? findNodeHandle(headingRef.current) : null;
    if (tag != null) {
      const timer = setTimeout(() => AccessibilityInfo.setAccessibilityFocus(tag), 250);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [step]);

  const onScan = useCallback(async () => {
    setScannedOnce(true);
    try {
      await session.scan.start();
    } catch (err) {
      logger.error("scan failed", err);
    }
  }, [session.scan]);

  const goNext = useCallback(() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1)), []);
  const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const primaryLabel =
    step === 0
      ? t(ui.onboarding.getStarted)
      : step === 1
        ? t(ui.onboarding.continue)
        : step === 2
          ? connected
            ? t(ui.onboarding.next)
            : t(ui.onboarding.skip)
          : t(ui.onboarding.finish);

  const onPrimary = useCallback(() => {
    if (step < TOTAL_STEPS - 1) goNext();
    else complete();
  }, [step, goNext, complete]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <View style={styles.center}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityRole="image" accessibilityLabel="Suhail" />
            <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
              {t(ui.onboarding.welcomeTitle)}
            </Text>
            <Text style={styles.body}>{t(ui.onboarding.welcomeBody)}</Text>
          </View>
        )}

        {step === 1 && (
          <View style={styles.center}>
            <Ionicons name="shield-checkmark-outline" size={64} color={theme.colors.accent} />
            <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
              {t(ui.onboarding.permsTitle)}
            </Text>
            <Text style={styles.body}>{t(ui.onboarding.permsBody)}</Text>
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepBody}>
            <Ionicons name="bluetooth-outline" size={56} color={theme.colors.accent} style={styles.centerIcon} />
            <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
              {t(ui.onboarding.pairTitle)}
            </Text>
            <Text style={styles.body}>{t(ui.onboarding.pairBody)}</Text>

            {connected ? (
              <Card tone="ok">
                <View style={styles.okRow}>
                  <Ionicons name="checkmark-circle" size={24} color={theme.colors.successText} />
                  <Text style={styles.okText}>
                    {t(ui.onboarding.pairedTitle)}
                    {session.defaultDevice ? `: ${session.defaultDevice.name}` : ""}
                  </Text>
                </View>
              </Card>
            ) : (
              <View style={styles.scanArea}>
                <AppButton
                  iconName="search"
                  label={session.busy ? t(ui.onboarding.scanning) : t(ui.home.scan)}
                  busy={session.busy}
                  onPress={onScan}
                />
                {session.scan.devices.map((d) => (
                  <AppButton
                    key={d.id}
                    variant="secondary"
                    iconName="glasses-outline"
                    label={d.name}
                    onPress={() => session.connect(d, { saveAsDefault: true })}
                  />
                ))}
                {scannedOnce && !session.busy && session.scan.devices.length === 0 && (
                  <Text style={styles.hint}>{t(ui.onboarding.noDevices)}</Text>
                )}
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View style={styles.center}>
            <Ionicons name="sparkles-outline" size={64} color={theme.colors.accent} />
            <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
              {t(ui.onboarding.doneTitle)}
            </Text>
            <Text style={styles.body}>{t(ui.onboarding.doneBody)}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <StepIndicator step={step} total={TOTAL_STEPS} label={`${step + 1} / ${TOTAL_STEPS}`} />
        <View style={styles.actions}>
          {step > 0 && (
            <AppButton variant="ghost" label={t(ui.onboarding.back)} onPress={goBack} fullWidth={false} />
          )}
          <View style={styles.primaryWrap}>
            <AppButton label={primaryLabel} onPress={onPrimary} />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

/** Dots whose current step differs by SIZE/shape, not colour alone. */
function StepIndicator({ step, total, label }: { step: number; total: number; label: string }): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.dots} accessibilityRole="text" accessibilityLabel={label}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === step ? styles.dotActive : styles.dotInactive]} />
      ))}
    </View>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    scroll: { flexGrow: 1, justifyContent: "center", padding: t.spacing.xl, gap: t.spacing.lg },
    center: { alignItems: "center", gap: t.spacing.lg },
    stepBody: { gap: t.spacing.lg },
    centerIcon: { alignSelf: "center" },
    logo: { width: 140, height: 140 },
    title: {
      color: t.colors.textPrimary,
      fontSize: t.type.display.fontSize,
      lineHeight: t.type.display.lineHeight,
      fontWeight: t.type.display.fontWeight,
      textAlign: "center",
    },
    body: {
      color: t.colors.textSecondary,
      fontSize: t.type.body.fontSize,
      lineHeight: t.type.body.lineHeight,
      textAlign: "center",
    },
    scanArea: { gap: t.spacing.sm },
    hint: { color: t.colors.textMuted, fontSize: t.type.body.fontSize, textAlign: "center", marginTop: t.spacing.sm },
    okRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
    okText: { color: t.colors.textPrimary, fontSize: t.type.body.fontSize, flexShrink: 1 },
    footer: {
      padding: t.spacing.xl,
      gap: t.spacing.lg,
      borderTopWidth: t.borderWidth,
      borderTopColor: t.colors.border,
    },
    dots: { flexDirection: "row", justifyContent: "center", gap: t.spacing.sm },
    dot: { height: 10, borderRadius: 5 },
    dotActive: { width: 28, backgroundColor: t.colors.accent },
    dotInactive: { width: 10, backgroundColor: t.colors.surfaceAlt, borderWidth: t.borderWidth, borderColor: t.colors.borderStrong },
    actions: { flexDirection: "row", alignItems: "center", gap: t.spacing.md },
    primaryWrap: { flex: 1 },
  }),
);
