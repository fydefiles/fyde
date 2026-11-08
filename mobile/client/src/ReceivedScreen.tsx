import React, { useMemo, useState } from "react";
import { View, Text, FlatList, StyleSheet, useWindowDimensions } from "react-native";
import type { FileCard } from "./types";
import { Avatar, C, serif, styles as ui } from "./ui";
import { FileSheet, FileTile } from "./FileVisuals";
import { ReceivedIcon } from "./Icons";

const GUTTER = 16;
const GAP = 12;

export default function ReceivedScreen({
  files,
  error,
  download,
}: {
  files: FileCard[];
  error: string;
  download: (file: FileCard) => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 5 : width >= 520 ? 4 : 3;
  const tile = (Math.min(width, 1100) - GUTTER * 2 - GAP * (columns - 1)) / columns;
  const [open, setOpen] = useState<FileCard | null>(null);
  const senders = useMemo(() => {
    const counts = new Map<string, number>();
    files.forEach((file) => counts.set(file.from || "Someone", (counts.get(file.from || "Someone") || 0) + 1));
    return [...counts.entries()];
  }, [files]);
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={files}
        numColumns={columns}
        key={`received-${columns}`}
        keyExtractor={(file) => file.item_id || file.id}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: GUTTER }}
        ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.title}>Received</Text>
            <Text style={ui.sub}>Files people have shared with you. The sender’s permissions and expiry still apply.</Text>
            {!!error && <Text style={ui.error}>{error}</Text>}
            {senders.length > 0 && (
              <View style={s.senders}>
                {senders.map(([name, count]) => (
                  <View key={name} style={s.sender}>
                    <Avatar name={name} size={24} tone={C.bg} />
                    <Text style={s.senderText}>
                      {name} <Text style={{ color: C.muted }}>{count}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <ReceivedIcon size={34} color={C.muted} />
            </View>
            <Text style={s.emptyTitle}>Nothing here yet</Text>
            <Text style={[ui.sub, { textAlign: "center" }]}>
              When a verified contact sends you a file, it appears here. You can also ask in chat for documents under a case
              someone shared with you.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ opacity: item.available === false ? 0.45 : 1 }}>
            <FileTile
              file={item}
              width={tile}
              caption={item.available === false ? "Access ended" : `From ${item.from || "someone"}`}
              onPress={() => setOpen(item)}
            />
          </View>
        )}
      />
      <FileSheet
        file={open}
        onClose={() => setOpen(null)}
        downloadLabel={open?.available === false ? "Access unavailable" : "Download / open"}
        onDownload={() => (open ? download(open) : Promise.resolve())}
      />
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 20, gap: 10 },
  title: { fontFamily: serif, fontSize: 34, color: C.ink, letterSpacing: -0.6 },
  senders: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  sender: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: C.sunken,
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
  senderText: { fontSize: 13, fontWeight: "500", color: C.ink },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 36, paddingVertical: 30 },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: { fontFamily: serif, fontSize: 22, color: C.ink },
});
