import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { listFaces, type EnrolledFace } from "../relay/faces";
import { useSettings } from "../state/settings";
import { Logger } from "../utils/logger";

const logger = new Logger("Contacts");

export default function ContactsScreen() {
  const language = useSettings((s) => s.language);
  const [faces, setFaces] = useState<EnrolledFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFaces();
      setFaces(result.faces);
    } catch (err) {
      logger.error("listFaces failed", err);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const labels = language === "ar"
    ? { empty: "ما فيه أشخاص محفوظين بعد. اطلب من سهيل: «سجل هذا الشخص».", retry: "أعد المحاولة" }
    : { empty: "No contacts saved yet. Tell Suhail: \"enroll this person\".", retry: "Retry" };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {loading && faces.length === 0 ? (
        <ActivityIndicator color="#38BDF8" style={{ marginTop: 32 }} />
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={refresh}>
            <Text style={styles.retryText}>{labels.retry}</Text>
          </Pressable>
        </View>
      ) : faces.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{labels.empty}</Text>
        </View>
      ) : (
        <FlatList
          data={faces}
          keyExtractor={(item) => item.faceId}
          contentContainerStyle={{ padding: 16 }}
          refreshing={loading}
          onRefresh={refresh}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              {item.enrolledAt && (
                <Text style={styles.sub}>{new Date(item.enrolledAt).toLocaleDateString()}</Text>
              )}
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
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: "#94A3B8", textAlign: "center", fontSize: 15 },
  errorText: { color: "#F87171", textAlign: "center", fontSize: 14, marginBottom: 12 },
  retryBtn: { backgroundColor: "#0284C7", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryText: { color: "#F8FAFC", fontWeight: "600" },
  row: { paddingVertical: 14, paddingHorizontal: 4 },
  name: { color: "#F8FAFC", fontSize: 17, fontWeight: "600" },
  sub: { color: "#64748B", fontSize: 12, marginTop: 2 },
  sep: { height: 1, backgroundColor: "#1E293B" },
});
