/**
 * Putting the clip library into Vectorize, so it can be searched by meaning.
 *
 * searchMeaning (src/library.ts) has existed since the library did, and it has
 * never returned anything, because NOTHING EVER WROTE A VECTOR. The query half
 * was built and the write half was not, so the index stayed empty even on the
 * accounts where the binding existed. This is the write half.
 *
 * WHY CLIPS FIRST, AND NOT THE WHOLE TRANSCRIPT. The obvious ambition is to
 * index every window of every video — a 3,000-hour library is around 240,000
 * windows. The clip library is a few thousand rows. Indexing clips costs about
 * a thousandth as much and answers the same question: does retrieval over this
 * material actually find the right moments? If it does, windowing the raw
 * transcript is the next step and this code is the pattern for it. If it does
 * not, we found out for pennies.
 *
 * It is also the layer with the strongest evidence behind it. A kept clip is a
 * moment a person chose, which makes it both the best thing to retrieve and
 * the only labelled data this product has about what "good" means.
 */

import type { Env } from "./env.ts";
import { EMBED } from "./models.ts";

/**
 * Workers AI takes an array of strings per call. A hundred is comfortably
 * inside the request limit and keeps one failure from costing a whole backfill.
 */
export const EMBED_BATCH = 100;

/** Vectorize takes at most 1,000 vectors per upsert from a Worker. */
export const UPSERT_BATCH = 500;

export interface IndexableClip {
  id: string;
  user_id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  source_title?: string | null;
}

/**
 * THE TEXT THAT GETS EMBEDDED, and deliberately not everything we know.
 *
 * The quote and the source title, nothing else. Two things are left out on
 * purpose:
 *
 * `why` is the model's note about why the moment was kept — "Awkward closer,
 * good button". That is editorial metadata, not something anybody says, and
 * embedding it would let a search match on our own commentary rather than on
 * the footage. It is also what the evaluation harness uses as a stand-in
 * query, so keeping it out of the vector is what stops that measurement from
 * marking its own homework.
 *
 * The source title goes IN because it is the cheap end of what the research
 * calls a contextual prefix: a line from a podcast about filters is easier to
 * place when the embedding knows it came from a podcast about filters. It is
 * one line rather than a generated summary, so it costs nothing.
 *
 * Exported and pure so a variant can be measured rather than argued about.
 */
export function clipText(clip: IndexableClip): string {
  const title = (clip.source_title ?? "").trim();
  const quote = clip.quote.trim();
  return title ? `${title} — ${quote}` : quote;
}

/**
 * Embeds a batch of strings, or returns null if the model gives nothing back.
 *
 * Null rather than an empty array, for the same reason searchMeaning returns
 * null: "the embedder did not answer" and "there is nothing here" are
 * different facts and the caller acts differently on each.
 */
export async function embed(env: Env, texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<{ data?: number[][] }>;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = await run(EMBED.id, { text: texts.slice(i, i + EMBED_BATCH) });
    const data = res.data;
    if (!data || data.length !== Math.min(EMBED_BATCH, texts.length - i)) return null;
    out.push(...data);
  }
  return out;
}

/**
 * Writes clips into the index.
 *
 * The vector id IS the clip id, because searchMeaning turns the ids it gets
 * back into a `WHERE c.id IN (...)` — the two halves agree on that or neither
 * works. A ULID is 26 characters, well inside Vectorize's 64-byte id limit.
 *
 * `user_id` is the only filtered field and it must have a metadata index that
 * was created BEFORE the first vector was written: Vectorize cannot filter on
 * vectors inserted before the index existed, and it fails silently by simply
 * not matching them. See docs/SETUP.md.
 *
 * Returns how many it wrote. Zero when there is no binding, which is the
 * normal state until someone runs the create command, and is not an error.
 */
export async function indexClips(env: Env, clips: IndexableClip[]): Promise<number> {
  if (!env.VECTORIZE || !clips.length) return 0;

  const vectors = await embed(env, clips.map(clipText));
  if (!vectors) return 0;

  let written = 0;
  for (let i = 0; i < clips.length; i += UPSERT_BATCH) {
    const slice = clips.slice(i, i + UPSERT_BATCH);
    await env.VECTORIZE.upsert(
      slice.map((c, n) => ({
        id: c.id,
        values: vectors[i + n],
        /* Small and filterable. Only user_id is indexed; the rest rides along
           so a future caller can narrow without a second round trip, and it is
           nowhere near the 10 KiB per-vector ceiling. */
        metadata: {
          user_id: c.user_id,
          source_id: c.source_id,
          start_ms: c.start_ms,
          end_ms: c.end_ms,
          kind: "clip",
        },
      })),
    );
    written += slice.length;
  }
  return written;
}

/**
 * Indexes clips that have never been indexed, oldest first.
 *
 * Oldest first on purpose: a backfill that works newest-first re-reads the
 * same recent rows on every run and never reaches the back of the library.
 * reapUsedAudio in src/audio.ts had exactly that bug.
 *
 * `embedded_at` is written only after the upsert succeeds, so a failure part
 * way through leaves the rest to be picked up next time rather than marking
 * work that did not happen.
 */
export async function backfillClipIndex(env: Env, limit = 200): Promise<number> {
  if (!env.VECTORIZE) return 0;

  /*
   * ACROSS EVERYONE, not per user, and that is the whole point.
   *
   * The first version of this took a userId and the sweep called it for each
   * user it already had in hand — but that list is users with a job queued or
   * running, so somebody with a full library and nothing in flight would never
   * have been indexed at all. Whose clip it is matters when SEARCHING, where
   * it is a metadata filter. It does not matter when writing.
   */
  const { results } = await env.DB
    .prepare(
      `SELECT c.id, c.user_id, c.source_id, c.start_ms, c.end_ms, c.quote, s.title AS source_title
         FROM v2_clips c JOIN sources s ON s.id = c.source_id
        WHERE c.deleted_at IS NULL AND c.embedded_at IS NULL
        ORDER BY c.created_at ASC LIMIT ?`,
    )
    .bind(limit)
    .all<IndexableClip>();

  const clips = results ?? [];
  if (!clips.length) return 0;

  const written = await indexClips(env, clips);
  if (!written) return 0;

  const now = Date.now();
  const stmt = env.DB.prepare(`UPDATE v2_clips SET embedded_at=? WHERE id=?`);
  await env.DB.batch(clips.map((c) => stmt.bind(now, c.id)));
  return written;
}

/**
 * Forgets clips that are gone.
 *
 * A deleted clip left in the index comes back as a search hit whose row no
 * longer exists, and searchMeaning drops it — so the user sees a short page of
 * results with no explanation of what happened to the rest.
 */
export async function forgetClips(env: Env, ids: string[]): Promise<void> {
  if (!env.VECTORIZE || !ids.length) return;
  await env.VECTORIZE.deleteByIds(ids).catch(() => {
    /* An index that never had them is not a problem worth failing a delete
       for; the row is already gone and that is what the user asked for. */
  });
}

/**
 * Drops vectors for clips that have been deleted.
 *
 * Symmetric with the backfill and run from the same sweep, so the index
 * converges on the library from both directions. Without it a deleted clip
 * stays a search hit whose row no longer resolves, and searchMeaning quietly
 * drops it — the user gets a short page of results and no account of what
 * happened to the rest.
 *
 * `embedded_at` is cleared too, so a clip that is restored from the bin gets
 * picked up by the backfill again rather than being permanently invisible.
 */
export async function reapClipIndex(env: Env, limit = 200): Promise<number> {
  if (!env.VECTORIZE) return 0;

  /* Across everyone, for the same reason as the backfill above. */
  const { results } = await env.DB
    .prepare(
      `SELECT id FROM v2_clips
        WHERE deleted_at IS NOT NULL AND embedded_at IS NOT NULL
        ORDER BY deleted_at ASC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();

  const ids = (results ?? []).map((r) => r.id);
  if (!ids.length) return 0;

  await forgetClips(env, ids);
  const stmt = env.DB.prepare(`UPDATE v2_clips SET embedded_at=NULL WHERE id=?`);
  await env.DB.batch(ids.map((id) => stmt.bind(id)));
  return ids.length;
}
