// Client-side helpers for showing files like a file browser: kinds, sizes,
// dates, tabs and sorting. Nothing here decides what a search matches.
import type { FileCard } from "./types";

export type Kind =
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "image"
  | "text"
  | "archive"
  | "video"
  | "other";

export const KINDS: Record<Kind, { label: string; color: string }> = {
  pdf: { label: "PDF", color: "#D9483B" },
  doc: { label: "Document", color: "#2F6BD8" },
  sheet: { label: "Spreadsheet", color: "#23915A" },
  slides: { label: "Presentation", color: "#E08A1E" },
  image: { label: "Photo", color: "#7C5CD6" },
  text: { label: "Text", color: "#5E6B7A" },
  archive: { label: "Archive", color: "#9A6B2F" },
  video: { label: "Video", color: "#C93D7E" },
  other: { label: "File", color: "#78736A" },
};

const EXTENSIONS: Record<string, Kind> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  pages: "doc",
  rtf: "doc",
  odt: "doc",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  numbers: "sheet",
  ppt: "slides",
  pptx: "slides",
  key: "slides",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "image",
  gif: "image",
  webp: "image",
  txt: "text",
  md: "text",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  mp4: "video",
  mov: "video",
};

export function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}
export function kindOf(file: Pick<FileCard, "name">): Kind {
  return EXTENSIONS[extensionOf(file.name)] ?? "other";
}
export function badgeOf(file: Pick<FileCard, "name">) {
  const ext = extensionOf(file.name);
  if (!ext) return "FILE";
  return (ext === "jpeg" ? "jpg" : ext).slice(0, 4).toUpperCase();
}
export function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
export function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const days = Math.floor(
    (new Date(now.toDateString()).getTime() -
      new Date(date.toDateString()).getTime()) /
      86400000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
// Stable index so a file keeps the same thumbnail tone between renders.
export function toneIndex(seed: string, count: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % count;
}

export type TabFilter = {
  kinds?: Kind[];
  matterIds?: string[];
  starred?: boolean;
  recentDays?: number;
  sensitive?: boolean;
};
export type FileTab = {
  id: string;
  name: string;
  builtIn?: boolean;
  hidden?: boolean;
  filter: TabFilter;
};
export const DEFAULT_TABS: FileTab[] = [
  { id: "all", name: "All files", builtIn: true, filter: {} },
  { id: "recent", name: "Recent", builtIn: true, filter: { recentDays: 30 } },
  { id: "starred", name: "Starred", builtIn: true, filter: { starred: true } },
  { id: "pdf", name: "PDFs", builtIn: true, filter: { kinds: ["pdf"] } },
  { id: "photos", name: "Photos", builtIn: true, filter: { kinds: ["image"] } },
  {
    id: "docs",
    name: "Documents",
    builtIn: true,
    filter: { kinds: ["doc", "text"] },
  },
  {
    id: "sheets",
    name: "Spreadsheets",
    builtIn: true,
    hidden: true,
    filter: { kinds: ["sheet"] },
  },
];

export function matchesTab(
  file: FileCard,
  tab: FileTab,
  starred: Set<string>,
): boolean {
  const f = tab.filter;
  if (f.kinds?.length && !f.kinds.includes(kindOf(file))) return false;
  if (f.matterIds?.length && !f.matterIds.includes(file.matter_id || ""))
    return false;
  if (f.starred && !(starred.has(file.document_id) || file.starred))
    return false;
  if (f.sensitive && !file.sensitive) return false;
  if (f.recentDays && file.modified_at) {
    const age = Date.now() - new Date(file.modified_at).getTime();
    if (age > f.recentDays * 86400000) return false;
  }
  return true;
}

export type SortKey = "name" | "modified" | "size" | "kind";
export const SORTS: { id: SortKey; name: string }[] = [
  { id: "modified", name: "Last modified" },
  { id: "name", name: "Name" },
  { id: "kind", name: "Kind" },
  { id: "size", name: "Size" },
];
export function sortFiles(files: FileCard[], key: SortKey) {
  const list = [...files];
  list.sort((a, b) => {
    if (key === "name") return a.title.localeCompare(b.title);
    if (key === "size") return (b.size || 0) - (a.size || 0);
    if (key === "kind")
      return (
        KINDS[kindOf(a)].label.localeCompare(KINDS[kindOf(b)].label) ||
        a.title.localeCompare(b.title)
      );
    return (b.modified_at || "").localeCompare(a.modified_at || "");
  });
  return list;
}
