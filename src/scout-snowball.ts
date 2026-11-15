/**
 * SNOWBALL: what was verified decides what to look for next.
 *
 * Spec 18 section 3.8. The step that makes a run compound instead of
 * repeating itself, and the one that made Scout worth building: round one can
 * only ask what the brief already knew to ask. Round two can ask about the
 * phrase four verified clips turned out to share, the critic channel that keeps
 * appearing, the date three finds cluster on, and the compilation that has to
 * come from somewhere.
 *
 * FIVE KINDS OF SEED, and they are five different kinds of thing. The spec's
 * list: recurring phrases, named critics, incident dates to find the original
 * VOD, compilations to trace back, and topics that co-occur with the
 * behaviour. Each yields one to three queries tagged `seed`.
 *
 * DETERMINISTIC, AND THAT IS THE POINT. Every seed here is a count or a match
 * over rows we already hold — a phrase in three verified quotes, a channel on
 * three sources, three finds inside a fortnight. A model asked "what should we
 * search next?" produces plausible queries about the subject in general; this
 * produces queries about what the evidence actually turned out to be. The
 * convention says it plainly: if it can be a count, it is not a model call.
 *
 * AND IT IS WHERE A RUN GOES IN CIRCLES IF NOBODY STOPS IT. A seed derived
 * from a find, searched, returning the same find, seeding again — that is a
 * loop that spends the whole budget on one incident. So a seed has to be NEW
 * (not already tried, and that set is carried in), and strong enough to be
 * worth a call: the thresholds here are the difference between snowballing and
 * rolling downhill.
 */

import type { Family } from "./scout-adapters.ts";
import { normTokens } from "./scout-verify.ts";
import type { LedgerRow } from "./scout-reduce.ts";

export const SEED_KINDS = ["phrase", "critic", "date", "trace", "topic"] as const;
export type SeedKind = (typeof SEED_KINDS)[number];

export interface Seed {
  kind: SeedKind;
  /** The thing itself: the phrase, the channel, the date, the source id. */
  value: string;
  /** How many verified rows put it there. The reason it is worth a call. */
  support: number;
  /** One line a person can read on the board. */
  why: string;
  /** The queries it produces, 1 to 3. */
  queries: string[];
}

/* ── Thresholds ─────────────────────────────────────────────────────────── */

/**
 * How many verified rows must share a thing before it is a seed.
 *
 * TWO, NOT ONE, for every kind. A phrase in one quote is a sentence somebody
 * said; a phrase in two separate verified finds is how the subject talks about
 * this. One of anything is the find we already have, and seeding from it sends
 * a query after the thing it came from.
 */
export const MIN_SUPPORT = 2;
/** Phrase lengths worth searching. One word is a word; five is a sentence. */
export const PHRASE_MIN = 2;
export const PHRASE_MAX = 5;
/** Distinctive words a quote needs before it can be searched for. */
export const TRACE_MIN_WORDS = 3;
/** How close together finds must fall to be the same incident. */
export const INCIDENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Seeds per round. A cap, because each one is one to three paid searches. */
export const MAX_SEEDS = 8;

/**
 * Words too common to be anybody's vocabulary.
 *
 * Shorter than a stopword list on purpose, for the reason harvestVocabulary
 * gives: a long list looks thorough and quietly removes the thing being
 * searched for. These are the ones that actually recur across unrelated
 * quotes.
 */
const COMMON = new Set(
  ("i you he she it we they me him her them my your his their this that these those a an the and or but so " +
    "is are was were be been being am do does did doing have has had having will would can could should " +
    "of to in on at for with from by about into out up down over under again then than as if not no yes " +
    "what when where who why how all any some just like get got go going know think say said right okay " +
    "one two three now here there very really much many more most")
    .split(" "),
);

/* ── Phrases ────────────────────────────────────────────────────────────── */

/**
 * Phrases that turn up in more than one verified quote.
 *
 * COUNTED BY ROW, NOT BY OCCURRENCE — the same rule harvestVocabulary follows,
 * for the same reason: a catchphrase repeated six times inside one outburst is
 * one outburst, and counting occurrences would make the loudest single find
 * look like a pattern.
 *
 * A phrase made only of common words is dropped even when it recurs, because
 * "i do not think" recurs in everything and finds everything.
 */
export function phraseSeeds(rows: LedgerRow[], subject: string): Seed[] {
  const byPhrase = new Map<string, Set<string>>();

  for (const r of rows) {
    const tokens = normTokens(r.quoteExact);
    const seenInThisRow = new Set<string>();
    for (let n = PHRASE_MIN; n <= PHRASE_MAX; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        /*
         * A PHRASE MAY NOT BEGIN AND END ON FILLER. "i do not think" finds the
         * whole internet; "the gremlin is" is a fragment of a sentence rather
         * than a name for anything. Filler INSIDE one is fine and necessary —
         * "do not read chat" is how somebody talks.
         *
         * A separate `gram.every(COMMON)` test used to sit above this against
         * all-filler phrases. It could not fire: if every word is filler then
         * both ends are, so this line had already rejected it.
         */
        if (COMMON.has(gram[0]) && COMMON.has(gram[n - 1])) continue;
        seenInThisRow.add(gram.join(" "));
      }
    }
    for (const p of seenInThisRow) {
      const at = byPhrase.get(p) ?? new Set<string>();
      at.add(r.id);
      byPhrase.set(p, at);
    }
  }

  const seeds: Seed[] = [];
  for (const [phrase, ids] of byPhrase) {
    if (ids.size < MIN_SUPPORT) continue;
    seeds.push({
      kind: "phrase",
      value: phrase,
      support: ids.size,
      why: `he says this in ${ids.size} separate verified moments`,
      queries: [`${subject} "${phrase}"`, `"${phrase}"`].filter((q) => q.trim() !== '""'),
    });
  }

  /* A longer phrase that is only ever said inside a longer one, with the same
     support, is the same phrase — keep the longer, which is what people type. */
  return dropSwallowed(seeds);
}

/** Drops a seed whose value sits inside a longer seed of the same support. */
export function dropSwallowed(seeds: Seed[]): Seed[] {
  const sorted = [...seeds].sort((a, b) => b.value.length - a.value.length);
  const kept: Seed[] = [];
  for (const s of sorted) {
    const inside = kept.some(
      (k) => k.kind === s.kind && k.support === s.support && k.value.includes(s.value),
    );
    if (!inside) kept.push(s);
  }
  return kept;
}

/* ── Critics ────────────────────────────────────────────────────────────── */

/**
 * Channels that keep turning out to hold the evidence.
 *
 * A channel on two verified finds is somebody who covers this subject, and
 * their back catalogue is the highest-yield place left to look — the whole
 * point of the `critic_channel` term kind in the lexicon. The query is the
 * channel plus the subject, not the channel alone, or it returns their
 * entire output.
 */
export function criticSeeds(rows: LedgerRow[], subject: string): Seed[] {
  const byChannel = new Map<string, { sources: Set<string>; rows: Set<string>; name: string }>();

  for (const r of rows) {
    const name = (r.sourceChannel ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const at = byChannel.get(key) ?? { sources: new Set<string>(), rows: new Set<string>(), name };
    at.sources.add(r.sourceId);
    at.rows.add(r.id);
    byChannel.set(key, at);
  }

  const seeds: Seed[] = [];
  for (const { sources, name } of byChannel.values()) {
    /* TWO SEPARATE SOURCES, not two rows. Two finds in one video is one video
       by somebody who may never mention the subject again; two videos is a
       channel that covers them. */
    if (sources.size < MIN_SUPPORT) continue;
    seeds.push({
      kind: "critic",
      value: name,
      support: sources.size,
      why: `${sources.size} of the sources that held evidence came from this channel`,
      queries: [`${name} ${subject}`, `${name} ${subject} compilation`],
    });
  }
  return seeds;
}

/* ── Dates ──────────────────────────────────────────────────────────────── */

/** `2026-03-14`, which is what a search box takes. */
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Dates that several finds cluster on — an incident with a day attached.
 *
 * The purpose from the spec is specific: *to find the original VOD*. Three
 * clips from the same fortnight are three clippers reacting to one stream, and
 * that stream is the thing nobody has yet. So the queries name the date and
 * ask for the stream, not for more clips of it.
 */
export function dateSeeds(rows: LedgerRow[], subject: string): Seed[] {
  const dated = rows
    .filter((r) => Number.isFinite(r.publishedAt))
    .sort((a, b) => (a.publishedAt as number) - (b.publishedAt as number));
  if (dated.length < MIN_SUPPORT) return [];

  const clusters: LedgerRow[][] = [];
  for (const r of dated) {
    const last = clusters[clusters.length - 1];
    if (last && (r.publishedAt as number) - (last[0].publishedAt as number) <= INCIDENT_WINDOW_MS) {
      last.push(r);
      continue;
    }
    clusters.push([r]);
  }

  const seeds: Seed[] = [];
  for (const cluster of clusters) {
    /* Counted by SOURCE: four clips from one uploader on one day is one
       uploader, and the incident it points at may not exist. */
    const sources = new Set(cluster.map((r) => r.sourceId));
    if (sources.size < MIN_SUPPORT) continue;
    const day = isoDay(cluster[0].publishedAt as number);
    seeds.push({
      kind: "date",
      value: day,
      support: sources.size,
      why: `${sources.size} separate sources carry evidence from around ${day} — there is probably a stream behind it`,
      queries: [`${subject} ${day}`, `${subject} full stream ${day.slice(0, 7)}`, `${subject} vod ${day}`],
    });
  }
  return seeds;
}

/* ── Traces ─────────────────────────────────────────────────────────────── */

/**
 * Compilations whose original has not been found.
 *
 * A compilation is evidence of an incident and not evidence of a source: the
 * moment happened in something, and until that something is found the row is a
 * TRACE on the board rather than a citation. One is enough — unlike every
 * other seed kind — because an untraced compilation is a known hole rather
 * than a pattern needing corroboration.
 */
export function traceSeeds(rows: LedgerRow[], subject: string): Seed[] {
  const seeds: Seed[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (r.sourceKind !== "compilation" && r.sourceKind !== "reupload") continue;
    if (r.originalOf) continue;
    if (seen.has(r.sourceId)) continue;
    seen.add(r.sourceId);

    /*
     * The distinctive words of the quote are what find the original: a
     * compilation's own title is about the compilation.
     *
     * THREE OF THEM AT LEAST. One distinctive word is a word — "well", and a
     * search for it returns the web. A quote with fewer than three words that
     * are not filler cannot be found by its words, and a seed that raises a
     * query which cannot work is worse than no seed: the board shows a search
     * that was run and found nothing, where the truth is that the quote was
     * not searchable.
     */
    const words = normTokens(r.quoteExact).filter((w) => !COMMON.has(w) && w.length > 2);
    const distinctive = words.length >= TRACE_MIN_WORDS ? words.slice(0, 6).join(" ") : "";
    const queries = [`${subject} "${distinctive}"`];
    if (r.publishedAt) queries.push(`${subject} full stream before ${isoDay(r.publishedAt)}`);

    seeds.push({
      kind: "trace",
      value: r.sourceId,
      support: 1,
      why: r.sourceTitle
        ? `"${r.sourceTitle}" is a ${r.sourceKind} and the original has not been found`
        : `a ${r.sourceKind} whose original has not been found`,
      queries: distinctive ? queries : [],
    });
  }
  return seeds.filter((s) => s.queries.length > 0);
}

/* ── Topics ─────────────────────────────────────────────────────────────── */

/**
 * What the behaviour keeps happening AROUND.
 *
 * The spec's "games or topics that co-occur with the behaviour". Read off the
 * source titles rather than the quotes, because a title says what the stream
 * was and a quote says what was said in it. If the outburst keeps happening
 * during one game, that game is where to look for more.
 */
export function topicSeeds(rows: LedgerRow[], subject: string): Seed[] {
  const byWord = new Map<string, Set<string>>();
  const subjectWords = new Set(normTokens(subject));

  for (const r of rows) {
    const title = normTokens(r.sourceTitle ?? "");
    for (const w of new Set(title)) {
      if (COMMON.has(w) || subjectWords.has(w) || w.length < 3) continue;
      if (/^\d+$/.test(w)) continue;
      const at = byWord.get(w) ?? new Set<string>();
      at.add(r.sourceId);
      byWord.set(w, at);
    }
  }

  const seeds: Seed[] = [];
  for (const [word, sources] of byWord) {
    if (sources.size < MIN_SUPPORT) continue;
    seeds.push({
      kind: "topic",
      value: word,
      support: sources.size,
      why: `${sources.size} of the sources with evidence in them are about this`,
      queries: [`${subject} ${word}`],
    });
  }
  return seeds;
}

/* ── Putting a round together ───────────────────────────────────────────── */

export interface SnowballInput {
  /** Only VERIFIED rows seed. A paraphrase is somebody's near-miss. */
  rows: LedgerRow[];
  subject: string;
  /** Normalised queries already issued this run, so a seed cannot repeat one. */
  alreadyTried?: Iterable<string>;
  /** Seeds raised in earlier rounds, so the same seed is not raised twice. */
  alreadySeeded?: Iterable<string>;
  max?: number;
}

export interface Snowball {
  seeds: Seed[];
  /** The queries to run, in seed order. Every one tagged `seed`. */
  queries: Array<{ family: Family; query: string; seedKind: SeedKind }>;
  /** Seeds found and set aside, with the reason. For the diligence log. */
  skipped: Array<{ kind: SeedKind; value: string; why: string }>;
}

/** The key a seed is remembered by across rounds. */
export const seedKey = (kind: SeedKind, value: string) => kind + "\u0000" + value.trim().toLowerCase();

/**
 * This round's seeds, strongest first, capped.
 *
 * ONLY VERIFIED ROWS SEED. A paraphrase is a near-miss a person has not
 * confirmed, and seeding from one spends real searches on a phrase that may
 * not have been said. A rejected row is a quote that is not in the source, and
 * seeding from it would send the run after a fabrication — then verify
 * everything it found against it, and record the whole branch as a dead end.
 *
 * Ordered by support, then by kind, so the cap keeps the best-attested. `trace`
 * outranks its support of one deliberately: an untraced compilation is a known
 * hole in the provenance chain, and leaving it to be cut by the cap is how a
 * board ends up citing a compilation as a source.
 */
export function snowball(input: SnowballInput): Snowball {
  const subject = input.subject.trim();
  const verified = input.rows.filter((r) => r.verify === "verified");
  const tried = new Set([...(input.alreadyTried ?? [])].map((q) => normTokens(q).join(" ")));
  const seededBefore = new Set(input.alreadySeeded ?? []);
  const skipped: Snowball["skipped"] = [];

  if (!subject || !verified.length) return { seeds: [], queries: [], skipped };

  const all = [
    ...traceSeeds(verified, subject),
    ...phraseSeeds(verified, subject),
    ...criticSeeds(verified, subject),
    ...dateSeeds(verified, subject),
    ...topicSeeds(verified, subject),
  ];

  /* A seed raised in an earlier round is not raised again. Without this a run
     derives the same phrase every round, searches it, finds the rows it came
     from, and spends the budget going in a circle. */
  const fresh: Seed[] = [];
  for (const s of all) {
    if (seededBefore.has(seedKey(s.kind, s.value))) {
      skipped.push({ kind: s.kind, value: s.value, why: "already seeded in an earlier round" });
      continue;
    }
    const queries = s.queries.filter((q) => !tried.has(normTokens(q).join(" ")));
    if (!queries.length) {
      skipped.push({ kind: s.kind, value: s.value, why: "every query it would raise has already been run" });
      continue;
    }
    /* The spec's "1-3 queries" per seed, enforced. No template here produces
       more than three today, so the slice does not currently bind — it is
       what stops a fourth being added without anybody noticing the round got
       a third more expensive. */
    fresh.push({ ...s, queries: queries.slice(0, 3) });
  }

  /* `trace` first at any support — it is a hole, not a pattern. Then by how
     many rows attest it. */
  const weight: Record<SeedKind, number> = { trace: 4, phrase: 3, critic: 2, date: 1, topic: 0 };
  fresh.sort(
    (a, b) =>
      (a.kind === "trace" ? -1 : 0) - (b.kind === "trace" ? -1 : 0) ||
      b.support - a.support ||
      weight[b.kind] - weight[a.kind] ||
      a.value.localeCompare(b.value),
  );

  const max = input.max ?? MAX_SEEDS;
  const seeds = fresh.slice(0, max);
  for (const s of fresh.slice(max)) {
    skipped.push({ kind: s.kind, value: s.value, why: `over the ${max}-seed cap for one round` });
  }

  const queries: Snowball["queries"] = [];
  const issued = new Set<string>();
  for (const s of seeds) {
    for (const q of s.queries) {
      /* Two seeds wanting the same query pay for it once. No pair of the
         current templates can collide — they put the subject at opposite ends
         — so like the slice above this guards a template change rather than
         today's behaviour. The test asserts the property either way. */
      const key = normTokens(q).join(" ");
      if (issued.has(key)) continue;
      issued.add(key);
      queries.push({ family: "seed", query: q, seedKind: s.kind });
    }
  }

  return { seeds, queries, skipped };
}
