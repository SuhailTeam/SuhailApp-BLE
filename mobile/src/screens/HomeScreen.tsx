import React, { useCallback } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSuhailBluetooth } from "../ble/connection";
import { useBatteryStatus, useButtonPress, useTouchEvent } from "../ble/events";
import { useActivity } from "../state/activity";
import { useSettings } from "../state/settings";
import { activate, interruptAndListen, repeatLast, useListening } from "../state/listening";
import { Logger } from "../utils/logger";

const logger = new Logger("HomeScreen");

export default function HomeScreen() {
  const session = useSuhailBluetooth();
  const language = useSettings((s) => s.language);
  const logEvent = useActivity((s) => s.log);

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
  const stateLabel = session.glasses.connection.state;

  const labels = language === "ar"
    ? {
        connected: "متصل",
        disconnected: "غير متصل",
        connecting: "جاري الاتصال...",
        scan: "ابحث عن النظارة",
        connect: "اتصل بالنظارة المحفوظة",
        disconnect: "اقطع الاتصال",
        forget: "انسَ النظارة",
        battery: "البطارية",
        firmware: "البرنامج الثابت",
        commandsTitle: "الأوامر الصوتية",
        commandsBody: "اسحب للأمام على النظارة، ثم تكلم: «صف ما حولي»، «اقرأ»، «من هذا؟»، «ابحث عن مفاتيحي»، «عدّ النقود»، «اللون».",
        testListening: "جرب الاستماع",
        testRepeat: "كرر آخر رد",
        listenIdle: "خامل",
        listenActive: "ينصت",
        listenProcessing: "يعالج",
      }
    : {
        connected: "Connected",
        disconnected: "Disconnected",
        connecting: "Connecting…",
        scan: "Scan for glasses",
        connect: "Connect to saved glasses",
        disconnect: "Disconnect",
        forget: "Forget glasses",
        battery: "Battery",
        firmware: "Firmware",
        commandsTitle: "Voice commands",
        commandsBody:
          "Swipe forward on the glasses, then speak: \"describe my surroundings\", \"read this\", \"who is this?\", \"find my keys\", \"count money\", \"color\".",
        testListening: "Test listening",
        testRepeat: "Repeat last",
        listenIdle: "idle",
        listenActive: "listening",
        listenProcessing: "processing",
      };

  const listenLabel = listeningState === "active"
    ? labels.listenActive
    : listeningState === "processing"
      ? labels.listenProcessing
      : labels.listenIdle;

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

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.statusCard, isConnected ? styles.cardOk : styles.cardWarn]}>
          <Text style={styles.statusLabel}>
            {isConnected ? labels.connected : session.busy ? labels.connecting : labels.disconnected}
          </Text>
          <Text style={styles.statusSub}>state: {stateLabel}</Text>
          {session.defaultDevice && (
            <Text style={styles.statusSub}>device: {session.defaultDevice.name}</Text>
          )}
        </View>

        {session.glasses.connected && (
          <View style={styles.infoRow}>
            <Text style={styles.info}>
              {labels.battery}: {session.glasses.battery.level ?? "—"}%
              {session.glasses.battery.charging ? " ⚡" : ""}
            </Text>
            {session.glasses.firmware.version && (
              <Text style={styles.info}>{labels.firmware}: {session.glasses.firmware.version}</Text>
            )}
          </View>
        )}

        <View style={styles.actions}>
          <ActionButton label={labels.scan} onPress={onScan} disabled={session.busy} />
          <ActionButton label={labels.connect} onPress={onConnectDefault} disabled={session.busy || !session.defaultDevice} />
          {isConnected && <ActionButton label={labels.disconnect} onPress={onDisconnect} disabled={session.busy} variant="warn" />}
          {session.defaultDevice && <ActionButton label={labels.forget} onPress={onForget} disabled={session.busy} variant="danger" />}
        </View>

        {session.busy && <ActivityIndicator color="#38BDF8" style={{ marginTop: 16 }} />}

        <View style={styles.listenCard}>
          <View style={styles.listenRow}>
            <View style={[styles.listenDot, listenDotStyle(listeningState)]} />
            <Text style={styles.listenText}>{listenLabel}</Text>
          </View>
          <View style={styles.listenButtons}>
            <Pressable style={styles.listenBtn} onPress={() => void activate()}>
              <Text style={styles.listenBtnText}>{labels.testListening}</Text>
            </Pressable>
            <Pressable style={styles.listenBtn} onPress={() => void repeatLast()}>
              <Text style={styles.listenBtnText}>{labels.testRepeat}</Text>
            </Pressable>
          </View>
        </View>

        {session.scan.devices.length > 0 && (
          <View style={styles.scanResults}>
            <Text style={styles.scanTitle}>
              {language === "ar" ? "النتائج" : "Found"} ({session.scan.devices.length})
            </Text>
            {session.scan.devices.map((d) => (
              <Pressable
                key={d.id}
                style={styles.deviceRow}
                onPress={() => session.connect(d, { saveAsDefault: true })}
              >
                <Text style={styles.deviceName}>{d.name}</Text>
                {d.rssi !== undefined && <Text style={styles.deviceMeta}>rssi: {d.rssi} dBm</Text>}
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>{labels.commandsTitle}</Text>
          <Text style={styles.tipsBody}>{labels.commandsBody}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "warn" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === "warn" && styles.btnWarn,
        variant === "danger" && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  container: { padding: 20, gap: 16 },
  statusCard: { padding: 20, borderRadius: 16, borderWidth: 1 },
  cardOk: { backgroundColor: "#052e1a", borderColor: "#16a34a" },
  cardWarn: { backgroundColor: "#1c1917", borderColor: "#a16207" },
  statusLabel: { color: "#F8FAFC", fontSize: 22, fontWeight: "700" },
  statusSub: { color: "#94A3B8", marginTop: 4, fontSize: 13 },
  infoRow: { flexDirection: "row", gap: 16, paddingHorizontal: 4 },
  info: { color: "#CBD5E1", fontSize: 14 },
  actions: { gap: 12 },
  btn: { backgroundColor: "#0284C7", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { backgroundColor: "#334155", opacity: 0.6 },
  btnWarn: { backgroundColor: "#A16207" },
  btnDanger: { backgroundColor: "#991B1B" },
  btnText: { color: "#F8FAFC", fontSize: 16, fontWeight: "600" },
  scanResults: { backgroundColor: "#0F172A", padding: 12, borderRadius: 12, borderColor: "#1E293B", borderWidth: 1, gap: 6 },
  scanTitle: { color: "#94A3B8", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  deviceRow: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "#1E293B" },
  deviceName: { color: "#F8FAFC", fontSize: 15, fontWeight: "500" },
  deviceMeta: { color: "#64748B", fontSize: 12, marginTop: 2 },
  tipsCard: { backgroundColor: "#0F172A", padding: 16, borderRadius: 12, borderColor: "#1E293B", borderWidth: 1, marginTop: 8 },
  tipsTitle: { color: "#F8FAFC", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  tipsBody: { color: "#94A3B8", fontSize: 14, lineHeight: 20 },
  listenCard: { backgroundColor: "#0F172A", padding: 14, borderRadius: 12, borderColor: "#1E293B", borderWidth: 1, gap: 10 },
  listenRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  listenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#475569" },
  listenDotActive: { backgroundColor: "#38BDF8" },
  listenDotProcessing: { backgroundColor: "#A78BFA" },
  listenText: { color: "#CBD5E1", fontSize: 14, fontVariant: ["tabular-nums"] },
  listenButtons: { flexDirection: "row", gap: 8 },
  listenBtn: { flex: 1, backgroundColor: "#1E293B", paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  listenBtnText: { color: "#F8FAFC", fontSize: 13, fontWeight: "500" },
});

function listenDotStyle(state: "idle" | "active" | "processing") {
  if (state === "active") return styles.listenDotActive;
  if (state === "processing") return styles.listenDotProcessing;
  return undefined;
}
