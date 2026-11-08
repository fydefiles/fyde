import type { Database, Row } from "./db.js";
import { normalize } from "./core.js";
import { fileCard, loadVersion } from "./policy.js";

const ignored = new Set("find my the file files document documents a for about latest from to with in on at of and an me is that where which".split(" "));
// Keep the dedicated search contract separate from chat's send resolver. Inference is not configured
// on this deployment; report the literal fallback explicitly rather than claiming semantic results.
export async function search(db: Database, owner: Row, query: string) {
  const terms = (normalize(query).match(/[\p{L}\p{N}_.-]+/gu) || []).filter(t => !ignored.has(t)).slice(0, 20);
  const fold = (expression: string) => `translate(lower(${expression}), 'àáâãäåāèéêëēìíîïīòóôõöøōùúûüūýÿçñ', 'aaaaaaaeeeeeiiiiiooooooouuuuuyycn')`;
  const label = fold("concat_ws(' ',d.title,v.original_name,d.tags,d.document_type,m.name)");
  const body = fold("v.extracted_text");
  const values: unknown[] = [owner.id, ...terms];
  const metadata = terms.map((_, i) => `strpos(${label},$${i+2})>0`).join(" AND ") || "TRUE";
  const literal = terms.map((_, i) => `(strpos(${label},$${i+2})>0 OR strpos(${body},$${i+2})>0)`).join(" AND ") || "TRUE";
  const candidates = !terms.length && query.trim() ? [] : await db.query(
    `SELECT v.id FROM exchange_fileversion v JOIN exchange_document d ON d.current_version_id=v.id
     LEFT JOIN exchange_matter m ON m.id=d.matter_id
     WHERE d.owner_id=$1 AND d.deleted_at IS NULL AND v.state='ready' AND (${literal})
     ORDER BY (${metadata}) DESC,v.created_at DESC,v.id LIMIT 30`, values);
  const files = [];
  for (const candidate of candidates) {
    const v = await loadVersion(db, candidate.id);
    // Recheck after ranking so a concurrent deletion or preferred-version change cannot reveal text.
    if (v.document.owner_id !== owner.id || v.document.deleted_at || v.document.current_version_id !== v.id || v.state !== "ready") continue;
    const text = String(v.extracted_text || ""), normalized = normalize(text);
    const position = terms.map(t => normalized.indexOf(t)).find(p => p >= 0) || 0;
    const start = Math.max(0, position - 90), end = Math.min(text.length, start + 320);
    files.push({ ...fileCard(v), match: {
      kind: "keyword", excerpt: (start ? "…" : "") + text.slice(start,end).replace(/\s+/g," ").trim() + (end < text.length ? "…" : ""),
      page: null, start, end,
    }});
  }
  return {files, mode: "keyword", semantic_status: query.trim() ? "disabled" : "idle"};
}
