/**
 * ASVS custom-list parsing & resolution.
 *
 * The create-assessment modal lets the user paste an arbitrary list of ASVS
 * identifiers in any format (spaces, commas, newlines, Excel paste). Tokens may
 * be requirement ids (V1.2.4), section ids (V1.2 → whole section), or chapter
 * ids (V1 → whole chapter). These helpers tokenize the raw text and resolve it
 * against the catalog (fetched from GET /asvs/catalog) — entirely client-side so
 * validation is instant.
 */

// Matches V<chapter>[.<section>[.<req>]] — e.g. V1, V1.2, V1.2.4
export const ASVS_TOKEN_RE = /V\d+(?:\.\d+){0,2}/gi;

/** Extract unique, upper-cased ASVS tokens from free-form text. */
export function parseTokens(raw) {
  const matches = (raw || '').toUpperCase().match(ASVS_TOKEN_RE) || [];
  return [...new Set(matches)];
}

/**
 * Resolve tokens against the catalog.
 * @returns {{ matched: string[], unknown: string[], expanded: {token,count}[], byChapter: {chapter_id,chapter_name,count}[] }}
 */
export function resolveTokens(tokens, catalog) {
  const empty = { matched: [], unknown: [], expanded: [], byChapter: [] };
  if (!catalog || catalog.length === 0) return empty;

  const validReqs = new Set();
  const bySection = new Map();
  const byChapter = new Map();
  const catByReq = new Map();
  for (const r of catalog) {
    validReqs.add(r.req_id);
    catByReq.set(r.req_id, r);
    if (!bySection.has(r.section_id)) bySection.set(r.section_id, []);
    bySection.get(r.section_id).push(r.req_id);
    if (!byChapter.has(r.chapter_id)) byChapter.set(r.chapter_id, []);
    byChapter.get(r.chapter_id).push(r.req_id);
  }

  const wanted = new Set();
  const unknown = [];
  const expanded = [];
  for (const t of tokens) {
    if (validReqs.has(t)) {
      wanted.add(t);
    } else if (bySection.has(t)) {
      bySection.get(t).forEach((id) => wanted.add(id));
      expanded.push({ token: t, count: bySection.get(t).length });
    } else if (byChapter.has(t)) {
      byChapter.get(t).forEach((id) => wanted.add(id));
      expanded.push({ token: t, count: byChapter.get(t).length });
    } else {
      unknown.push(t);
    }
  }

  // Group matched requirements by chapter for the preview
  const chapters = new Map();
  for (const id of wanted) {
    const r = catByReq.get(id);
    if (!r) continue;
    if (!chapters.has(r.chapter_id)) {
      chapters.set(r.chapter_id, { chapter_id: r.chapter_id, chapter_name: r.chapter_name, count: 0 });
    }
    chapters.get(r.chapter_id).count += 1;
  }
  const byChapterPreview = [...chapters.values()].sort(
    (a, b) => parseInt(a.chapter_id.slice(1), 10) - parseInt(b.chapter_id.slice(1), 10)
  );

  return { matched: [...wanted], unknown, expanded, byChapter: byChapterPreview };
}
