import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppButton } from "../components";
import { makeStyles, useTheme } from "../theme";
import { ui, uiFn, useUi } from "../i18n/ui";
import type { Language } from "../i18n/messages";
import { deleteFace, facePhotoUrl, listFaces, renameFace, type EnrolledFace } from "../relay/faces";
import { Logger } from "../utils/logger";

const logger = new Logger("Contacts");

export default function ContactsScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();

  const [faces, setFaces] = useState<EnrolledFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** faceId currently being renamed/deleted — disables its row actions. */
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  /** Open rename modal target (null = closed). */
  const [editing, setEditing] = useState<EnrolledFace | null>(null);
  const [draftName, setDraftName] = useState("");

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
      Alert.alert(t(ui.contacts.renameTitle), t(ui.contacts.failed));
      await refresh();
    } finally {
      setMutatingId(null);
    }
  }, [editing, draftName, refresh, t]);

  const confirmDelete = useCallback(
    (face: EnrolledFace) => {
      Alert.alert(t(ui.contacts.deleteTitle), uiFn.deleteMsg[lang](face.name), [
        { text: t(ui.contacts.cancel), style: "cancel" },
        {
          text: t(ui.contacts.delete),
          style: "destructive",
          onPress: async () => {
            setMutatingId(face.faceId);
            setFaces((prev) => prev.filter((f) => f.faceId !== face.faceId)); // optimistic
            try {
              await deleteFace(face.faceId);
              await refresh();
            } catch (err) {
              logger.error("deleteFace failed", err);
              Alert.alert(t(ui.contacts.deleteTitle), t(ui.contacts.failed));
              await refresh();
            } finally {
              setMutatingId(null);
            }
          },
        },
      ]);
    },
    [refresh, t, lang],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {loading && faces.length === 0 ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: theme.spacing.xxl }} />
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={theme.colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <AppButton iconName="refresh" label={t(ui.contacts.retry)} onPress={refresh} fullWidth={false} />
        </View>
      ) : faces.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={56} color={theme.colors.textMuted} />
          <Text style={styles.emptyText}>{t(ui.contacts.empty)}</Text>
        </View>
      ) : (
        <FlatList
          data={faces}
          keyExtractor={(item) => item.faceId}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={refresh}
          renderItem={({ item }) => (
            <ContactRow
              face={item}
              busy={mutatingId === item.faceId}
              lang={lang}
              onRename={() => openRename(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {t(ui.contacts.renameTitle)}
            </Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder={t(ui.contacts.namePlaceholder)}
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel={t(ui.contacts.namePlaceholder)}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={saveRename}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <AppButton variant="ghost" label={t(ui.contacts.cancel)} onPress={() => setEditing(null)} fullWidth={false} />
              <AppButton label={t(ui.contacts.save)} onPress={saveRename} disabled={draftName.trim().length < 2} fullWidth={false} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ContactRow({
  face,
  busy,
  lang,
  onRename,
  onDelete,
}: {
  face: EnrolledFace;
  busy: boolean;
  lang: Language;
  onRename: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [imgFailed, setImgFailed] = useState(false);
  const initial = face.name.trim().charAt(0).toUpperCase() || "?";
  const showPhoto = face.hasPhoto && !imgFailed;

  return (
    <View style={styles.row}>
      {showPhoto ? (
        <Image
          source={{ uri: facePhotoUrl(face.faceId) }}
          style={styles.avatar}
          onError={() => setImgFailed(true)}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]} accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}

      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {face.name}
        </Text>
        {face.enrolledAt ? <Text style={styles.sub}>{new Date(face.enrolledAt).toLocaleDateString()}</Text> : null}
      </View>

      {busy ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.rowBusy} />
      ) : (
        <View style={styles.rowActions}>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            onPress={onRename}
            accessibilityRole="button"
            accessibilityLabel={uiFn.renameA11y[lang](face.name)}
          >
            <Ionicons name="pencil" size={20} color={theme.colors.accent} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.iconBtn, styles.iconBtnDanger, pressed && styles.pressed]}
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={uiFn.deleteA11y[lang](face.name)}
          >
            <Ionicons name="trash-outline" size={20} color={theme.colors.dangerText} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: t.spacing.xl, gap: t.spacing.md },
    emptyText: { color: t.colors.textSecondary, textAlign: "center", fontSize: t.type.body.fontSize, lineHeight: t.type.body.lineHeight },
    errorText: { color: t.colors.dangerText, textAlign: "center", fontSize: t.type.body.fontSize },
    listContent: { padding: t.spacing.lg },
    row: { flexDirection: "row", alignItems: "center", paddingVertical: t.spacing.md, gap: t.spacing.md },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.surfaceAlt },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: t.colors.textSecondary, fontSize: t.type.title.fontSize, fontWeight: "700" },
    rowBody: { flex: 1, gap: 2 },
    name: { color: t.colors.textPrimary, fontSize: t.type.body.fontSize, fontWeight: "600" },
    sub: { color: t.colors.textMuted, fontSize: t.type.caption.fontSize },
    rowBusy: { width: t.minTouch * 2 },
    rowActions: { flexDirection: "row", gap: t.spacing.sm },
    iconBtn: {
      width: t.minTouch,
      height: t.minTouch,
      borderRadius: t.radii.md,
      backgroundColor: t.colors.surfaceAlt,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnDanger: { borderColor: t.colors.danger },
    pressed: { opacity: 0.8 },
    sep: { height: t.borderWidth, backgroundColor: t.colors.border },
    modalBackdrop: { flex: 1, backgroundColor: t.colors.overlay, alignItems: "center", justifyContent: "center", padding: t.spacing.xl },
    modalCard: {
      width: "100%",
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.lg,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      padding: t.spacing.xl,
      gap: t.spacing.lg,
    },
    modalTitle: { color: t.colors.textPrimary, fontSize: t.type.title.fontSize, fontWeight: t.type.title.fontWeight },
    input: {
      backgroundColor: t.colors.bg,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      borderRadius: t.radii.md,
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.md,
      color: t.colors.textPrimary,
      fontSize: t.type.body.fontSize,
      minHeight: t.minTouch,
    },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: t.spacing.sm },
  }),
);
