import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { AppButton } from "../components";
import { makeStyles, useTheme } from "../theme";
import { ui, uiFn, useUi } from "../i18n/ui";
import { deleteFace, facePhotoUrl, listFaces, renameFace, type EnrolledFace } from "../relay/faces";
import { Logger } from "../utils/logger";

const logger = new Logger("Contacts");

/**
 * Which transient overlay is open over the grid. Only ever one at a time — they
 * share a single <Modal> so iOS never has to juggle stacked modals (the classic
 * dismiss-then-present race). `selected` is the contact all three act on.
 */
type Overlay = "detail" | "photo" | "rename" | null;

export default function ContactsScreen(): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();

  const [faces, setFaces] = useState<EnrolledFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** faceId currently being renamed/deleted — shows a busy overlay on its card. */
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  /** Contact the open overlay acts on (null = nothing selected). */
  const [selected, setSelected] = useState<EnrolledFace | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
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

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setSelected(null);
  }, []);

  const openDetail = useCallback((face: EnrolledFace) => {
    setSelected(face);
    setOverlay("detail");
  }, []);

  /** Android hardware-back: photo viewer steps back to the detail sheet; else close. */
  const handleRequestClose = useCallback(() => {
    if (overlay === "photo") setOverlay("detail");
    else closeOverlay();
  }, [overlay, closeOverlay]);

  const requestRename = useCallback(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setOverlay("rename");
  }, [selected]);

  const saveRename = useCallback(async () => {
    const target = selected;
    if (!target) return;
    const next = draftName.trim();
    if (next.length < 2 || next === target.name) {
      closeOverlay();
      return;
    }
    const faceId = target.faceId;
    closeOverlay();
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
  }, [selected, draftName, refresh, t, closeOverlay]);

  const requestDelete = useCallback(() => {
    const target = selected;
    if (!target) return;
    // Dismiss the sheet first, then confirm — keeps the Alert above a clean screen.
    closeOverlay();
    Alert.alert(t(ui.contacts.deleteTitle), uiFn.deleteMsg[lang](target.name), [
      { text: t(ui.contacts.cancel), style: "cancel" },
      {
        text: t(ui.contacts.delete),
        style: "destructive",
        onPress: async () => {
          setMutatingId(target.faceId);
          setFaces((prev) => prev.filter((f) => f.faceId !== target.faceId)); // optimistic
          try {
            await deleteFace(target.faceId);
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
  }, [selected, refresh, t, lang, closeOverlay]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {loading && faces.length === 0 ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: theme.spacing.xxl }} />
      ) : error && faces.length === 0 ? (
        // Only show the full-screen error when there's nothing to show. A failed
        // pull-to-refresh while contacts are already loaded keeps the grid
        // (the spinner just clears) instead of blanking it on a transient blip.
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
          numColumns={2}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={refresh}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <ContactCard face={item} busy={mutatingId === item.faceId} onPress={() => openDetail(item)} />
            </View>
          )}
        />
      )}

      <Modal
        visible={overlay !== null}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={handleRequestClose}
      >
        {overlay === "photo" && selected ? (
          <PhotoViewer face={selected} onClose={() => setOverlay("detail")} />
        ) : overlay === "detail" && selected ? (
          <ContactDetailSheet
            face={selected}
            onClose={closeOverlay}
            onViewPhoto={() => setOverlay("photo")}
            onRename={requestRename}
            onDelete={requestDelete}
          />
        ) : overlay === "rename" && selected ? (
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
                <AppButton variant="ghost" label={t(ui.contacts.cancel)} onPress={closeOverlay} fullWidth={false} />
                <AppButton label={t(ui.contacts.save)} onPress={saveRename} disabled={draftName.trim().length < 2} fullWidth={false} />
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

/** One grid cell: a tappable card with a large square photo and the name below. */
function ContactCard({
  face,
  busy,
  onPress,
}: {
  face: EnrolledFace;
  busy: boolean;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useUi();
  const [imgFailed, setImgFailed] = useState(false);
  const initial = face.name.trim().charAt(0).toUpperCase() || "?";
  const showPhoto = face.hasPhoto && !imgFailed;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={face.name}
      accessibilityHint={t(ui.contacts.cardHint)}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardPhotoWrap}>
        {showPhoto ? (
          <Image
            source={{ uri: facePhotoUrl(face.faceId) }}
            style={styles.cardPhoto}
            onError={() => setImgFailed(true)}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : (
          <View style={[styles.cardPhoto, styles.avatarPlaceholder]} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={styles.cardInitial}>{initial}</Text>
          </View>
        )}
        {busy ? (
          <View style={styles.cardBusy}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : null}
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {face.name}
      </Text>
    </Pressable>
  );
}

/** Bottom-anchored detail sheet: big (tappable) photo, name, date, rename/delete. */
function ContactDetailSheet({
  face,
  onClose,
  onViewPhoto,
  onRename,
  onDelete,
}: {
  face: EnrolledFace;
  onClose: () => void;
  onViewPhoto: () => void;
  onRename: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, lang } = useUi();
  const insets = useSafeAreaInsets();
  const [imgFailed, setImgFailed] = useState(false);
  const initial = face.name.trim().charAt(0).toUpperCase() || "?";
  const showPhoto = face.hasPhoto && !imgFailed;
  const dateStr = face.enrolledAt ? new Date(face.enrolledAt).toLocaleDateString() : null;

  return (
    <View style={styles.sheetRoot}>
      <Pressable
        style={styles.sheetBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t(ui.contacts.close)}
      />
      <View style={[styles.sheetCard, { paddingBottom: insets.bottom + theme.spacing.xl }]} accessibilityViewIsModal>
        <Pressable
          style={styles.sheetClose}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t(ui.contacts.close)}
          hitSlop={theme.hitSlop}
        >
          <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
        </Pressable>

        {showPhoto ? (
          <Pressable
            style={styles.sheetPhotoWrap}
            onPress={onViewPhoto}
            accessibilityRole="button"
            accessibilityLabel={t(ui.contacts.viewPhoto)}
          >
            <Image
              source={{ uri: facePhotoUrl(face.faceId) }}
              style={styles.sheetPhoto}
              onError={() => setImgFailed(true)}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        ) : (
          <View style={[styles.sheetPhotoWrap, styles.avatarPlaceholder]} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={styles.sheetInitial}>{initial}</Text>
          </View>
        )}

        <Text style={styles.sheetName} accessibilityRole="header" numberOfLines={2}>
          {face.name}
        </Text>
        {dateStr ? <Text style={styles.sheetSub}>{uiFn.enrolledOn[lang](dateStr)}</Text> : null}

        <View style={styles.sheetActions}>
          <View style={styles.actionBtn}>
            <AppButton iconName="pencil" label={t(ui.contacts.rename)} onPress={onRename} />
          </View>
          <View style={styles.actionBtn}>
            <AppButton iconName="trash-outline" variant="danger" label={t(ui.contacts.delete)} onPress={onDelete} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** Full-screen photo lightbox: contained image on near-black, tap anywhere or X to close. */
function PhotoViewer({ face, onClose }: { face: EnrolledFace; onClose: () => void }): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useUi();
  const insets = useSafeAreaInsets();
  const [imgFailed, setImgFailed] = useState(false);
  const initial = face.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View style={styles.photoRoot}>
      {/* Tap-anywhere-to-dismiss backdrop; the image sits on top but lets touches through. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      {imgFailed ? (
        <Text style={styles.photoInitial}>{initial}</Text>
      ) : (
        // pointerEvents="none" on the wrapper lets taps fall through to the backdrop.
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: facePhotoUrl(face.faceId) }}
            style={styles.fullPhoto}
            resizeMode="contain"
            onError={() => setImgFailed(true)}
            accessibilityRole="image"
            accessibilityLabel={face.name}
          />
        </View>
      )}
      <Pressable
        style={[styles.photoClose, { top: insets.top + theme.spacing.md }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t(ui.contacts.close)}
        hitSlop={theme.hitSlop}
      >
        <Ionicons name="close" size={28} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const createStyles = makeStyles((t) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.colors.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: t.spacing.xl, gap: t.spacing.md },
    emptyText: { color: t.colors.textSecondary, textAlign: "center", fontSize: t.type.body.fontSize, lineHeight: t.type.body.lineHeight },
    errorText: { color: t.colors.dangerText, textAlign: "center", fontSize: t.type.body.fontSize },

    // Grid
    listContent: { padding: t.spacing.sm },
    cell: { width: "50%", padding: t.spacing.sm },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.lg,
      borderWidth: t.borderWidth,
      borderColor: t.colors.border,
      padding: t.spacing.md,
      gap: t.spacing.sm,
      alignItems: "center",
    },
    pressed: { opacity: 0.85 },
    cardPhotoWrap: { width: "100%", aspectRatio: 1, borderRadius: t.radii.md, overflow: "hidden", backgroundColor: t.colors.surfaceAlt },
    cardPhoto: { width: "100%", height: "100%" },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    cardInitial: { color: t.colors.textSecondary, fontSize: t.type.display.fontSize, fontWeight: "700" },
    cardBusy: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.overlay },
    cardName: { color: t.colors.textPrimary, fontSize: t.type.body.fontSize, fontWeight: "600", textAlign: "center" },

    // Detail sheet
    sheetRoot: { flex: 1, justifyContent: "flex-end" },
    sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: t.colors.overlay },
    sheetCard: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: t.radii.lg,
      borderTopRightRadius: t.radii.lg,
      borderWidth: t.borderWidth,
      borderColor: t.colors.borderStrong,
      paddingHorizontal: t.spacing.xl,
      paddingTop: t.spacing.xl,
      gap: t.spacing.md,
      alignItems: "center",
    },
    sheetClose: { position: "absolute", top: t.spacing.md, end: t.spacing.md, width: t.minTouch, height: t.minTouch, alignItems: "center", justifyContent: "center", zIndex: 1 },
    sheetPhotoWrap: { width: "62%", aspectRatio: 1, borderRadius: t.radii.lg, overflow: "hidden", backgroundColor: t.colors.surfaceAlt, marginTop: t.spacing.sm },
    sheetPhoto: { width: "100%", height: "100%" },
    sheetInitial: { color: t.colors.textSecondary, fontSize: Math.round(t.type.display.fontSize * 1.5), fontWeight: "700" },
    sheetName: { color: t.colors.textPrimary, fontSize: t.type.title.fontSize, lineHeight: t.type.title.lineHeight, fontWeight: t.type.title.fontWeight, textAlign: "center" },
    sheetSub: { color: t.colors.textMuted, fontSize: t.type.caption.fontSize, textAlign: "center" },
    sheetActions: { flexDirection: "row", gap: t.spacing.md, alignSelf: "stretch", marginTop: t.spacing.sm },
    actionBtn: { flex: 1 },

    // Full-screen photo viewer (media lightbox — fixed near-black, not themed)
    photoRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
    fullPhoto: { width: "100%", height: "100%" },
    photoInitial: { color: "#FFFFFF", fontSize: 72, fontWeight: "700" },
    photoClose: { position: "absolute", end: t.spacing.lg, width: t.minTouch, height: t.minTouch, borderRadius: t.radii.pill, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },

    // Rename modal
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
    modalTitle: { color: t.colors.textPrimary, fontSize: t.type.title.fontSize, fontWeight: t.type.title.fontWeight, textAlign: "center" },
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
