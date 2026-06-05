import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Dimensions,
  I18nManager,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppButton, Card, SectionHeader, Screen } from "../components";
import { makeStyles, useTheme } from "../theme";
import { useUi } from "../i18n/ui";
import { useBluetoothSession } from "../ble/connection";
import { useBatteryStatus, useButtonPress, useTouchEvent } from "../ble/events";
import { useActivity } from "../state/activity";
import { activate, interruptAndListen, repeatLast, useListening } from "../state/listening";
import { Logger } from "../utils/logger";

const logger = new Logger("HomeScreen");


const homeUi = {
  statusDisconnected: { ar: "النظارة غير متصلة - اضغط لإعادة الاتصال", en: "Glasses Disconnected - Tap to Reconnect" },
  statusConnected: { ar: "النظارة متصلة", en: "Glasses Connected" },
  tapToTalk: { ar: "اضغط للتحدث", en: "Tap to Talk" },
  listening: { ar: "جاري الاستماع...", en: "Listening…" },
  processing: { ar: "جاري المعالجة...", en: "Processing…" },
  repeatLast: { ar: "إعادة سماع آخر رد", en: "Repeat Last Response" },
  reconnectHint: { ar: "اضغط مرتين للبحث وإعادة الاتصال بنظارتك.", en: "Double tap to scan and reconnect to your glasses." },
  disconnectHint: { ar: "اضغط مرتين لقطع اتصال النظارة.", en: "Double tap to disconnect the glasses." },
  talkHint: { ar: "اضغط للتحدث بصوتك وإرسال أمر للنظارة.", en: "Tap to talk and send a voice command to the glasses." },
  repeatHint: { ar: "اضغط لإعادة نطق آخر رد صوتي من النظارة.", en: "Tap to repeat the last audio response from the glasses." },
  a11yDisconnected: { ar: "النظارة غير متصلة. اضغط مرتين للاتصال.", en: "Glasses disconnected. Double tap to connect." },
  a11yConnected: { ar: "النظارة متصلة. مستوى البطارية ", en: "Glasses connected. Battery level " },
  percent: { ar: " بالمئة", en: " percent" },
};

export default function HomeScreen(): React.ReactElement {
  const [debugConnectedOverride, setDebugConnectedOverride] = useState<boolean | null>(null);
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const session = useBluetoothSession();
  const logEvent = useActivity((s) => s.log);

  // ── Listening wiring ──
  useButtonPress(useCallback((event) => {
    logger.info(`button ${event.buttonId} ${event.pressType}`);
    logEvent({ type: "ble", command: `${event.buttonId}-${event.pressType}`, event: `Button: ${event.buttonId} ${event.pressType}` });
    if (event.buttonId === "left" && event.pressType === "short") {
      void interruptAndListen();
    } else if (event.buttonId === "left" && event.pressType === "long") {
      void repeatLast();
    }
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
  const isConnected = debugConnectedOverride !== null ? debugConnectedOverride : session.glasses.connected;

  // ── Accessibility announcements ──
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (prevConnected.current !== isConnected) {
      const text = session.glasses.connected
        ? `${homeUi.a11yConnected[lang]}${session.glasses.battery?.level ?? 80}${homeUi.percent[lang]}`
        : homeUi.a11yDisconnected[lang];
      AccessibilityInfo.announceForAccessibility(text);
      prevConnected.current = isConnected;
    }
  }, [isConnected, lang, session.glasses.connected ? session.glasses.battery?.level : null]);

  const prevListen = useRef(listeningState);
  useEffect(() => {
    if (prevListen.current !== listeningState) {
      if (listeningState === "active") {
        AccessibilityInfo.announceForAccessibility(homeUi.listening[lang]);
      } else if (listeningState === "processing") {
        AccessibilityInfo.announceForAccessibility(homeUi.processing[lang]);
      }
      prevListen.current = listeningState;
    }
  }, [listeningState, lang]);

  // ── Interaction Handlers ──
  const handleConnectionPress = useCallback(async () => {
    Vibration.vibrate(80);
    try {
      if (isConnected) {
        await session.disconnect();
      } else {
        if (session.defaultDevice) {
          await session.connectDefault();
        } else {
          await session.scan.start();
        }
      }
    } catch (err) {
      logger.error("connection action failed", err);
    }
  }, [isConnected, session]);

  const handleTalkPress = useCallback(() => {
    Vibration.vibrate(120); // distinct vibration pulse
    void activate();
  }, []);

  const handleRepeatPress = useCallback(() => {
    Vibration.vibrate(80);
    void repeatLast();
  }, []);

  const isRTL = lang === "ar";
  const textAlignStyle = {
    textAlign: isRTL
      ? (I18nManager.isRTL ? "left" : "right")
      : (I18nManager.isRTL ? "right" : "left"),
  } as const;
  const innerRowDirection = isRTL
    ? (I18nManager.isRTL ? "row-reverse" : "row")
    : (I18nManager.isRTL ? "row" : "row-reverse");
  const batteryLevel = session.glasses.connected ? (session.glasses.battery?.level ?? 80) : 80;
  const batteryIconName = !isConnected
    ? "battery-dead"
    : batteryLevel > 50
      ? "battery-full"
      : batteryLevel > 15
        ? "battery-half"
        : "battery-dead";

  // Determine text copy and states based on connection/listening
  const statusLabel = isConnected
    ? homeUi.statusConnected[lang]
    : homeUi.statusDisconnected[lang];

  const statusA11yLabel = isConnected
    ? `${homeUi.a11yConnected[lang]}${batteryLevel}${homeUi.percent[lang]}`
    : homeUi.a11yDisconnected[lang];

  const isListeningActive = listeningState === "active" || listeningState === "processing";
  const talkText =
    listeningState === "active"
      ? homeUi.listening[lang]
      : listeningState === "processing"
        ? homeUi.processing[lang]
        : homeUi.tapToTalk[lang];

  const talkA11yLabel =
    listeningState === "active"
      ? `${homeUi.listening[lang]}. زر. ينصت الآن.`
      : listeningState === "processing"
        ? `${homeUi.processing[lang]}. زر. يعالج الأوامر.`
        : `${homeUi.tapToTalk[lang]}. زر. اضغط مرتين للبدء.`;

  return (
    <Screen scroll={false} edges={[]} contentStyle={styles.screenContent}>
      <View style={styles.container}>
        {!isConnected ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", width: "100%" }}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleConnectionPress}
              style={styles.connectContainer}
              accessibilityRole="button"
              accessibilityLabel={lang === "ar" ? "اتصال بالنظارة" : "CONNECT GLASSES"}
            >
              <View style={styles.connectCircle}>
                <Ionicons name="bluetooth" size={80} color={theme.colors.accentText} />
              </View>
              <Text style={styles.connectText}>
                {(lang === "ar" ? "اتصال بالنظارة" : "CONNECT GLASSES").toUpperCase()}
              </Text>
            </TouchableOpacity>

            {/* Scan results (fallback list if they need to pair manually) */}
            {session.scan.devices.length > 0 && (
              <View style={[styles.devicesList, { width: "100%", marginTop: 32 }]}>
                <SectionHeader title={isRTL ? "الأجهزة المكتشفة" : "Found Devices"} />
                {session.scan.devices.map((d) => (
                  <AppButton
                    key={d.id}
                    variant="secondary"
                    iconName="glasses-outline"
                    label={d.name}
                    onPress={() => session.connect(d, { saveAsDefault: true })}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <>
            {/* 1. Connection Status Card */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleConnectionPress}
              style={[
                styles.statusCard,
                isConnected ? styles.statusCardConnected : styles.statusCardDisconnected,
              ]}
              accessibilityRole="button"
              accessibilityLabel={statusA11yLabel}
              accessibilityHint={isConnected ? homeUi.disconnectHint[lang] : homeUi.reconnectHint[lang]}
            >
              <View style={[styles.statusRow, { flexDirection: isRTL ? (I18nManager.isRTL ? "row" : "row-reverse") : (I18nManager.isRTL ? "row-reverse" : "row") }]}>
                {/* Left Column: Device Status & Name */}
                <View style={[styles.statusLeftCol, { alignItems: isRTL ? "flex-end" : "flex-start" }]}>
                  <Text style={[styles.deviceStatusText, textAlignStyle, { alignSelf: "stretch" }]}>
                    {lang === "ar" ? "حالة\nالجهاز" : "DEVICE\nSTATUS"}
                  </Text>
                  <Text style={[styles.deviceNameText, textAlignStyle, { alignSelf: "stretch" }]}>
                    {lang === "ar" ? "نظارات منترا" : "Mentra Glasses"}
                  </Text>
                </View>

                {/* Right Column: Battery & Connection State */}
                <View style={[styles.statusRightCol, { alignItems: isRTL ? "flex-start" : "flex-end" }]}>
                  <View style={[styles.batteryRow, { flexDirection: innerRowDirection, alignItems: "center", gap: 8 }]}>
                    <Text style={styles.batteryPercentText}>
                      {isConnected ? `${batteryLevel}%` : "0%"}
                    </Text>
                    <Ionicons name={batteryIconName} size={28} color={theme.colors.textPrimary} style={styles.batteryIcon} />
                  </View>

                  <View style={[styles.connectionStateRow, { flexDirection: innerRowDirection, alignItems: "center", gap: 8 }]}>
                    <Text style={styles.connectionStateText}>
                      {isConnected
                        ? (lang === "ar" ? "متصل" : "CONNECTED")
                        : (lang === "ar" ? "غير متصل" : "DISCONNECTED")}
                    </Text>
                    <Ionicons
                      name={isConnected ? "square" : "square-outline"}
                      size={18}
                      color={theme.colors.textPrimary}
                      style={styles.stateIcon}
                    />
                  </View>
                </View>
              </View>
              {session.busy && <ActivityIndicator color={theme.colors.textPrimary} style={styles.spinner} />}
            </TouchableOpacity>

            {/* 2. Center Voice Activation Button Card */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleTalkPress}
              style={[
                styles.centerButton,
                isListeningActive ? styles.centerButtonActive : styles.centerButtonInactive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={talkA11yLabel}
              accessibilityHint={homeUi.talkHint[lang]}
            >
              <Ionicons
                name={listeningState === "processing" ? "sync-outline" : isListeningActive ? "mic" : "mic"}
                size={80}
                color={isListeningActive ? theme.colors.onDangerFill : theme.colors.accentText}
              />
              <Text style={[styles.centerButtonText, { color: isListeningActive ? theme.colors.onDangerFill : theme.colors.accentText }]}>
                {talkText.toUpperCase()}
              </Text>
            </TouchableOpacity>

            {/* 3. Repeat Response Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleRepeatPress}
              style={styles.repeatButton}
              accessibilityRole="button"
              accessibilityLabel={homeUi.repeatLast[lang]}
              accessibilityHint={homeUi.repeatHint[lang]}
            >
              <View style={[styles.repeatRow, { flexDirection: isRTL ? (I18nManager.isRTL ? "row" : "row-reverse") : (I18nManager.isRTL ? "row-reverse" : "row") }]}>
                <Ionicons name="refresh-outline" size={28} color={theme.colors.textPrimary} />
                <Text
                  style={[styles.repeatButtonText, textAlignStyle]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  {(lang === "ar" ? "إعادة سماع آخر رد" : "REPEAT LAST RESPONSE").toUpperCase()}
                </Text>
              </View>
            </TouchableOpacity>
          </>
        )}
        {/* Dev toggle state button */}
        <TouchableOpacity
          style={styles.debugToggle}
          onPress={() => setDebugConnectedOverride(prev => prev === null ? !isConnected : !prev)}
          accessibilityLabel="Toggle connection state override"
        >
          <Ionicons name="construct-outline" size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    screenContent: {
      padding: 0,
      backgroundColor: t.colors.bg,
    },
    container: {
      flex: 1,
      paddingHorizontal: 24, // Matches reference picture spacing
      paddingTop: 24,
      paddingBottom: 0,
      justifyContent: "center",
      gap: 40,
      backgroundColor: t.colors.bg,
    },
    statusCard: {
      width: "100%",
      borderWidth: 2,
      borderColor: t.colors.border,
      borderRadius: 0, // Sharp corners
      paddingHorizontal: 20,
      paddingVertical: 20,
      backgroundColor: t.colors.surface,
    },
    statusCardDisconnected: {},
    statusCardConnected: {},
    statusRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    statusLeftCol: {
      gap: 14,
    },
    deviceStatusText: {
      color: t.colors.textPrimary,
      fontSize: 22,
      fontWeight: "800",
      lineHeight: 26,
      textAlign: "left",
    },
    deviceNameText: {
      color: t.colors.textPrimary,
      fontSize: 16,
      fontWeight: "400",
      textAlign: "left",
    },
    statusRightCol: {
      alignItems: "flex-end",
      gap: 16,
    },
    batteryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    batteryPercentText: {
      color: t.colors.textPrimary,
      fontSize: 20,
      fontWeight: "700",
    },
    batteryIcon: {
      transform: [{ rotate: "-90deg" }],
    },
    connectionStateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    stateIcon: {
      marginTop: 2,
    },
    connectionStateText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    connectContainer: {
      alignItems: "center",
      justifyContent: "center",
      gap: 32,
      width: "100%",
    },
    connectCircle: {
      width: 240,
      height: 240,
      borderRadius: 120,
      backgroundColor: t.colors.accent,
      justifyContent: "center",
      alignItems: "center",
    },
    connectText: {
      color: t.colors.textPrimary,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 0.5,
      textAlign: "center",
    },
    devicesList: {
      gap: t.spacing.xs,
      backgroundColor: t.colors.surface,
      padding: t.spacing.md,
      borderRadius: t.radii.md,
    },
    centerButton: {
      width: 240,
      height: 240,
      borderRadius: 120,
      backgroundColor: t.colors.accent,
      justifyContent: "center",
      alignItems: "center",
      alignSelf: "center",
      gap: 12,
    },
    centerButtonActive: {
      backgroundColor: t.colors.dangerFill, // pulsing danger state matching palette
    },
    centerButtonInactive: {},
    centerButtonText: {
      color: t.colors.bg,
      fontSize: 14,
      fontWeight: "800",
      textAlign: "center",
      letterSpacing: 0.5,
    },
    repeatButton: {
      height: 88,
      borderWidth: 2,
      borderColor: t.colors.border,
      borderRadius: 0, // Sharp corners
      paddingHorizontal: 20,
      justifyContent: "center",
      alignItems: "center",
      width: "100%",
      backgroundColor: t.colors.surface,
    },
    repeatRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    repeatButtonText: {
      color: t.colors.textPrimary,
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    spinner: {
      marginLeft: t.spacing.xs,
    },
    row: {
      flexDirection: "row",
    },
    rowReverse: {
      flexDirection: "row-reverse",
    },
    textRight: {
      textAlign: "right",
    },
    textLeft: {
      textAlign: "left",
    },
    debugToggle: {
      position: "absolute",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      justifyContent: "center",
      alignItems: "center",
    },
  }),
);
