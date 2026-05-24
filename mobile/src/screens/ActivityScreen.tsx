import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useActivity, type ActivityType } from "../state/activity";
import { useSettings } from "../state/settings";

const TYPE_COLOR: Record<ActivityType, string> = {
  system: "#94A3B8",
  command: "#38BDF8",
  ble: "#A78BFA",
  error: "#F87171",
};

export default function ActivityScreen() {
  const entries = useActivity((s) => s.entries);
  const language = useSettings((s) => s.language);
  const empty = language === "ar" ? "ما فيه نشاط بعد." : "No activity yet.";

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>{empty}</Text>
        </View>
      ) : (
        <FlatList
          data={[...entries].reverse()}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.tag, { backgroundColor: `${TYPE_COLOR[item.type]}33`, borderColor: TYPE_COLOR[item.type] }]}>
                <Text style={[styles.tagText, { color: TYPE_COLOR[item.type] }]}>{item.type}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.event}>{item.event}</Text>
                {item.result && <Text style={styles.sub}>→ {item.result}</Text>}
                <Text style={styles.time}>{new Date(item.time).toLocaleTimeString()}</Text>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: "#94A3B8" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 12 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  tagText: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  event: { color: "#E2E8F0", fontSize: 14 },
  sub: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  time: { color: "#475569", fontSize: 11, marginTop: 2 },
  sep: { height: 1, backgroundColor: "#1E293B" },
});
