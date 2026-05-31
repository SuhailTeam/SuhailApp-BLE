import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppButton, Card, SectionHeader, Screen, StatusDot } from "../components";
import { makeStyles, useTheme } from "../theme";
import { ui, useUi } from "../i18n/ui";
import { useBluetoothSession } from "../ble/connection";
import { useBatteryStatus, useButtonPress, useTouchEvent } from "../ble/events";
import { useActivity } from "../state/activity";
import { activate, interruptAndListen, repeatLast, useListening } from "../state/listening";
import { Logger } from "../utils/logger";

const logger = new Logger("HomeScreen");

export default function HomeScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const session = useBluetoothSession();
  const logEvent = useActivity((s) => s.log);

  // ── Listening wiring (preserved verbatim from the pre-overhaul HomeScreen) ──
  // Buttons + swipes drive the listening state machine.
  // Battery events stay in the activity log for debugging.
  useButtonPress(useCallback((event) => {
    logger.info(`button ${event.buttonId} ${event.pressType}`);
    logEvent({ type: "ble", command: `${event.buttonId}-${event.pressType}`, event: `Button: ${event.buttonId} ${event.pressType}` });
    if (event.buttonId === "left" && event.pressType === "short") {
      void interruptAndListen();
    } else if (event.buttonId === "left" && event.pressType === "long") {
      void repeatLast();
    }
    // right/camera button reserved for native gallery — don't intercept.
  }, [logEvent]));

  useTouchEvent(useCallback((event) => {
    logger.info(`touch ${event.gestureName}`);
    logEvent({ type: "ble", command: event.gestureName, event: `Swipe: ${event.gestureName}` });
    if (event.gestureName === "forward_swipe") {
      void activate();
    } else if (event.gestureName === "backward_swipe") {
      void repeatLast();
    }
  }, [logEvent]));

  useBatteryStatus(useCallback((event) => {
    logger.info(`battery ${event.level}% charging=${event.charging}`);
    logEvent({ type: "ble", command: "battery", event: `Battery: ${event.level}% ${event.charging ? "(charging)" : ""}` });
  }, [logEvent]));

  const listeningState = useListening((s) => s.state);
  const isConnected = session.glasses.connected;
  // Connection state is mirrored into the imperative store by the always-mounted
  // BluetoothSessionProvider (App root) — the camera/listening modules see an
  // accurate flag regardless of which tab is active.

  // ── Accessibility announcements (additive — never the only feedback) ────────
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (prevConnected.current !== isConnected) {
      AccessibilityInfo.announceForAccessibility(isConnected ? ui.a11y.connected[lang] : ui.a11y.disconnected[lang]);
      prevConnected.current = isConnected;
    }
  }, [isConnected, lang]);

  const prevListen = useRef(listeningState);
  useEffect(() => {
    if (prevListen.current !== listeningState) {
      if (listeningState === "active") AccessibilityInfo.announceForAccessibility(ui.a11y.listening[lang]);
      else if (listeningState === "processing") AccessibilityInfo.announceForAccessibility(ui.a11y.processing[lang]);
      prevListen.current = listeningState;
    }
  }, [listeningState, lang]);

  const onScan = useCallback(async () => {
    try {
      await session.scan.start();
    } catch (err) {
      logger.error("scan failed", err);
    }
  }, [session.scan]);

  const onConnectDefault = useCallback(async () => {
    try {
      await session.connectDefault();
    } catch (err) {
      logger.error("connectDefault failed", err);
    }
  }, [session]);

  const onDisconnect = useCallback(async () => {
    try {
      await session.disconnect();
    } catch (err) {
      logger.error("disconnect failed", err);
    }
  }, [session]);

  const onForget = useCallback(async () => {
    try {
      await session.clearDefaultDevice();
    } catch (err) {
      logger.error("clearDefaultDevice failed", err);
    }
  }, [session]);

  const statusText = isConnected ? t(ui.home.connected) : session.busy ? t(ui.home.connecting) : t(ui.home.disconnected);
  const listenLabel =
    listeningState === "active" ? t(ui.home.listenActive) : listeningState === "processing" ? t(ui.home.listenProcessing) : t(ui.home.listenIdle);

  return (
    <Screen scroll>
      {/* Connection hero */}
      <Card tone={isConnected ? "ok" : "warn"}>
        <View style={styles.heroRow}>
          <Ionicons
            name={isConnected ? "checkmark-circle" : "alert-circle"}
            size={28}
            color={isConnected ? theme.colors.successText : theme.colors.warningText}
          />
          <View style={styles.heroText}>
            <Text style={styles.statusLabel}>{statusText}</Text>
            {session.defaultDevice ? (
              <Text style={styles.statusSub}>{t(ui.home.device)}: {session.defaultDevice.name}</Text>
            ) : null}
          </View>
          {session.busy ? <ActivityIndicator color={theme.colors.accent} /> : null}
        </View>

        {isConnected ? (
          <View style={styles.batteryRow}>
            <Ionicons name="battery-half-outline" size={18} color={theme.colors.textSecondary} />
            <Text style={styles.info}>
              {t(ui.home.battery)}: {session.glasses.battery.level ?? "—"}%
            </Text>
            {session.glasses.battery.charging ? (
              <View style={styles.inline}>
                <Ionicons name="flash" size={16} color={theme.colors.warningText} />
                <Text style={styles.info}>{t(ui.home.charging)}</Text>
              </View>
            ) : null}
            {session.glasses.firmware.version ? (
              <Text style={styles.infoMuted}>{t(ui.home.firmware)}: {session.glasses.firmware.version}</Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      {/* Connection actions */}
      <View style={styles.actions}>
        <AppButton iconName="search" label={t(ui.home.scan)} onPress={onScan} disabled={session.busy} />
        <AppButton
          iconName="link"
          variant="secondary"
          label={t(ui.home.connect)}
          onPress={onConnectDefault}
          disabled={session.busy || !session.defaultDevice}
        />
        {isConnected ? (
          <AppButton iconName="close-circle" variant="warn" label={t(ui.home.disconnect)} onPress={onDisconnect} disabled={session.busy} />
        ) : null}
        {session.defaultDevice ? (
          <AppButton iconName="trash-outline" variant="danger" label={t(ui.home.forget)} onPress={onForget} disabled={session.busy} />
        ) : null}
      </View>

      {/* Scan results */}
      {session.scan.devices.length > 0 ? (
        <Card>
          <SectionHeader title={`${t(ui.home.found)} (${session.scan.devices.length})`} />
          {session.scan.devices.map((d) => (
            <AppButton
              key={d.id}
              variant="secondary"
              iconName="glasses-outline"
              label={d.name}
              onPress={() => session.connect(d, { saveAsDefault: true })}
            />
          ))}
        </Card>
      ) : null}

      {/* Listening status */}
      <Card>
        <SectionHeader title={t(ui.home.listenTitle)} />
        <View style={styles.listenRow}>
          <StatusDot state={listeningState} />
          <Text style={styles.listenText}>{listenLabel}</Text>
        </View>
        <View style={styles.listenButtons}>
          <View style={styles.flex1}>
            <AppButton variant="secondary" iconName="mic-outline" label={t(ui.home.testListening)} onPress={() => void activate()} />
          </View>
          <View style={styles.flex1}>
            <AppButton variant="secondary" iconName="refresh" label={t(ui.home.testRepeat)} onPress={() => void repeatLast()} />
          </View>
        </View>
      </Card>

      {/* Voice commands reference */}
      <Card>
        <SectionHeader title={t(ui.home.commandsTitle)} />
        <Text style={styles.tipsBody}>{t(ui.home.commandsBody)}</Text>
      </Card>
    </Screen>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    heroRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.md },
    heroText: { flex: 1, gap: 2 },
    statusLabel: { color: t.colors.textPrimary, fontSize: t.type.title.fontSize, lineHeight: t.type.title.lineHeight, fontWeight: t.type.title.fontWeight },
    statusSub: { color: t.colors.textSecondary, fontSize: t.type.caption.fontSize, lineHeight: t.type.caption.lineHeight },
    batteryRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: t.spacing.md, marginTop: t.spacing.xs },
    inline: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
    info: { color: t.colors.textSecondary, fontSize: t.type.body.fontSize },
    infoMuted: { color: t.colors.textMuted, fontSize: t.type.caption.fontSize },
    actions: { gap: t.spacing.md },
    listenRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
    listenText: { color: t.colors.textSecondary, fontSize: t.type.body.fontSize, fontVariant: ["tabular-nums"] },
    listenButtons: { flexDirection: "row", gap: t.spacing.sm, marginTop: t.spacing.xs },
    flex1: { flex: 1 },
    tipsBody: { color: t.colors.textSecondary, fontSize: t.type.body.fontSize, lineHeight: t.type.body.lineHeight },
  }),
);
