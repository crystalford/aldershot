/**
 * What "Ask for anything" asks.
 *
 * That field sits in the nav on every page and was wired to nothing at all —
 * as were the "?" beside it and the notification bell. Three ornaments and
 * four links, which is most of why the owner called the app "a nightmare to
 * use": the only way to reach anything was to guess which of four surfaces
 * held it.
 *
 * NO MODEL RUNS HERE. Footage's "by meaning" search embeds the query, which
 * costs a Workers AI call — fine for one deliberate search, wrong for a
 * palette that fires as you type. This is plain SQL over titles and quotes,
 * so it is free and fast, and the palette offers meaning-search as a link out
 * when the words alone are not enough.
 */

export interface Hit {
  kind: "source" | "project" | "clip";
  id: string;
  title: string;
  sub: string;
  href: string;
}

/** Each term must appear somewhere — "gym week" finds a line with both. */
function likeClause(column: string, terms: string[]): { sql: string; binds: string[] } {
  return {
    sql: terms.map(() => `${column} LIKE ?`).join(" AND "),
    binds: terms.map((t) => `%${t}%`),
  };
}

function terms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0).slice(0, 5);
}

const ms = (n: number) => {
  const s = Math.max(0, Math.round(n / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Everything matching, across the three things a person looks for.
 *
 * Videos first, then edits, then lines — the order the owner actually wants,
 * since "find the video I uploaded" is the common case and a wall of matching
 * transcript lines buries it.
 */
export async function quickSearch(db: D1Database, userId: string, query: string): Promise<Hit[]> {
  const t = terms(query);
  if (!t.length) return [];

  const src = likeClause("LOWER(title)", t);
  const proj = likeClause("LOWER(title)", t);
  const clip = likeClause("LOWER(c.quote)", t);

  const [sources, projects, clips] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, duration_s, transcript_state FROM sources
          WHERE user_id=? AND deleted_at IS NULL AND ${src.sql}
          ORDER BY created_at DESC LIMIT 5`,
      )
      .bind(userId, ...src.binds)
      .all<{ id: string; title: string; duration_s: number | null; transcript_state: string }>(),

    db
      .prepare(
        `SELECT id, title, kind FROM v2_projects
          WHERE user_id=? AND deleted_at IS NULL AND archived_at IS NULL AND ${proj.sql}
          ORDER BY updated_at DESC LIMIT 5`,
      )
      .bind(userId, ...proj.binds)
      .all<{ id: string; title: string; kind: string }>(),

    db
      .prepare(
        `SELECT c.id, c.quote, c.start_ms, s.title AS source_title FROM v2_clips c
           JOIN sources s ON s.id = c.source_id
          WHERE c.user_id=? AND c.deleted_at IS NULL AND ${clip.sql}
          ORDER BY c.created_at DESC LIMIT 6`,
      )
      .bind(userId, ...clip.binds)
      .all<{ id: string; quote: string; start_ms: number; source_title: string }>(),
  ]);

  const out: Hit[] = [];

  for (const s of sources.results ?? []) {
    out.push({
      kind: "source",
      id: s.id,
      title: s.title,
      sub:
        s.transcript_state === "ready"
          ? [s.duration_s ? ms(s.duration_s * 1000) : null, "video"].filter(Boolean).join(" · ")
          : `video · ${s.transcript_state}`,
      /* Straight into the editor, same as clicking it in Footage. */
      href: `/sources/${s.id}`,
    });
  }

  for (const p of projects.results ?? []) {
    out.push({ kind: "project", id: p.id, title: p.title, sub: `edit · ${p.kind}`, href: `/p/${p.id}/pick` });
  }

  for (const c of clips.results ?? []) {
    out.push({
      kind: "clip",
      id: c.id,
      title: c.quote,
      sub: `clip · ${c.source_title} · ${ms(c.start_ms)}`,
      href: `/footage?tab=moments`,
    });
  }

  return out;
}
