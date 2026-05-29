import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deleteFace, facePhotoUrl, listFaces, renameFace, type EnrolledFace } from "../relay/faces";
import { useSettings } from "../state/settings";
import { Logger } from "../utils/logger";

const logger = new Logger("Contacts");

export default function ContactsScreen() {
  const language = useSettings((s) => s.language);
  const [faces, setFaces] = useState<EnrolledFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** faceId currently being renamed/deleted — disables its row actions. */
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  /** Open rename modal target (null = closed). */
  const [editing, setEditing] = useState<EnrolledFace | null>(null);
  const [draftName, setDraftName] = useState("");

  const labels = language === "ar"
    ? {
        empty: "ما فيه أشخاص محفوظين بعد. اطلب من سهيل: «سجل هذا الشخص».",
        retry: "أعد المحاولة",
        rename: "إعادة تسمية",
        delete: "حذف",
        save: "حفظ",
        cancel: "إلغاء",
        renameTitle: "إعادة التسمية",
        namePlaceholder: "الاسم",
        deleteTitle: "حذف الشخص",
        deleteMsg: (n: string) => `حذف «${n}»؟ لا يمكن التراجع.`,
        failed: "فشلت العملية. حاول مرة ثانية.",
      }
    : {
        empty: "No contacts saved yet. Tell Suhail: \"enroll this person\".",
        retry: "Retry",
        rename: "Rename",
        delete: "Delete",
        save: "Save",
        cancel: "Cancel",
        renameTitle: "Rename contact",
        namePlaceholder: "Name",
        deleteTitle: "Delete contact",
        deleteMsg: (n: string) => `Delete "${n}"? This can't be undone.`,
        failed: "That didn't work. Please try again.",
      };

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

  const openRename = useCallback((face: EnrolledFace) => {
    setEditing(face);
    setDraftName(face.name);
  }, []);

  const saveRename = useCallback(async () => {
    if (!editing) return;
    const next = draftName.trim();
    if (next.length < 2 || next === editing.name) {
      setEditing(null);
      return;
    }
    const faceId = editing.faceId;
    setEditing(null);
    setMutatingId(faceId);
    // Optimistic — reflect the new name immediately, reconcile via refresh.
    setFaces((prev) => prev.map((f) => (f.faceId === faceId ? { ...f, name: next } : f)));
    try {
      await renameFace(faceId, next);
      await refresh();
    } catch (err) {
      logger.error("renameFace failed", err);
      Alert.alert(labels.renameTitle, labels.failed);
      await refresh();
    } finally {
      setMutatingId(null);
    }
  }, [editing, draftName, refresh, labels.renameTitle, labels.failed]);

  const confirmDelete = useCallback((face: EnrolledFace) => {
    Alert.alert(labels.deleteTitle, labels.deleteMsg(face.name), [
      { text: labels.cancel, style: "cancel" },
      {
        text: labels.delete,
        style: "destructive",
        onPress: async () => {
          setMutatingId(face.faceId);
          setFaces((prev) => prev.filter((f) => f.faceId !== face.faceId)); // optimistic
          try {
            await deleteFace(face.faceId);
            await refresh();
          } catch (err) {
            logger.error("deleteFace failed", err);
            Alert.alert(labels.deleteTitle, labels.failed);
            await refresh();
          } finally {
            setMutatingId(null);
          }
        },
      },
    ]);
  }, [refresh, labels]);

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
            <ContactRow
              face={item}
              busy={mutatingId === item.faceId}
              labels={labels}
              onRename={() => openRename(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{labels.renameTitle}</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder={labels.namePlaceholder}
              placeholderTextColor="#64748B"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={saveRename}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setEditing(null)}>
                <Text style={styles.modalBtnGhostText}>{labels.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, draftName.trim().length < 2 && styles.modalBtnDisabled]}
                onPress={saveRename}
                disabled={draftName.trim().length < 2}
              >
                <Text style={styles.modalBtnText}>{labels.save}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type RowLabels = { rename: string; delete: string };

function ContactRow({
  face,
  busy,
  labels,
  onRename,
  onDelete,
}: {
  face: EnrolledFace;
  busy: boolean;
  labels: RowLabels;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = face.name.trim().charAt(0).toUpperCase() || "؟";
  const showPhoto = face.hasPhoto && !imgFailed;

  return (
    <View style={styles.row}>
      {showPhoto ? (
        <Image
          source={{ uri: facePhotoUrl(face.faceId) }}
          style={styles.avatar}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}

      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>{face.name}</Text>
        {face.enrolledAt && (
          <Text style={styles.sub}>{new Date(face.enrolledAt).toLocaleDateString()}</Text>
        )}
      </View>

      {busy ? (
        <ActivityIndicator color="#38BDF8" style={styles.rowBusy} />
      ) : (
        <View style={styles.rowActions}>
          <Pressable style={styles.actionBtn} onPress={onRename} hitSlop={8}>
            <Text style={styles.actionText}>{labels.rename}</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.actionBtnDanger]} onPress={onDelete} hitSlop={8}>
            <Text style={styles.actionTextDanger}>{labels.delete}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: "#94A3B8", textAlign: "center", fontSize: 15 },
  errorText: { color: "#F87171", textAlign: "center", fontSize: 14, marginBottom: 12 },
  retryBtn: { backgroundColor: "#0284C7", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  retryText: { color: "#F8FAFC", fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1E293B" },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#94A3B8", fontSize: 18, fontWeight: "700" },
  rowBody: { flex: 1 },
  name: { color: "#F8FAFC", fontSize: 17, fontWeight: "600" },
  sub: { color: "#64748B", fontSize: 12, marginTop: 2 },
  rowBusy: { width: 96 },
  rowActions: { flexDirection: "row", gap: 8 },
  actionBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#1E293B" },
  actionText: { color: "#38BDF8", fontSize: 13, fontWeight: "600" },
  actionBtnDanger: { backgroundColor: "#3F1D1D" },
  actionTextDanger: { color: "#F87171", fontSize: 13, fontWeight: "600" },
  sep: { height: 1, backgroundColor: "#1E293B" },
  // Rename modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: "#0F172A", borderRadius: 16, borderWidth: 1, borderColor: "#1E293B", padding: 20, gap: 16 },
  modalTitle: { color: "#F8FAFC", fontSize: 18, fontWeight: "700" },
  input: { backgroundColor: "#020617", borderWidth: 1, borderColor: "#334155", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, color: "#F8FAFC", fontSize: 16 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "#0284C7" },
  modalBtnText: { color: "#F8FAFC", fontSize: 15, fontWeight: "600" },
  modalBtnDisabled: { backgroundColor: "#334155", opacity: 0.6 },
  modalBtnGhost: { backgroundColor: "transparent" },
  modalBtnGhostText: { color: "#94A3B8", fontSize: 15, fontWeight: "600" },
});
