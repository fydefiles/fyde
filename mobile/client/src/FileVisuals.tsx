import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FileCard } from "./types";
import {
  KINDS,
  badgeOf,
  formatDate,
  formatSize,
  kindOf,
  toneIndex,
  type Kind,
} from "./library";
import { Button, C, serif, styles as ui } from "./ui";
import { CloseIcon, StarIcon } from "./Icons";

const PHOTO_TONES = [
  ["#CFE2F5", "#7FA6CF", "#F7D27A"],
  ["#F8DCC8", "#D9895C", "#FFF1B8"],
  ["#D5EBDB", "#6FA883", "#FBE7A1"],
  ["#E5DCF4", "#9179C6", "#FFE2B0"],
  ["#F3E1D1", "#B98A63", "#FFFFFF"],
];
const FOLDER_TONES = [
  ["#8FB4E3", "#6F99D2"],
  ["#EBAA8B", "#DC8D69"],
  ["#93C8A6", "#73B08A"],
  ["#C4A9E3", "#A98BD2"],
  ["#E8C77A", "#D8AF55"],
];

function Lines({ width, color, count }: { width: number; color: string; count: number }) {
  const widths = [0.9, 0.75, 0.86, 0.6, 0.8, 0.5];
  return (
    <View style={{ gap: width * 0.07 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            height: Math.max(1.5, width * 0.05),
            width: width * widths[i % widths.length],
            borderRadius: 2,
            backgroundColor: i === 0 ? color : "#E6E2DA",
          }}
        />
      ))}
    </View>
  );
}

function PageContent({ kind, width, color }: { kind: Kind; width: number; color: string }) {
  if (kind === "sheet")
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: "#CFE6D9",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {[0, 1, 2, 3, 4].map((r) => (
          <View
            key={r}
            style={{
              flexDirection: "row",
              backgroundColor: r === 0 ? "#DCEFE4" : "transparent",
            }}
          >
            {[0, 1, 2].map((c) => (
              <View
                key={c}
                style={{
                  flex: 1,
                  height: width * 0.1,
                  borderRightWidth: c < 2 ? 1 : 0,
                  borderBottomWidth: r < 4 ? 1 : 0,
                  borderColor: "#CFE6D9",
                }}
              />
            ))}
          </View>
        ))}
      </View>
    );
  if (kind === "slides")
    return (
      <View
        style={{
          borderRadius: 3,
          backgroundColor: "#FCEBD5",
          height: width * 0.46,
          padding: width * 0.07,
          justifyContent: "flex-end",
          gap: width * 0.05,
        }}
      >
        <View style={{ height: width * 0.06, width: "70%", backgroundColor: color, borderRadius: 2 }} />
        <View style={{ height: width * 0.04, width: "45%", backgroundColor: "#EBC79A", borderRadius: 2 }} />
      </View>
    );
  if (kind === "archive")
    return (
      <View style={{ alignItems: "center", gap: 1 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              width: width * 0.14,
              height: width * 0.06,
              backgroundColor: i % 2 ? "#D8C3A2" : color,
              marginLeft: i % 2 ? width * 0.1 : 0,
            }}
          />
        ))}
      </View>
    );
  return <Lines width={width * 0.78} color={kind === "pdf" ? "#E7B3AC" : "#C9C3B8"} count={kind === "text" ? 6 : 5} />;
}

export function FileIcon({
  file,
  size = 64,
  bg = C.sunken,
}: {
  file: Pick<FileCard, "name" | "title">;
  size?: number;
  bg?: string;
}) {
  const kind = kindOf(file);
  const color = KINDS[kind].color;
  const badge = badgeOf(file);
  const badgeFont = Math.max(7, size * 0.13);
  if (kind === "image" || kind === "video") {
    const [sky, hill, sun] = PHOTO_TONES[toneIndex(file.title, PHOTO_TONES.length)];
    const w = size * 0.9,
      h = size * 0.7;
    return (
      <View accessible={false} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View
          style={[
            s.shadow,
            {
              width: w,
              height: h,
              borderRadius: size * 0.08,
              backgroundColor: kind === "video" ? "#2B2A33" : sky,
              borderWidth: size > 40 ? 2 : 1,
              borderColor: "#FFFFFF",
              overflow: "hidden",
            },
          ]}
        >
          {kind === "image" ? (
            <>
              <View
                style={{
                  position: "absolute",
                  right: w * 0.16,
                  top: h * 0.16,
                  width: w * 0.16,
                  height: w * 0.16,
                  borderRadius: w,
                  backgroundColor: sun,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: -w * 0.1,
                  bottom: 0,
                  width: 0,
                  height: 0,
                  borderLeftWidth: w * 0.42,
                  borderRightWidth: w * 0.42,
                  borderBottomWidth: h * 0.62,
                  borderLeftColor: "transparent",
                  borderRightColor: "transparent",
                  borderBottomColor: hill,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  right: -w * 0.18,
                  bottom: 0,
                  width: 0,
                  height: 0,
                  borderLeftWidth: w * 0.4,
                  borderRightWidth: w * 0.4,
                  borderBottomWidth: h * 0.44,
                  borderLeftColor: "transparent",
                  borderRightColor: "transparent",
                  borderBottomColor: hill,
                  opacity: 0.75,
                }}
              />
            </>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <View
                style={{
                  width: 0,
                  height: 0,
                  marginLeft: w * 0.05,
                  borderTopWidth: h * 0.16,
                  borderBottomWidth: h * 0.16,
                  borderLeftWidth: h * 0.26,
                  borderTopColor: "transparent",
                  borderBottomColor: "transparent",
                  borderLeftColor: "#FFFFFF",
                }}
              />
            </View>
          )}
        </View>
        {size >= 40 && (
          <View style={[s.badge, { backgroundColor: color, left: size * 0.02, bottom: size * 0.1, paddingHorizontal: size * 0.05 }]}>
            <Text style={[s.badgeText, { fontSize: badgeFont }]}>{badge}</Text>
          </View>
        )}
      </View>
    );
  }
  const w = size * 0.72,
    h = size * 0.9,
    fold = size * 0.2;
  return (
    <View accessible={false} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={[
          s.shadow,
          {
            width: w,
            height: h,
            backgroundColor: "#FFFFFF",
            borderRadius: size * 0.07,
            paddingHorizontal: w * 0.14,
            paddingTop: fold + size * 0.04,
          },
        ]}
      >
        <PageContent kind={kind} width={w * 0.72} color={color} />
        <View
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 0,
            height: 0,
            borderTopWidth: fold,
            borderLeftWidth: fold,
            borderTopColor: bg,
            borderLeftColor: "transparent",
          }}
        />
        <View
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 0,
            height: 0,
            borderBottomWidth: fold,
            borderRightWidth: fold,
            borderBottomColor: "#E4DFD6",
            borderRightColor: "transparent",
            borderBottomLeftRadius: size * 0.03,
          }}
        />
      </View>
      {size >= 32 && (
        <View
          style={[
            s.badge,
            {
              backgroundColor: color,
              left: size * 0.06,
              bottom: size * 0.12,
              paddingHorizontal: size * 0.05,
            },
          ]}
        >
          <Text style={[s.badgeText, { fontSize: badgeFont }]}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

export function FolderIcon({ seed, size = 64 }: { seed: string; size?: number }) {
  const [front, back] = FOLDER_TONES[toneIndex(seed, FOLDER_TONES.length)];
  return (
    <View accessible={false} style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View style={{ width: size * 0.9, height: size * 0.7 }}>
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: size * 0.38,
            height: size * 0.2,
            borderTopLeftRadius: size * 0.07,
            borderTopRightRadius: size * 0.07,
            backgroundColor: back,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: size * 0.08,
            bottom: 0,
            borderRadius: size * 0.08,
            backgroundColor: back,
          }}
        />
        <View
          style={[
            s.shadow,
            {
              position: "absolute",
              left: 0,
              right: 0,
              top: size * 0.17,
              bottom: 0,
              borderRadius: size * 0.08,
              backgroundColor: front,
            },
          ]}
        />
      </View>
    </View>
  );
}

export function fileMeta(file: FileCard, withDate = true) {
  return [
    withDate ? formatDate(file.modified_at) : "",
    formatSize(file.size),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FileTile({
  file,
  width,
  starred,
  onPress,
  caption,
}: {
  file: FileCard;
  width: number;
  starred?: boolean;
  onPress: () => void;
  caption?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file.title}, ${KINDS[kindOf(file)].label}`}
      onPress={onPress}
      onLongPress={onPress}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[s.tileArt, { height: width * 0.86 }]}>
        <FileIcon file={file} size={width * 0.62} />
        {starred && (
          <View style={s.tileStar}>
            <StarIcon size={13} filled color={C.accent} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={s.tileName}>
        {file.title}
      </Text>
      <Text numberOfLines={1} style={s.tileMeta}>
        {caption ?? fileMeta(file)}
      </Text>
    </Pressable>
  );
}

export function FolderTile({
  name,
  count,
  width,
  onPress,
}: {
  name: string;
  count: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} case, ${count} files`}
      onPress={onPress}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[s.tileArt, { height: width * 0.86, backgroundColor: "transparent" }]}>
        <FolderIcon seed={name} size={width * 0.78} />
      </View>
      <Text numberOfLines={2} style={s.tileName}>
        {name}
      </Text>
      <Text style={s.tileMeta}>
        {count} {count === 1 ? "file" : "files"}
      </Text>
    </Pressable>
  );
}

export function FileRow({
  file,
  starred,
  onPress,
  caption,
}: {
  file: FileCard;
  starred?: boolean;
  onPress: () => void;
  caption?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={file.title}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: C.sunken }]}
    >
      <View style={s.rowArt}>
        <FileIcon file={file} size={38} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={s.rowName}>
          {file.title}
        </Text>
        <Text numberOfLines={1} style={s.tileMeta}>
          {caption ??
            [KINDS[kindOf(file)].label, fileMeta(file), file.matter]
              .filter(Boolean)
              .join(" · ")}
        </Text>
      </View>
      {starred && <StarIcon size={15} filled color={C.accent} />}
    </Pressable>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <Pressable
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.grabber} />
          {!!title && (
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={s.closeButton}
              >
                <CloseIcon size={14} color={C.muted} />
              </Pressable>
            </View>
          )}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function FileSheet({
  file,
  onClose,
  starred,
  onStar,
  onSend,
  onDownload,
  onEdit,
  onDetails,
  downloadLabel = "Download",
}: {
  file: FileCard | null;
  onClose: () => void;
  starred?: boolean;
  onStar?: () => void;
  onSend?: () => void;
  onDownload?: () => Promise<void>;
  onEdit?: () => void;
  onDetails?: () => void;
  downloadLabel?: string;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const close = () => {
    setError("");
    onClose();
  };
  return (
    <Sheet visible={!!file} onClose={close}>
      {file && (
        <>
          <View style={s.preview}>
            <FileIcon file={file} size={132} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.detailTitle}>{file.title}</Text>
              <Text style={ui.fine}>{file.name}</Text>
            </View>
            {onStar && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={starred ? "Remove star" : "Star file"}
                onPress={onStar}
                style={s.iconButton}
              >
                <StarIcon size={20} filled={starred} color={starred ? C.accent : C.ink} />
              </Pressable>
            )}
          </View>
          {!!(file.match?.excerpt || file.snippet) && (
            <Text style={s.snippet} numberOfLines={4} selectable>
              “{file.match?.excerpt || file.snippet}”
              {file.match?.page ? `  · page ${file.match.page}` : ""}
            </Text>
          )}
          <View style={s.info}>
            <InfoRow label="Kind" value={KINDS[kindOf(file)].label} />
            <InfoRow label="Size" value={formatSize(file.size)} />
            <InfoRow label="Modified" value={formatDate(file.modified_at)} />
            <InfoRow label="Version" value={file.number ? `v${file.number}` : ""} />
            <InfoRow label="Case" value={file.matter || "Private · no case"} />
            <InfoRow label="From" value={file.from} />
            <InfoRow
              label="Status"
              value={file.state ? file.state.replaceAll("_", " ") : ""}
            />
            <InfoRow label="Sensitive" value={file.sensitive ? "Yes" : ""} />
          </View>
          {!!error && (
            <Text style={ui.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View style={{ gap: 10 }}>
            {onSend && <Button title="Send in chat" onPress={onSend} />}
            {onDownload && (
              <Button
                title={busy ? "Preparing…" : downloadLabel}
                secondary={!!onSend}
                disabled={busy || file.available === false}
                onPress={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onDownload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
            {onDetails && (
              <Pressable accessibilityRole="link" onPress={onDetails} style={s.textButton}>
                <Text style={s.textButtonLabel}>Versions and file details</Text>
              </Pressable>
            )}
            {onEdit && (
              <Pressable accessibilityRole="button" onPress={onEdit} style={s.textButton}>
                <Text style={s.textButtonLabel}>Edit case & details</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  shadow: Platform.select({
    web: { boxShadow: "0 1px 3px rgba(40,30,20,0.16)" } as object,
    default: {
      shadowColor: "#2A2218",
      shadowOpacity: 0.14,
      shadowRadius: 2.5,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
  })!,
  badge: { position: "absolute", borderRadius: 4, paddingVertical: 1.5 },
  badgeText: { color: "#FFFFFF", fontWeight: "800", letterSpacing: 0.3 },
  tileArt: {
    backgroundColor: C.sunken,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tileStar: { position: "absolute", top: 6, right: 7 },
  tileName: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "500",
    color: C.ink,
    textAlign: "center",
  },
  tileMeta: { marginTop: 2, fontSize: 11.5, color: C.muted, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  rowArt: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: { fontSize: 15, fontWeight: "500", color: C.ink },
  sheetWrap: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,10,0.32)",
  },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "88%",
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.sunkenStrong,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sheetTitle: { flex: 1, fontFamily: serif, fontSize: 24, color: C.ink },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    height: 190,
    borderRadius: 22,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  detailTitle: { fontFamily: serif, fontSize: 24, lineHeight: 29, color: C.ink },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  snippet: {
    fontSize: 14,
    lineHeight: 20,
    color: C.muted,
    fontStyle: "italic",
  },
  info: { borderRadius: 18, backgroundColor: C.sunken, paddingHorizontal: 16 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.sunkenStrong,
  },
  infoLabel: { fontSize: 14, color: C.muted },
  infoValue: { fontSize: 14, color: C.ink, flexShrink: 1, textAlign: "right" },
  textButton: { alignItems: "center", paddingVertical: 12 },
  textButtonLabel: { color: C.accent, fontSize: 15, fontWeight: "600" },
});
