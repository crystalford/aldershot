/**
 * THREADS — the topics running through somebody's footage.
 *
 * `v2_threads` and `v2_clip_threads` have existed since the library did, and
 * NOTHING HAS EVER WRITTEN A ROW. `listThreads` returns an empty array on
 * every account, so the room's thread chips never appear, `summaryLine` never
 * reaches its third clause, and every moment card renders with
 * `thread_name: null`. The read half was built and the write half was not —
 * the same shape of hole `src/embeddings.ts` opens by describing.
 *
 * This is the write half.
 *
 * ── Where the design says they come from ──────────────────────────────────
 * 11-BUILD-ORDER.md's acceptance line: "the thread chips come from parent
 * labels". The glossary: "Strand / thread — a topic running through the
 * footage. 'Strand' in code (footage.js), 'thread' in copy." In the
 * prototype every clip arrives carrying its strand, because a design hands
 * itself the answer; the build has to work it out.
 *
 * ── Deterministic first ───────────────────────────────────────────────────
 * Two steps, and only one of them can involve a model:
 *
 *   GROUPING is a measurement. Moments already have embeddings — the same
 *   vectors meaning-search runs on — so grouping them is cosine similarity
 *   and average linkage, not a judgement. It is a pure function of the
 *   vectors, it is identical on two runs, and it is tested with synthetic
 *   vectors and no model at all.
 *
 *   NAMING is a measurement too, nearly always. A topic that runs through
 *   the footage runs through it IN WORDS, and the words are the user's own —
 *   invariant 10. So the name is the phrase that recurs across the group and
 *   is rare in the rest of the library, which is tf-idf with the group as the
 *   query. The `name` capability is the fallback for a group that shares a
 *   subject without sharing a phrase, not the default.
 *
 * ── What is NOT measured here ─────────────────────────────────────────────
 * JOIN_AT. See its comment: the threshold wants a real library to set it,
 * this machine has none, and a number invented and described as tuned would
 * be worse than a number invented and described as invented.
 */

import type { Env } from "./env.ts";
import { embed } from "./embeddings.ts";
import { tokens } from "./bm25.ts";
import { ulid } from "./id.ts";

export interface ThreadableMoment {
  id: string;
  quote: string;
  source_id: string;
}

export interface Group {
  /** Member moment ids, most central first. */
  members: string[];
  /** Cosine to the group's centroid, per member, in `members` order. */
  confidence: number[];
}

export interface NamedGroup extends Group {
  name: string;
  /** Whether the words came from the footage or from the model. */
  named: "phrase" | "model";
}

/**
 * HOW CLOSE TWO MOMENTS HAVE TO BE TO SHARE A THREAD.
 *
 * UNMEASURED, AND SAID SO. The honest way to set this is to run it over a
 * real library, look at the groups, and move it until they stop being wrong
 * in the two directions it can be wrong: too low and every moment about a
 * house joins every moment about money, too high and a topic splits into
 * four threads nobody would name differently.
 *
 * 0.62 is where cosine over bge-style sentence embeddings usually separates
 * "about the same thing" from "about the same person" — a starting point,
 * not a finding. `npm run threads -- --dry` prints the groups this produces
 * over your own library without writing anything, which is how it gets set.
 *
 * Two things stop a wrong value here from being quiet: a group of one is
 * discarded rather than named, and the name has to be a phrase the group
 * actually shares, so a group that joined for no reason usually cannot be
 * named at all and drops out.
 */
export const JOIN_AT = 0.62;

/**
 * A thread is a topic that RUNS THROUGH the footage, so it has to happen
 * more than once. One moment is a moment.
 */
export const MIN_MEMBERS = 2;

/**
 * The newest N moments. O(n²) similarity over a few thousand rows is
 * milliseconds and a few megabytes; over a 3,000-hour library it is neither,
 * and threading the newest slice of a huge archive is the right answer
 * anyway — it is what "as your archive grows" means on the front door.
 */
export const MAX_MOMENTS = 1500;

/** A unit vector, so cosine is a dot product. A zero vector stays zero. */
export function unit(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n === 0 ? v.slice() : v.map((x) => x / n);
}

/** Cosine of two vectors that have already been through `unit`. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * Average-linkage agglomerative clustering, stopping at JOIN_AT.
 *
 * Average linkage rather than single or complete, for the reason it is the
 * usual choice on text: single linkage chains — A is close to B, B to C, and
 * a thread ends up holding two topics that share nothing — and complete
 * linkage splits a real topic the moment one member is phrased oddly.
 *
 * DETERMINISTIC, INCLUDING THE TIES. Two identical runs must produce the
 * same threads or nothing downstream can be reasoned about, and float
 * arithmetic produces exact ties more often than it looks like it should.
 * Pairs are compared by similarity and then by the ids themselves.
 */
export function cluster(
  items: Array<{ id: string; vec: number[] }>,
  joinAt = JOIN_AT,
): Group[] {
  const vecs = items.map((it) => unit(it.vec));
  /* Each live cluster is a list of indices into `items`. */
  let live: number[][] = items.map((_, i) => [i]);

  const sim = (a: number[], b: number[]): number => {
    let s = 0;
    for (const i of a) for (const j of b) s += dot(vecs[i], vecs[j]);
    return s / (a.length * b.length);
  };

  for (;;) {
    let best = -2;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const s = sim(live[i], live[j]);
        if (s < joinAt) continue;
        /* The tie-break: the pair whose smallest member id is smallest. Any
           total order would do; what matters is that there IS one. */
        if (s > best || (s === best && low(items, live[i], live[j]) < low(items, live[bi], live[bj]))) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    live[bi] = [...live[bi], ...live[bj]];
    live = live.filter((_, k) => k !== bj);
  }

  const out: Group[] = [];
  for (const members of live) {
    if (members.length < MIN_MEMBERS) continue;
    const centroid = unit(
      vecs[members[0]].map((_, d) => members.reduce((s, i) => s + vecs[i][d], 0) / members.length),
    );
    const scored = members
      .map((i) => ({ id: items[i].id, c: dot(vecs[i], centroid) }))
      /* Most central first, so a thread's sample quote is its most typical
         one rather than whichever row came back first. */
      .sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : 1));
    out.push({ members: scored.map((s) => s.id), confidence: scored.map((s) => s.c) });
  }
  /* Biggest thread first — the room lists them in that order. */
  return out.sort((a, b) => b.members.length - a.members.length || (a.members[0] < b.members[0] ? -1 : 1));
}

const low = (items: Array<{ id: string }>, a: number[] | undefined, b: number[] | undefined): string => {
  const ids = [...(a ?? []), ...(b ?? [])].map((i) => items[i].id);
  return ids.length ? ids.sort()[0] : "￿";
};

/**
 * WHAT TO CALL A GROUP, from the words in it.
 *
 * The phrase that most of the group says and the rest of the library does
 * not. One to three words, taken from the raw word sequence rather than the
 * stopped tokens, because the names in the design are "why leave", "what it
 * costs", "the house" — half stopword each, and a namer that could not
 * produce them is a namer aimed at the wrong target.
 *
 * It must still carry at least one real word, or "of the" wins everything.
 */
export const MAX_WORDS = 3;

const words = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9']+/).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);

/** Every 1..MAX_WORDS run of words that carries at least one content word. */
export function phrases(text: string): string[] {
  const w = words(text);
  const content = new Set(tokens(text));
  const out = new Set<string>();
  for (let n = 1; n <= MAX_WORDS; n += 1) {
    for (let i = 0; i + n <= w.length; i += 1) {
      const run = w.slice(i, i + n);
      if (!run.some((x) => content.has(x))) continue;
      out.add(run.join(" "));
    }
  }
  return [...out];
}

/**
 * The name, or null when the group shares a subject but not a phrase.
 *
 * Scored as `how much of this group says it` × `how rare it is elsewhere`,
 * which is tf-idf with the group as the document. Two requirements that are
 * not score:
 *
 *  - It has to recur. A phrase in one member of a group of five is that
 *    member's phrase, not the thread's.
 *  - Longer wins a tie. "what it costs" and "costs" can score the same, and
 *    the longer one is the one a person would have written down.
 */
export function nameFromPhrases(
  groupQuotes: string[],
  libraryQuotes: string[],
): string | null {
  if (groupQuotes.length < 2) return null;
  const inGroup = new Map<string, number>();
  for (const q of groupQuotes) for (const p of phrases(q)) inGroup.set(p, (inGroup.get(p) ?? 0) + 1);

  const elsewhere = new Map<string, number>();
  for (const q of libraryQuotes) {
    const seen = new Set(phrases(q));
    for (const p of seen) elsewhere.set(p, (elsewhere.get(p) ?? 0) + 1);
  }

  const N = Math.max(libraryQuotes.length, 1);
  let best: { phrase: string; score: number } | null = null;
  for (const [phrase, n] of inGroup) {
    if (n < 2) continue;
    const df = elsewhere.get(phrase) ?? n;
    const idf = Math.log(1 + N / df);
    const score = (n / groupQuotes.length) * idf;
    const beats =
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 &&
        (phrase.split(" ").length > best.phrase.split(" ").length ||
          (phrase.split(" ").length === best.phrase.split(" ").length && phrase < best.phrase)));
    if (beats) best = { phrase, score };
  }
  return best ? best.phrase : null;
}

/**
 * Two threads may not share a name.
 *
 * The chips are the only handle a person has on a thread, and two chips
 * reading "the house" are two things they cannot tell apart. The second one
 * takes the next best phrase it can; if it has none, it is dropped rather
 * than numbered — "the house 2" is a label, not a name.
 */
export function distinct(named: Array<{ name: string } & Group>): Array<{ name: string } & Group> {
  const seen = new Set<string>();
  const out: Array<{ name: string } & Group> = [];
  for (const g of named) {
    if (seen.has(g.name)) continue;
    seen.add(g.name);
    out.push(g);
  }
  return out;
}

/**
 * Replace this user's threads with these.
 *
 * REPLACE, not merge. A thread is derived from the library the way a cut is
 * derived from its rules (invariant 1) — it is not a thing a person made and
 * owns, it is a reading of what they have, and a reading that accumulated
 * stale rows would start disagreeing with the footage. Nothing is lost: the
 * moments are untouched, and re-running produces the threads again.
 */
export async function writeThreads(
  db: D1Database,
  userId: string,
  groups: Array<{ name: string } & Group>,
): Promise<number> {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM v2_clip_threads WHERE thread_id IN (SELECT id FROM v2_threads WHERE user_id = ?)`,
      )
      .bind(userId),
    db.prepare(`DELETE FROM v2_threads WHERE user_id = ?`).bind(userId),
  ];
  const now = Date.now();
  for (const g of groups) {
    const id = ulid();
    stmts.push(
      db
        .prepare(
          `INSERT INTO v2_threads (id, user_id, name, summary, clip_count, created_at)
           VALUES (?, ?, ?, NULL, ?, ?)`,
        )
        .bind(id, userId, g.name, g.members.length, now),
    );
    g.members.forEach((clipId, i) => {
      stmts.push(
        db
          .prepare(
            `INSERT INTO v2_clip_threads (clip_id, thread_id, confidence) VALUES (?, ?, ?)`,
          )
          .bind(clipId, id, g.confidence[i]),
      );
    });
  }
  await db.batch(stmts);
  return groups.length;
}

/**
 * The whole pass: read the moments, group them, name them, write them.
 *
 * Returns what it wrote, so the caller can say so. An account with too
 * little footage to have a topic running through it gets zero threads and no
 * error — that is the correct answer, not a failure.
 */
export interface RethreadOptions {
  /** Fallback namer for a group that shares a subject but not a phrase. */
  nameGroup?: (quotes: string[]) => Promise<string | null>;
  /**
   * THE EMBEDDER, INJECTABLE — so the whole pass can be run end to end
   * without a model.
   *
   * Everything in this file is a pure function except the one call that
   * turns quotes into vectors, and a module whose only untested path is the
   * one that wires the tested parts together is a module where the wiring is
   * the thing that breaks. The default is the real one.
   */
  embedder?: (texts: string[]) => Promise<number[][] | null>;
}

export async function rethread(
  env: Env,
  userId: string,
  opts: RethreadOptions = {},
): Promise<{ threads: number; moments: number; unnamed: number }> {
  const { nameGroup, embedder } = opts;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.quote, c.source_id
       FROM v2_clips c
       JOIN sources s ON s.id = c.source_id
      WHERE s.user_id = ? AND c.deleted_at IS NULL AND c.kept = 1
      ORDER BY c.created_at DESC
      LIMIT ?`,
  )
    .bind(userId, MAX_MOMENTS)
    .all<ThreadableMoment>();
  const moments = results ?? [];
  if (moments.length < MIN_MEMBERS) return { threads: 0, moments: moments.length, unnamed: 0 };

  const vecs = await (embedder ?? ((t: string[]) => embed(env, t)))(moments.map((m) => m.quote));
  /* No embedder configured is not a failure: threads are an enrichment, and
     a library without them is the library this product shipped with. */
  if (!vecs || vecs.length !== moments.length) {
    return { threads: 0, moments: moments.length, unnamed: 0 };
  }

  const groups = cluster(moments.map((m, i) => ({ id: m.id, vec: vecs[i] })));
  const quoteOf = new Map(moments.map((m) => [m.id, m.quote]));
  const library = moments.map((m) => m.quote);

  const named: Array<{ name: string } & Group> = [];
  let unnamed = 0;
  for (const g of groups) {
    const quotes = g.members.map((id) => quoteOf.get(id) ?? "");
    let name = nameFromPhrases(quotes, library);
    if (!name && nameGroup) name = await nameGroup(quotes);
    if (!name) {
      /* A group nobody can name is a group nobody can use. Dropped, and
         counted, so `npm run threads` can say how often it happens — that
         number is how you find out JOIN_AT is wrong. */
      unnamed += 1;
      continue;
    }
    named.push({ ...g, name });
  }

  const final = distinct(named);
  const wrote = await writeThreads(env.DB, userId, final);
  return { threads: wrote, moments: moments.length, unnamed: unnamed + (named.length - final.length) };
}

/**
 * Whose threads have fallen behind their footage.
 *
 * IN THE SWEEP, NOT AT THE THREE PLACES CLIPS ARE WRITTEN. The meaning index
 * sits there for the reason its comment gives — "a call site you have to
 * remember is one a fourth call site will forget" — and threads have exactly
 * the same shape of problem: a pass, a brief import and a manual keep all
 * make moments, and a fourth way of making them will arrive.
 *
 * STALE IN BOTH DIRECTIONS. A clip created after the threads were written is
 * the obvious one. A clip DELETED after is the one that would be missed: the
 * library shrank, nothing was created, and a thread goes on claiming three
 * moments when one of them is gone. Both are a timestamp against the newest
 * thread row, which is already stored.
 *
 * An account with no threads at all and some moments is stale by definition —
 * the comparison is against zero.
 */
export const USERS_PER_SWEEP = 3;

export async function staleThreadUsers(
  db: D1Database,
  limit = USERS_PER_SWEEP,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT s.user_id AS user_id
         FROM v2_clips c
         JOIN sources s ON s.id = c.source_id
        GROUP BY s.user_id
       HAVING MAX(MAX(COALESCE(c.created_at, 0)), MAX(COALESCE(c.deleted_at, 0)))
              > COALESCE((SELECT MAX(t.created_at) FROM v2_threads t WHERE t.user_id = s.user_id), 0)
        ORDER BY user_id
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ user_id: string }>();
  return (results ?? []).map((r) => r.user_id);
}
