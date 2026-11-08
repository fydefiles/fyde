// Library view preferences that survive switching tabs for this session.
// They live in memory only; nothing here is sent to the server yet.
import { useSyncExternalStore } from "react";
import { DEFAULT_TABS, type FileTab, type SortKey } from "./library";

export type LibraryPrefs = {
  tabs: FileTab[];
  activeTab: string;
  view: "grid" | "list";
  sort: SortKey;
  starred: Set<string>;
};
const initial = (): LibraryPrefs => ({
  tabs: DEFAULT_TABS.map((tab) => ({ ...tab })),
  activeTab: "all",
  view: "grid",
  sort: "modified",
  starred: new Set(),
});
let prefs = initial();
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((listener) => listener());
}
export function updatePrefs(change: (old: LibraryPrefs) => Partial<LibraryPrefs>) {
  prefs = { ...prefs, ...change(prefs) };
  emit();
}
export function resetPrefs() {
  prefs = initial();
  emit();
}
export function toggleStar(documentId: string) {
  updatePrefs((old) => {
    const starred = new Set(old.starred);
    if (starred.has(documentId)) starred.delete(documentId);
    else starred.add(documentId);
    return { starred };
  });
}
export function useLibraryPrefs() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => prefs,
  );
}
