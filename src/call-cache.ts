/**
 * CONTENT-ADDRESSED CACHING — invariant 5, where it still leaks.
 *
 * "Footage is read and charged once; editing is free." Transcription already
 * obeys it: a source is read once and re-cutting costs nothing. Model calls
 * did not. Re-run a pass over the same transcript with the same brief and the
 * same model, and the whole thing was paid for again — which is the one
 * sentence on the pricing page that was not quite true.
 *
 * Prompt caching (src/llm.ts) made the second read cheaper. This makes an
 * IDENTICAL call free, which is a different claim: not a discounted prefix
 * but the same answer, returned without asking anybody.
 *
 * ONLY A CALL WITH ONE RIGHT ANSWER MAY BE CACHED, and this is the whole
 * design. `src/models.ts` pins the capabilities whose answer is a decision to
 * temperature 0 — judge, classify, arrange — and leaves `direct` and `name`
 * sampled, because they write prose and a second opinion is the point. A
 * cache over a sampled capability would freeze the first draft for ever and
 * make "try again" a lie. So cacheability is not a flag somebody sets here;
 * it is read off the temperature, and the two cannot disagree.
 *
 * AND A HIT IS NOT METERED. Charging for a call nobody made would break
 * invariant 5 from the other side, so a hit records zero cost — and records
 * the hit, because what caching saved is a number the owner's cost view
 * should be able to show.
 *
 * THE KEY IS EVERYTHING THAT CHANGES THE ANSWER. The model, the effort, the
 * temperature, the prompt version, the system text, the user text and the
 * schema. Leave any one out and the cache answers a different question with
 * a straight face, which is worse than no cache at all — so the key is built
 * from a single object and `keyFor` is tested against each field in turn.
 */

import type { Resolved } from "./models.ts";

/**
 * How long a cached answer stands.
 *
 * Thirty days, which is the same shelf life as a Scout metadata refresh and
 * chosen for the same reason: long enough that a month of editing one cut is
 * free, short enough that a row cannot outlive the prompt that made it by
 * much. A prompt version change evicts it immediately anyway, because the
 * version is in the key.
 */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Addressable {
  capability: string;
  /** The resolved model, whose id, effort and temperature all matter. */
  model: Resolved;
  /**
   * The caller's own version string.
   *
   * REQUIRED, not optional. A prompt that changed without its version
   * changing would serve answers to the old question for a month, and the
   * only way to make that impossible is to leave the caller no way to omit
   * it. src/judge.ts already exports JUDGE_VERSION for exactly this.
   */
  promptVersion: string;
  system: string;
  user: string;
  schema?: Record<string, unknown>;
}

/**
 * MAY THIS CALL BE CACHED?
 *
 * Read off the temperature rather than declared. A capability pinned to 0
 * has one right answer and returns it every time; one left sampled does not,
 * and caching it would freeze a draft. Workers AI is the only provider that
 * takes a temperature, so an Anthropic call — which cannot be pinned at all,
 * the sampling parameters having been removed — is never cached.
 *
 * That last part is a real limit and worth saying plainly: the better model
 * is the one whose answers cannot be reused.
 */
export const cacheable = (model: Resolved): boolean =>
  model.provider === "workers-ai" && model.temperature === 0;

const enc = new TextEncoder();

/**
 * The address of a call: a hash of everything that decides its answer.
 *
 * Fields are joined with a separator that cannot occur in any of them, so
 * two different calls cannot collide by one field ending where the next
 * begins — "ab" + "c" and "a" + "bc" are the same string and must not be the
 * same key.
 */
export async function keyFor(a: Addressable): Promise<string> {
  const parts = [
    a.capability,
    a.model.id,
    a.model.effort ?? "",
    String(a.model.temperature ?? ""),
    a.promptVersion,
    a.system,
    a.user,
    a.schema ? JSON.stringify(a.schema) : "",
  ];
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(parts.join("\u0000")));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Hit {
  raw: unknown;
  /** When the answer was made, not when it was read. */
  madeAt: number;
}

/**
 * Look one up.
 *
 * A READ FAILURE IS A MISS, never an error: the same rule as the spend cap
 * and the breaker. If the cache cannot be reached, the honest answer is to
 * do the work, not to refuse it because the bookkeeping is down.
 */
export async function lookup(db: D1Database, key: string, now = Date.now()): Promise<Hit | null> {
  try {
    const r = await db
      .prepare("SELECT body, created_at FROM call_cache WHERE key = ?")
      .bind(key)
      .first<{ body: string; created_at: number }>();
    if (!r) return null;
    const madeAt = Number(r.created_at) || 0;
    /* Expired rows are left to the sweep rather than deleted on read — a
       read that writes is a read that can fail on a replica. */
    if (now - madeAt > TTL_MS) return null;
    return { raw: JSON.parse(r.body) as unknown, madeAt };
  } catch {
    return null;
  }
}

/** The most bytes one answer may take in the cache. */
export const MAX_BODY = 64 * 1024;

/**
 * Put one in.
 *
 * Best effort, and bounded: an answer bigger than the ceiling is not stored
 * rather than stored and never read, because a row that cannot be used is a
 * row somebody pays to keep.
 */
export async function store(
  db: D1Database,
  key: string,
  a: Addressable,
  raw: unknown,
  now = Date.now(),
): Promise<void> {
  try {
    const body = JSON.stringify(raw);
    if (body.length > MAX_BODY) return;
    await db
      .prepare(
        "INSERT INTO call_cache (key, capability, model, prompt_version, body, hits, created_at) " +
          "VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(key) DO NOTHING",
      )
      .bind(key, a.capability, a.model.id, a.promptVersion, body, now)
      .run();
  } catch {
    /* A cache that cannot write is a cache that does not help, which is the
       safe direction: the work happens and is charged, as before. */
  }
}

/**
 * Count a hit, so what caching saved is a number and not a belief.
 *
 * Separate from `lookup` because the read must not fail on a write, and
 * because the count is useful even when the row is not returned.
 */
export async function countHit(db: D1Database, key: string): Promise<void> {
  try {
    await db.prepare("UPDATE call_cache SET hits = hits + 1 WHERE key = ?").bind(key).run();
  } catch {
    /* Nothing depends on this number being exact. */
  }
}

export interface Saved {
  rows: number;
  hits: number;
}

/** What the cache has done, for the owner's cost view. */
export async function saved(db: D1Database): Promise<Saved> {
  try {
    const r = await db
      .prepare("SELECT COUNT(*) AS rows, COALESCE(SUM(hits), 0) AS hits FROM call_cache")
      .first<{ rows: number; hits: number }>();
    return { rows: Number(r?.rows) || 0, hits: Number(r?.hits) || 0 };
  } catch {
    return { rows: 0, hits: 0 };
  }
}
