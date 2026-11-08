import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import type { FileCard, Workspace } from "./types";
import { call } from "./api";
import { PREVIEW_TOKEN } from "./preview";
import {
  KINDS,
  SORTS,
  kindOf,
  matchesTab,
  sortFiles,
  type FileTab,
  type Kind,
} from "./library";
import { toggleStar, updatePrefs, useLibraryPrefs } from "./prefs";
import { Button, C, Chip, Field, Toggle, serif, styles as ui } from "./ui";
import {
  FileIcon,
  FileRow,
  FileSheet,
  FileTile,
  FolderIcon,
  FolderTile,
  Sheet,
  fileMeta,
} from "./FileVisuals";
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  SortIcon,
} from "./Icons";

const PAGE = 24;
const SEMANTIC_NOTES: Record<string, string> = {
  unavailable: "Search by meaning is temporarily unavailable. These results match words in your files.",
  indexing: "Your files are still being indexed for search by meaning. Word matches are shown for now.",
  disabled: "Search by meaning isn’t connected yet. These results match words in your files.",
  blocked: "Some files couldn’t be indexed for search by meaning. You can still search by words.",
};
const GUTTER = 16;
const GAP = 12;

type Props = {
  state: Workspace;
  token: string;
  query: string;
  onQuery: (query: string) => void;
  download: (file: FileCard) => Promise<void>;
  sendInChat: (file: FileCard) => void;
  editDetails: (file: FileCard) => void;
};

export default function SearchScreen({
  state,
  token,
  query,
  onQuery,
  download,
  sendInChat,
  editDetails,
}: Props) {
  const prefs = useLibraryPrefs();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 5 : width >= 520 ? 4 : 3;
  const tileWidth = (Math.min(width, 1100) - GUTTER * 2 - GAP * (columns - 1)) / columns;
  const term = query.trim();
  const [result, setResult] = useState<{
    query: string;
    files: FileCard[];
    error: string;
    semanticStatus?: string;
  }>({
    query: "",
    files: [],
    error: "",
  });
  const pageKey = `${query.trim()}|${prefs.activeTab}|${prefs.sort}`;
  const [page, setPage] = useState({ key: pageKey, limit: PAGE });
  const limit = page.key === pageKey ? page.limit : PAGE;
  const [open, setOpen] = useState<FileCard | null>(null);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const visibleTabs = prefs.tabs.filter((tab) => !tab.hidden || tab.id === prefs.activeTab);
  const activeTab = prefs.tabs.find((tab) => tab.id === prefs.activeTab) ?? prefs.tabs[0];
  const busy = !!term && result.query !== term;

  useEffect(() => {
    if (!term) return;
    let current = true;
    const timer = setTimeout(() => {
      call<{ files: FileCard[]; semantic_status?: string }>("/api/v1/files/search/", token, "POST", { query: term })
        .then(
          (value) =>
            current &&
            setResult({ query: term, files: value.files, error: "", semanticStatus: value.semantic_status }),
        )
        .catch((e) => current && setResult({ query: term, files: [], error: e.message }));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, token]);

  const searchResults = useMemo(
    () =>
      term && result.query === term
        ? result.files.filter((file) => matchesTab(file, activeTab, prefs.starred))
        : [],
    [term, result, activeTab, prefs.starred],
  );
  const browseFiles = useMemo(
    () =>
      sortFiles(
        state.files.filter((file) => matchesTab(file, activeTab, prefs.starred)),
        prefs.sort,
      ),
    [state.files, activeTab, prefs.starred, prefs.sort],
  );
  const best = term ? searchResults[0] : undefined;
  const all = term ? searchResults.slice(1) : browseFiles;
  const shown = all.slice(0, limit);
  const more = shown.length < all.length;
  const isStarred = (file: FileCard) => prefs.starred.has(file.document_id) || !!file.starred;

  const folders =
    !term && activeTab.id === "all"
      ? state.matters
          .map((matter) => ({
            ...matter,
            count: state.files.filter((file) => file.matter_id === matter.id).length,
          }))
          .filter((matter) => matter.count > 0)
      : [];

  function openCase(matter: { id: string; name: string }) {
    const existing = prefs.tabs.find(
      (tab) => tab.filter.matterIds?.length === 1 && tab.filter.matterIds[0] === matter.id,
    );
    if (existing)
      updatePrefs((old) => ({
        activeTab: existing.id,
        tabs: old.tabs.map((tab) => (tab.id === existing.id ? { ...tab, hidden: false } : tab)),
      }));
    else {
      const tab: FileTab = {
        id: `case-${matter.id}`,
        name: matter.name,
        filter: { matterIds: [matter.id] },
      };
      updatePrefs((old) => ({ tabs: [...old.tabs, tab], activeTab: tab.id }));
    }
  }

  const header = (
    <View style={{ gap: 18, paddingBottom: 14 }}>
      {term ? (
        busy ? (
          <View style={s.searching}>
            <ActivityIndicator color={C.accent} />
            <Text style={ui.fine}>Looking for “{term}”…</Text>
          </View>
        ) : result.error ? (
          <Text style={[ui.error, { paddingHorizontal: GUTTER }]} accessibilityRole="alert">
            {result.error}
          </Text>
        ) : best ? (
          <View style={{ paddingHorizontal: GUTTER, gap: 10 }}>
            <View style={s.matchLabel}>
              {best.match?.exact && (
                <View style={s.matchCheck}>
                  <CheckIcon size={10} color="#FFFFFF" weight={1.8} />
                </View>
              )}
              <Text style={[ui.eyebrow, best.match?.exact && { color: C.success }]}>
                {best.match?.exact
                  ? "Exact match"
                  : best.match?.kind === "semantic"
                    ? "Best match by meaning"
                    : "Best match"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Best match, ${best.title}`}
              onPress={() => setOpen(best)}
              style={({ pressed }) => [s.bestCard, pressed && { opacity: 0.85 }]}
            >
              <View style={s.bestArt}>
                <FileIcon file={best} size={78} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={2} style={s.bestTitle}>
                  {best.title}
                </Text>
                <Text numberOfLines={1} style={ui.fine}>
                  {[KINDS[kindOf(best)].label, fileMeta(best), best.matter].filter(Boolean).join(" · ")}
                </Text>
                {!!(best.match?.reason || best.match?.excerpt || best.snippet) && (
                  <Text numberOfLines={3} style={[s.reason, !best.match?.reason && { color: C.muted }]}>
                    {best.match?.reason || `“${best.match?.excerpt || best.snippet}”`}
                    {best.match?.page ? ` · page ${best.match.page}` : ""}
                  </Text>
                )}
              </View>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Send in chat" compact onPress={() => sendInChat(best)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Details" compact secondary onPress={() => setOpen(best)} />
              </View>
            </View>
          </View>
        ) : null
      ) : (
        folders.length > 0 && (
          <View style={{ gap: 12 }}>
            <Text style={[s.sectionTitle, { paddingHorizontal: GUTTER }]}>Cases</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
            >
              {folders.map((matter) => (
                <FolderTile
                  key={matter.id}
                  name={matter.name}
                  count={matter.count}
                  width={tileWidth}
                  onPress={() => openCase(matter)}
                />
              ))}
            </ScrollView>
          </View>
        )
      )}
      {(!term || (!busy && all.length > 0)) && (
        <View style={s.toolbar}>
          <Text style={s.sectionTitle}>
            {term
              ? `More results`
              : activeTab.id === "all"
                ? "All files"
                : activeTab.name}
            <Text style={s.count}>  {all.length}</Text>
          </Text>
          {!term && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORTS.find((x) => x.id === prefs.sort)?.name}`}
              onPress={() => setSortOpen(true)}
              style={s.toolButton}
            >
              <SortIcon size={14} color={C.ink} />
              <Text style={s.toolText}>{SORTS.find((x) => x.id === prefs.sort)?.name}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={prefs.view === "grid" ? "Show as list" : "Show as grid"}
            onPress={() => updatePrefs((old) => ({ view: old.view === "grid" ? "list" : "grid" }))}
            style={s.toolIcon}
          >
            {prefs.view === "grid" ? <ListIcon size={16} /> : <GridIcon size={16} />}
          </Pressable>
        </View>
      )}
      {!!term && !busy && result.query === term && SEMANTIC_NOTES[result.semanticStatus || ""] && (
        <Text style={[ui.fine, { paddingHorizontal: GUTTER }]} accessibilityLiveRegion="polite">
          {SEMANTIC_NOTES[result.semanticStatus || ""]}
        </Text>
      )}
      {!!term && !busy && activeTab.id !== "all" && (
        <Pressable onPress={() => updatePrefs(() => ({ activeTab: "all" }))} style={{ paddingHorizontal: GUTTER }}>
          <Text style={ui.fine}>
            Showing results in {activeTab.name}. <Text style={{ color: C.accent }}>Search all files</Text>
          </Text>
        </Pressable>
      )}
    </View>
  );

  const empty = busy ? undefined : term ? (
    best ? undefined : (
      <EmptyState
        title={`Nothing matches “${term}”`}
        body="Try describing it another way: what is in it, who sent it, or roughly when you got it."
      />
    )
  ) : (
    <EmptyState
      title={state.files.length ? `No files in ${activeTab.name}` : "Your library is empty"}
      body={
        state.files.length
          ? "Files appear here when they match this tab. Edit the tab to change what it shows."
          : "Add files from chat — just say “Add files”."
      }
    />
  );

  const grid = prefs.view === "grid";
  return (
    <View style={{ flex: 1 }}>
      <View style={s.top}>
        <View style={s.searchBox}>
          <SearchIcon size={18} color={C.muted} />
          <TextInput
            accessibilityLabel="Search or describe a file"
            placeholder="Search or describe a file"
            placeholderTextColor={C.faint}
            value={query}
            onChangeText={onQuery}
            maxLength={180}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={() => Keyboard.dismiss()}
            style={s.searchInput}
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => onQuery("")}
              style={s.clear}
            >
              <CloseIcon size={10} color="#FFFFFF" weight={1.8} />
            </Pressable>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.tabs}
        >
          {visibleTabs.map((tab) => (
            <Chip
              key={tab.id}
              role="tab"
              label={tab.name}
              selected={tab.id === activeTab.id}
              onPress={() => updatePrefs(() => ({ activeTab: tab.id }))}
              onLongPress={() => setTabsOpen(true)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Set up tabs"
            onPress={() => setTabsOpen(true)}
            style={s.tabTool}
          >
            <SlidersIcon size={16} />
          </Pressable>
        </ScrollView>
      </View>
      <FlatList
        key={grid ? `grid-${columns}` : "list"}
        data={shown}
        numColumns={grid ? columns : 1}
        keyExtractor={(file) => file.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        columnWrapperStyle={grid ? { gap: GAP, paddingHorizontal: GUTTER } : undefined}
        ItemSeparatorComponent={() => <View style={{ height: grid ? 18 : 2 }} />}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, paddingHorizontal: grid ? 0 : 8 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => more && setPage({ key: pageKey, limit: limit + PAGE })}
        ListFooterComponent={
          more ? <ActivityIndicator style={{ marginTop: 22 }} color={C.muted} /> : <View style={{ height: 8 }} />
        }
        renderItem={({ item }) =>
          grid ? (
            <FileTile file={item} width={tileWidth} starred={isStarred(item)} onPress={() => setOpen(item)} />
          ) : (
            <FileRow file={item} starred={isStarred(item)} onPress={() => setOpen(item)} />
          )
        }
      />
      <FileSheet
        file={open}
        onClose={() => setOpen(null)}
        starred={open ? isStarred(open) : false}
        onStar={() => open && toggleStar(open.document_id)}
        onSend={() => {
          if (!open) return;
          const file = open;
          setOpen(null);
          sendInChat(file);
        }}
        onDownload={() =>
          open ? download({ ...open, api_download_url: `/api/v1/files/${open.id}/download/` }) : Promise.resolve()
        }
        onEdit={() => {
          if (!open) return;
          const file = open;
          setOpen(null);
          editDetails(file);
        }}
        onDetails={
          token === PREVIEW_TOKEN
            ? undefined
            : () => {
                if (!open) return;
                const file = open;
                setOpen(null);
                router.push({ pathname: "/document", params: { id: file.document_id } });
              }
        }
      />
      <SortSheet visible={sortOpen} onClose={() => setSortOpen(false)} />
      <TabsSheet visible={tabsOpen} onClose={() => setTabsOpen(false)} state={state} />
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.empty}>
      <FolderIcon seed="empty" size={84} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={[ui.sub, { textAlign: "center" }]}>{body}</Text>
    </View>
  );
}

function SortSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const prefs = useLibraryPrefs();
  return (
    <Sheet visible={visible} onClose={onClose} title="Sort & view">
      <View style={s.group}>
        {SORTS.map((sort, index) => (
          <Pressable
            key={sort.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: prefs.sort === sort.id }}
            onPress={() => {
              updatePrefs(() => ({ sort: sort.id }));
              onClose();
            }}
            style={[s.groupRow, index > 0 && s.groupDivider]}
          >
            <Text style={s.groupText}>{sort.name}</Text>
            {prefs.sort === sort.id && <CheckIcon size={16} color={C.accent} />}
          </Pressable>
        ))}
      </View>
      <View style={s.segment}>
        {(["grid", "list"] as const).map((view) => (
          <Pressable
            key={view}
            accessibilityRole="radio"
            accessibilityState={{ checked: prefs.view === view }}
            onPress={() => updatePrefs(() => ({ view }))}
            style={[s.segmentItem, prefs.view === view && s.segmentActive]}
          >
            {view === "grid" ? <GridIcon size={15} /> : <ListIcon size={15} />}
            <Text style={s.toolText}>{view === "grid" ? "Icons" : "List"}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const KIND_CHOICES: Kind[] = ["pdf", "doc", "sheet", "slides", "image", "text", "archive", "video"];

function TabsSheet({
  visible,
  onClose,
  state,
}: {
  visible: boolean;
  onClose: () => void;
  state: Workspace;
}) {
  const prefs = useLibraryPrefs();
  const [name, setName] = useState(""),
    [kinds, setKinds] = useState<Kind[]>([]),
    [matters, setMatters] = useState<string[]>([]),
    [starred, setStarred] = useState(false),
    [recent, setRecent] = useState(false),
    [sensitive, setSensitive] = useState(false);
  const flip = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  function move(index: number) {
    if (index === 0) return;
    updatePrefs((old) => {
      const tabs = [...old.tabs];
      [tabs[index - 1], tabs[index]] = [tabs[index], tabs[index - 1]];
      return { tabs };
    });
  }
  function add() {
    const tab: FileTab = {
      id: `tab-${Date.now()}`,
      name: name.trim(),
      filter: {
        kinds: kinds.length ? kinds : undefined,
        matterIds: matters.length ? matters : undefined,
        starred: starred || undefined,
        recentDays: recent ? 30 : undefined,
        sensitive: sensitive || undefined,
      },
    };
    updatePrefs((old) => ({ tabs: [...old.tabs, tab], activeTab: tab.id }));
    setName("");
    setKinds([]);
    setMatters([]);
    setStarred(false);
    setRecent(false);
    setSensitive(false);
    onClose();
  }
  const summary = (tab: FileTab) => {
    const f = tab.filter;
    const parts = [
      ...(f.kinds || []).map((kind) => KINDS[kind].label),
      ...(f.matterIds || []).map((id) => state.matters.find((m) => m.id === id)?.name || "Case"),
      f.starred ? "Starred" : "",
      f.recentDays ? `Last ${f.recentDays} days` : "",
      f.sensitive ? "Sensitive" : "",
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "Every file";
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Your tabs">
      <View style={s.group}>
        {prefs.tabs.map((tab, index) => (
          <View key={tab.id} style={[s.groupRow, index > 0 && s.groupDivider]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.groupText, tab.hidden && { color: C.faint }]}>{tab.name}</Text>
              <Text style={ui.fine} numberOfLines={1}>
                {summary(tab)}
              </Text>
            </View>
            {index > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${tab.name} earlier`}
                onPress={() => move(index)}
                style={s.rowAction}
              >
                <ChevronIcon direction="up" size={13} color={C.muted} />
              </Pressable>
            )}
            {tab.id !== "all" &&
              (tab.builtIn ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={`Show ${tab.name}`}
                  accessibilityState={{ checked: !tab.hidden }}
                  onPress={() =>
                    updatePrefs((old) => ({
                      tabs: old.tabs.map((t) => (t.id === tab.id ? { ...t, hidden: !t.hidden } : t)),
                      activeTab: old.activeTab === tab.id && !tab.hidden ? "all" : old.activeTab,
                    }))
                  }
                  style={[s.pillToggle, !tab.hidden && s.pillToggleOn]}
                >
                  <Text style={[s.pillToggleText, !tab.hidden && { color: "#FFFFFF" }]}>
                    {tab.hidden ? "Hidden" : "Shown"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${tab.name}`}
                  onPress={() =>
                    updatePrefs((old) => ({
                      tabs: old.tabs.filter((t) => t.id !== tab.id),
                      activeTab: old.activeTab === tab.id ? "all" : old.activeTab,
                    }))
                  }
                  style={s.rowAction}
                >
                  <CloseIcon size={12} color={C.danger} />
                </Pressable>
              ))}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
        <PlusIcon size={14} color={C.accent} />
        <Text style={s.sectionTitle}>New tab</Text>
      </View>
      <Field label="Name" placeholder="e.g. Visa paperwork" value={name} onChangeText={setName} maxLength={30} />
      <View>
        <Text style={ui.label}>File kinds</Text>
        <View style={ui.chips}>
          {KIND_CHOICES.map((kind) => (
            <Chip
              key={kind}
              role="button"
              label={KINDS[kind].label}
              selected={kinds.includes(kind)}
              onPress={() => setKinds(flip(kinds, kind))}
            />
          ))}
        </View>
      </View>
      {state.matters.length > 0 && (
        <View>
          <Text style={ui.label}>Cases</Text>
          <View style={ui.chips}>
            {state.matters.map((matter) => (
              <Chip
                key={matter.id}
                role="button"
                label={matter.name}
                selected={matters.includes(matter.id)}
                onPress={() => setMatters(flip(matters, matter.id))}
              />
            ))}
          </View>
        </View>
      )}
      <View style={s.group}>
        <View style={{ paddingHorizontal: 16 }}>
          <Toggle label="Starred files only" value={starred} onChange={setStarred} />
          <Toggle label="Changed in the last 30 days" value={recent} onChange={setRecent} />
          <Toggle label="Sensitive files only" value={sensitive} onChange={setSensitive} />
        </View>
      </View>
      <Button title="Add tab" disabled={!name.trim()} onPress={add} />
      <Text style={[ui.fine, { textAlign: "center", marginBottom: 6 }]}>
        Tabs are saved on this device while you are signed in.
      </Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  top: { paddingTop: 4, gap: 12, paddingBottom: 10, backgroundColor: C.bg },
  searchBox: {
    marginHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.sunken,
    borderRadius: 16,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  searchInput: { flex: 1, fontSize: 17, color: C.ink, paddingVertical: 12 },
  clear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.faint,
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: { paddingHorizontal: GUTTER, gap: 8, alignItems: "center" },
  tabTool: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  searching: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: GUTTER, paddingVertical: 20 },
  matchLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  matchCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.success,
    alignItems: "center",
    justifyContent: "center",
  },
  bestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
  },
  bestArt: {
    width: 96,
    height: 96,
    borderRadius: 16,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  bestTitle: { fontFamily: serif, fontSize: 19, lineHeight: 23, color: C.ink },
  reason: { fontSize: 12.5, lineHeight: 17, color: C.success },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: C.ink, flex: 1 },
  count: { fontSize: 14, fontWeight: "400", color: C.muted },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: GUTTER },
  toolButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.sunken,
  },
  toolIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: { fontSize: 13, fontWeight: "500", color: C.ink },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 36, paddingVertical: 40 },
  emptyTitle: { fontFamily: serif, fontSize: 22, color: C.ink, textAlign: "center" },
  group: { backgroundColor: C.sunken, borderRadius: 18, overflow: "hidden" },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, minHeight: 56, paddingVertical: 8 },
  groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.sunkenStrong },
  groupText: { fontSize: 15, color: C.ink, flex: 1 },
  rowAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  pillToggle: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: C.bg, justifyContent: "center" },
  pillToggleOn: { backgroundColor: C.ink },
  pillToggleText: { fontSize: 12, fontWeight: "600", color: C.muted },
  segment: { flexDirection: "row", backgroundColor: C.sunken, borderRadius: 14, padding: 4, marginBottom: 6 },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    height: 40,
    borderRadius: 11,
  },
  segmentActive: { backgroundColor: C.bg },
});
