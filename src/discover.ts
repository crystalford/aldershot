/**
 * Discover — external, internet-sourced grounding for an essay's claims,
 * beyond the user's own Archive footage (see the design handoff's Discover
 * view). A "research" beat (see essays.ts) grounds to a DiscoverResult the
 * same way a "clip" beat grounds to a real clip_id — never an invented
 * source or timestamp.
 *
 * v1 source: Wikipedia's public search/extract API — free, keyless, no
 * scraping, and every result is a real dereferenceable URL with real
 * (not model-generated) extracted text, so "never invent a source" holds
 * by construction. This is deliberately narrower than "search the whole
 * web" — that needs a real search-API credential (Brave/Serper/Tavily-
 * style), which isn't configured. Widening past Wikipedia is a follow-up,
 * not a gap in this pass.
 */

export interface DiscoverCandidate {
  title: string;
  url: string;
  extract: string;
  source: "wikipedia";
}

export interface DiscoverResult extends DiscoverCandidate {
  id: string;
  query: string;
  createdAt: number;
}

export async function ensureDiscoverSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS discover_results (
       id TEXT PRIMARY KEY,
       query TEXT NOT NULL,
       title TEXT NOT NULL,
       url TEXT NOT NULL,
       extract TEXT NOT NULL,
       source TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ).run();
}

interface WikiSearchResponse { query?: { search?: { pageid: number; title: string }[] } }
interface WikiExtractResponse { query?: { pages?: Record<string, { pageid: number; title: string; extract?: string; fullurl?: string }> } }

/** Transient candidates — not persisted until the user picks one via
 *  saveDiscoverResult, same review-then-commit discipline as
 *  POST /api/clips/discover (findable candidates, saving is a separate
 *  explicit step). */
export async function searchWikipedia(query: string, limit = 6): Promise<DiscoverCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${limit}`;
  const searchRes = await fetch(searchUrl, { headers: { "user-agent": "Aldershot/1.0 (video-essay research tool)" } });
  if (!searchRes.ok) throw new Error(`Wikipedia search failed (${searchRes.status})`);
  const searchData = await searchRes.json<WikiSearchResponse>();
  const pageIds = (searchData.query?.search ?? []).map((r) => r.pageid);
  if (!pageIds.length) return [];

  const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&pageids=${pageIds.join("|")}&format=json`;
  const extractRes = await fetch(extractUrl, { headers: { "user-agent": "Aldershot/1.0 (video-essay research tool)" } });
  if (!extractRes.ok) throw new Error(`Wikipedia extract failed (${extractRes.status})`);
  const extractData = await extractRes.json<WikiExtractResponse>();
  const pages = extractData.query?.pages ?? {};

  // Preserve the search API's relevance order — Object.values on the pages
  // map doesn't guarantee it.
  return pageIds
    .map((id) => pages[String(id)])
    .filter((p): p is NonNullable<typeof p> => !!p?.extract && !!p.fullurl)
    .map((p) => ({ title: p.title, url: p.fullurl!, extract: p.extract!.slice(0, 1200), source: "wikipedia" as const }));
}

export async function saveDiscoverResult(db: D1Database, query: string, candidate: DiscoverCandidate): Promise<DiscoverResult> {
  const result: DiscoverResult = { id: crypto.randomUUID(), query, createdAt: Date.now(), ...candidate };
  await db
    .prepare(`INSERT INTO discover_results (id, query, title, url, extract, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(result.id, result.query, result.title, result.url, result.extract, result.source, result.createdAt)
    .run();
  return result;
}

export async function getDiscoverResult(db: D1Database, id: string): Promise<DiscoverResult | null> {
  const row = await db.prepare(`SELECT * FROM discover_results WHERE id = ?`).bind(id).first<{
    id: string; query: string; title: string; url: string; extract: string; source: string; created_at: number;
  }>();
  if (!row) return null;
  return { id: row.id, query: row.query, title: row.title, url: row.url, extract: row.extract, source: row.source as "wikipedia", createdAt: row.created_at };
}

/** The most recently saved Discover result, if any — feeds the Desk's
 *  "since you were last here" digest. */
export async function getMostRecentDiscoverResult(db: D1Database): Promise<DiscoverResult | null> {
  const row = await db.prepare(`SELECT * FROM discover_results ORDER BY created_at DESC LIMIT 1`).first<{
    id: string; query: string; title: string; url: string; extract: string; source: string; created_at: number;
  }>();
  if (!row) return null;
  return { id: row.id, query: row.query, title: row.title, url: row.url, extract: row.extract, source: row.source as "wikipedia", createdAt: row.created_at };
}
