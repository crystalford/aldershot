/**
 * EXPAND: one behaviour becomes queries in four different languages.
 *
 * Spec 18 section 3.2. A beat says what a viewer would see; a search box
 * wants the words people actually typed. Those are rarely the same words, and
 * the gap between them is most of why a naive search finds the obvious clip
 * and nothing else.
 *
 * The four families exist because they look in genuinely different places:
 *
 *   direct  — the behaviour in plain words. What anyone would try first.
 *   vocab   — the community's OWN terms. "the Khan compilation", a nickname,
 *             a catchphrase. Unguessable, and the highest-yield family there
 *             is, because the people who index these moments use them.
 *   crowd   — the places fans have already done the work. Best-ofs,
 *             compilations, incident lists, timestamp threads.
 *   counter — the other side, and the personas who would look for it.
 *
 * ONE DEPARTURE FROM THE SPEC, AND THE REASON FOR IT. The spec has the model
 * write all four families. Here the model writes the words for all four, and
 * the vocabulary is HARVESTED from the results of the previous round and from
 * the persisted lexicon — then the validator refuses a vocab query that does
 * not contain a harvested term.
 *
 * Because the failure mode is specific and expensive: asked for "the
 * community's own terms", a model invents plausible ones. "the meltdown
 * compilation", "DSPGaming rage moments" — fluent, confident, and nobody has
 * ever typed them. Those queries cost quota, return nothing, and the beat
 * reads as a subject nobody has discussed. A term that appeared in two
 * different uploaders' titles is a term two different people chose; a term
 * that appeared in a model's answer is a term nobody chose.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveModel } from "./models.ts";
import type { Family, SourceCandidate } from "./scout-adapters.ts";
import { normTokens } from "./scout-verify.ts";

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export const TERM_KINDS = ["nickname", "catchphrase", "meme", "critic_channel"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

export interface Term {
  term: string;
  kind: TermKind;
  /** How many DISTINCT sources used it. The whole point of the number. */
  sourceCount: number;
}

/**
 * Words that carry no community meaning.
 *
 * Deliberately short. A long stopword list looks thorough and quietly removes
 * the thing being searched for — "best of" is two stopwords in most lists and
 * is the single most useful phrase in the crowd family.
 */
const STOP = new Set(
  ("a an and the of in on at to for with from by is are was were be been it its this that these those " +
    "he she they him her them his their i you we me my your our as but or if then than so just about " +
    "video full new live stream streams part ep episode vod clip clips highlights " +
    "youtube twitch subscribe like comment watch")
    .split(" "),
);

/** A term must be said by this many different sources before it counts. */
export const MIN_SOURCES = 2;
/** Phrases up to this many words. Four catches "the X compilation" and stops. */
export const MAX_GRAM = 4;

/**
 * The community's own words, from what the last round turned up.
 *
 * Counted by DISTINCT SOURCE, never by occurrence: one uploader who repeats a
 * phrase in a title, a description and six chapter names is one person's
 * phrasing, and a term two different uploaders chose is a term the community
 * chose. Counting occurrences would rank the most verbose channel's house
 * style as the community's vocabulary.
 *
 * The beat's own words are excluded. A vocab query that restates the
 * behaviour is a direct query spending quota under a second name.
 */
export function harvestVocabulary(
  candidates: SourceCandidate[],
  beatBehaviour: string,
  opts: { minSources?: number; known?: Term[] } = {},
): Term[] {
  const minSources = opts.minSources ?? MIN_SOURCES;
  const beatWords = new Set(normTokens(beatBehaviour));

  /* term -> the set of sources that used it. */
  const seen = new Map<string, Set<string>>();
  const channels = new Map<string, Set<string>>();

  for (const c of candidates) {
    const source = c.adapter + ":" + c.externalId;
    /* A channel name that keeps turning up is a critic channel, which is a
       different kind of term: it is a place to search, not a phrase. */
    if (c.channel) {
      const key = c.channel.trim().toLowerCase();
      if (key) {
        const at = channels.get(key) ?? new Set<string>();
        at.add(source);
        channels.set(key, at);
      }
    }

    const text = [c.title, c.description, ...(c.chapters ?? [])].filter(Boolean).join(" . ");
    /* Split on punctuation as well as whitespace: an n-gram that crosses a
       full stop is two halves of two different thoughts. */
    for (const phrase of text.split(/[.,;:!?()\[\]–—|/\n]+/)) {
      const tokens = normTokens(phrase);
      for (let n = 1; n <= MAX_GRAM; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
          const gram = tokens.slice(i, i + n);
          /* A phrase that begins or ends on a stopword is a fragment of a
             sentence rather than a name for something. Stopwords INSIDE one
             are fine, and necessary: "best of the worst" is a title. */
          if (STOP.has(gram[0]) || STOP.has(gram[n - 1])) continue;
          if (gram.every((g) => beatWords.has(g))) continue;
          if (gram.every((g) => /^\d+$/.test(g))) continue;
          const term = gram.join(" ");
          const at = seen.get(term) ?? new Set<string>();
          at.add(source);
          seen.set(term, at);
        }
      }
    }
  }

  const out = new Map<string, Term>();
  for (const t of opts.known ?? []) out.set(t.term.toLowerCase(), { ...t });

  for (const [term, sources] of seen) {
    if (sources.size < minSources) continue;
    const prior = out.get(term);
    const kind: TermKind = term.split(" ").length >= 3 ? "meme" : "catchphrase";
    out.set(term, {
      term,
      kind: prior?.kind ?? kind,
      sourceCount: Math.max(sources.size, prior?.sourceCount ?? 0),
    });
  }
  for (const [name, sources] of channels) {
    if (sources.size < minSources) continue;
    out.set(name, { term: name, kind: "critic_channel", sourceCount: sources.size });
  }

  /* A longer phrase that is only ever said inside a longer one it shares a
     count with is the same term twice. "khan compilation" and "the khan
     compilation" are one phrase; keep the longer, which is what people typed. */
  const terms = [...out.values()].sort((a, b) => b.term.length - a.term.length);
  const kept: Term[] = [];
  for (const t of terms) {
    const swallowed = kept.some(
      (k) => k.term.includes(t.term) && k.sourceCount === t.sourceCount && k.kind === t.kind,
    );
    if (!swallowed) kept.push(t);
  }

  return kept.sort((a, b) => b.sourceCount - a.sourceCount || a.term.localeCompare(b.term));
}

/* ── The lexicon ────────────────────────────────────────────────────────── */

export interface LexiconRow {
  entity: string;
  term: string;
  kind: TermKind;
  sourceCount: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * THE ONE PART OF SCOUT THAT GETS BETTER THE MORE HE IS USED.
 *
 * A nickname learned on one project is a nickname on the next, and the
 * community's words are not guessable from the brief. Counts ADD across runs
 * rather than replace, because a term seen by two sources in each of three
 * runs is better attested than one seen by two sources once; `firstSeen`
 * never moves, so a term that stopped being used can be aged out instead of
 * searched forever.
 */
export function mergeLexicon(
  existing: LexiconRow[],
  entity: string,
  harvested: Term[],
  now = Date.now(),
): LexiconRow[] {
  const by = new Map(existing.filter((r) => r.entity === entity).map((r) => [r.term.toLowerCase(), { ...r }]));
  for (const t of harvested) {
    const key = t.term.toLowerCase();
    const prior = by.get(key);
    if (prior) {
      prior.sourceCount += t.sourceCount;
      prior.lastSeen = now;
      /* A term first seen as a catchphrase and later recognised as a channel
         is a channel. The more specific kind wins. */
      if (prior.kind !== "critic_channel" && t.kind === "critic_channel") prior.kind = t.kind;
    } else {
      by.set(key, { entity, term: t.term, kind: t.kind, sourceCount: t.sourceCount, firstSeen: now, lastSeen: now });
    }
  }
  return [...by.values()].sort((a, b) => b.sourceCount - a.sourceCount || a.term.localeCompare(b.term));
}

/* ── The crowd family ───────────────────────────────────────────────────── */

/**
 * Where fans have already indexed the moment, as templates.
 *
 * Not a model call. The spec names the places — "best of", compilations,
 * incident lists, timestamp threads, Twitch clips by views — and they are the
 * same places for every subject, so asking a model to remember them each
 * round is paying for a list that does not change and getting a different
 * subset of it every time.
 */
export function crowdQueries(subject: string, extra: string[] = []): string[] {
  const s = subject.trim();
  if (!s) return [];
  const out = [
    `${s} best of`,
    `${s} compilation`,
    `${s} timestamps`,
    `${s} incident list`,
    `reddit ${s} timestamp thread`,
    `${s} wiki incidents`,
    `${s} clips most viewed`,
  ];
  for (const e of extra) {
    const t = e.trim();
    if (t) out.push(`${s} ${t}`);
  }
  return [...new Set(out)];
}

/* ── The call ───────────────────────────────────────────────────────────── */

export interface ExpandBeat {
  id: string;
  role: "subject" | "counter" | "outside";
  behaviour: string;
}

export interface ExpandInput {
  /** Who or what the run is about. The crowd templates hang off this. */
  subject: string;
  beats: ExpandBeat[];
  /** What the last round's results said the community calls things. */
  vocabulary: Term[];
  /** From decompose. The counter family is written for these. */
  personas?: Array<{ name: string; queries: string[] }>;
  /** Queries already issued, so a round does not re-buy the last one. */
  alreadyTried?: string[];
}

export interface Query {
  beatId: string;
  family: Family;
  query: string;
  /** A sentence written as if it were the answer, for dense retrieval. */
  hyde: string | null;
}

export interface Expansion {
  queries: Query[];
  /** Vocab queries the model invented a term for. Dropped, and reported. */
  invented: Array<{ beatId: string; query: string }>;
  /** Beats that ended up with no query in a family they should have had. */
  missing: Array<{ beatId: string; family: Family }>;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat_id: { type: "string" },
          family: { type: "string" },
          query: { type: "string" },
          hyde: { type: "string" },
        },
        /* All four required for essay.ts's reason: Cloudflare's json_schema
           mode drops optional properties, and a query with no beat belongs to
           nobody and is charged to everybody. */
        required: ["beat_id", "family", "query", "hyde"],
      },
    },
  },
  required: ["queries"],
} as const;

function systemPrompt(): string {
  return [
    "You are writing search queries for a researcher looking for video",
    "evidence. You have not seen any footage.",
    "",
    "For each beat, write queries in three families:",
    "",
    "- direct: the behaviour in the plainest words someone would type.",
    "- vocab: the same thing in THE COMMUNITY'S OWN WORDS. You will be given",
    "  the terms that actually appear in people's titles and descriptions.",
    "  USE ONLY THOSE. Do not invent a nickname, a catchphrase or the name of",
    "  a compilation — an invented term costs a real search and returns",
    "  nothing, and the beat then reads as a subject nobody has discussed.",
    "  If no term fits a beat, write no vocab query for it.",
    "- counter: what somebody arguing the other side would type, and what",
    "  each of the personas would type.",
    "",
    "Two to four queries per family per beat. Short: the words someone types,",
    "not a sentence.",
    "",
    "Each query also gets a HYDE line — one or two sentences written AS IF",
    "they were the transcript of the moment you are looking for. Not a",
    "description of it, and not a question. “I am not reading chat tonight,",
    "somebody in there always wants to tell me how to run my own stream” is a",
    "hyde line. “A clip where he complains about chat” is not.",
    "",
    "Do not name, quote, cite or invent any video, channel, timecode or clip.",
  ].join("\n");
}

function userPrompt(input: ExpandInput): string {
  const lines = [`The subject: ${input.subject}`, "", "The beats:"];
  for (const b of input.beats) lines.push(`- ${b.id} (${b.role}): ${b.behaviour}`);

  lines.push("", "The community's own terms, with how many different sources used each:");
  if (input.vocabulary.length) {
    for (const t of input.vocabulary.slice(0, 40)) {
      lines.push(`- "${t.term}" (${t.kind}, ${t.sourceCount} sources)`);
    }
  } else {
    lines.push("- none yet. Write no vocab queries this round.");
  }

  if (input.personas?.length) {
    lines.push("", "The personas:");
    for (const p of input.personas) lines.push(`- ${p.name}`);
  }
  if (input.alreadyTried?.length) {
    lines.push("", "Already tried — do not repeat these:");
    for (const q of input.alreadyTried.slice(0, 60)) lines.push(`- ${q}`);
  }
  return lines.join("\n");
}

/** Families the model writes. `crowd` is templates and `seed` comes from finds. */
const MODEL_FAMILIES: Family[] = ["direct", "vocab", "counter"];

/**
 * Does this query actually use one of the harvested terms?
 *
 * Token containment rather than a substring: "the Khan compilation" and "khan
 * compilation video" share the term, and a substring test on the raw strings
 * would miss it over an article. A single-word term has to appear as a word —
 * "rage" must not be matched by "outrageous".
 */
export function usesHarvestedTerm(query: string, vocabulary: Term[]): boolean {
  const q = normTokens(query);
  return vocabulary.some((t) => {
    const term = normTokens(t.term);
    if (!term.length) return false;
    for (let i = 0; i + term.length <= q.length; i++) {
      if (term.every((w, j) => q[i + j] === w)) return true;
    }
    return false;
  });
}

/**
 * Reads the model's answer into queries, and refuses the invented vocabulary.
 *
 * Pure and exported, because every way this fails is quiet: an invented term
 * looks exactly like a real one, costs the same quota and comes back empty,
 * and the beat it was written for reads as a subject nobody has discussed.
 */
export function parseExpansion(
  response: unknown,
  input: ExpandInput,
): { queries: Query[]; invented: Array<{ beatId: string; query: string }>; missing: Array<{ beatId: string; family: Family }> } {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return { queries: [], invented: [], missing: [] };
    }
  }

  const beats = new Map(input.beats.map((b) => [b.id, b]));
  const tried = new Set((input.alreadyTried ?? []).map((q) => normTokens(q).join(" ")));
  const raw = Array.isArray((parsed as { queries?: unknown })?.queries)
    ? ((parsed as { queries: Array<Record<string, unknown>> }).queries)
    : [];

  const queries: Query[] = [];
  const invented: Array<{ beatId: string; query: string }> = [];
  const seen = new Set<string>();

  for (const r of raw) {
    const beatId = String(r.beat_id ?? "").trim();
    const query = String(r.query ?? "").trim();
    const family = String(r.family ?? "").toLowerCase() as Family;
    /* A query with no beat belongs to nobody and is charged to everybody. */
    if (!query || !beats.has(beatId) || !MODEL_FAMILIES.includes(family)) continue;

    const key = family + "\u0000" + normTokens(query).join(" ");
    if (seen.has(key) || tried.has(normTokens(query).join(" "))) continue;

    if (family === "vocab" && !usesHarvestedTerm(query, input.vocabulary)) {
      invented.push({ beatId, query });
      continue;
    }

    seen.add(key);
    const hyde = String(r.hyde ?? "").trim();
    queries.push({ beatId, family, query, hyde: hyde || null });
  }

  /*
   * WHICH FAMILIES EACH BEAT SHOULD HAVE HAD.
   *
   * `direct` always. `counter` only for a counter beat — a subject beat's
   * counter queries belong to the counter beat that inverts it, or they get
   * filed under the case they are arguing against. `vocab` only when there
   * was vocabulary to use, which is the point of harvesting it: an empty
   * vocab family in round one is correct, not a failure.
   */
  const missing: Array<{ beatId: string; family: Family }> = [];
  for (const b of input.beats) {
    const has = (f: Family) => queries.some((q) => q.beatId === b.id && q.family === f);
    if (!has("direct")) missing.push({ beatId: b.id, family: "direct" });
    if (b.role === "counter" && !has("counter")) missing.push({ beatId: b.id, family: "counter" });
    if (input.vocabulary.length && !has("vocab")) missing.push({ beatId: b.id, family: "vocab" });
  }

  return { queries, invented, missing };
}

/**
 * Writes this round's queries.
 *
 * The crowd family is added here rather than asked for: the places fans index
 * things are the same places for every subject, and paying a frontier model
 * each round to recall a fixed list gets a different subset of it every time.
 */
export async function expandQueries(env: Env, input: ExpandInput): Promise<Expansion> {
  const model = resolveModel("reason", env, "upgrade");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(input) },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 4000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const { queries, invented, missing } = parseExpansion(res, input);

  /* The crowd family hangs off the subject, not off a beat, so it is attached
     to the first subject beat — or to whatever there is, when a run is all
     counter beats. */
  const tried = new Set((input.alreadyTried ?? []).map((q) => normTokens(q).join(" ")));
  const home = input.beats.find((b) => b.role === "subject") ?? input.beats[0];
  if (home) {
    const extra = input.vocabulary.filter((t) => t.kind !== "critic_channel").slice(0, 3).map((t) => t.term);
    for (const q of crowdQueries(input.subject, extra)) {
      if (tried.has(normTokens(q).join(" "))) continue;
      queries.push({ beatId: home.id, family: "crowd", query: q, hyde: null });
    }
  }

  return { queries, invented, missing, tokensIn, tokensOut, model: model.id };
}
