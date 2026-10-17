/**
 * DECOMPOSE: a brief becomes beats a camera could have filmed.
 *
 * This is Scout's first step and the only one that reads the user's sentence.
 * Everything downstream — the four query families, the window scans, the
 * board — works from what comes out of here, so a bad beat is not a bad beat.
 * It is thirty searches, twelve hours of scanning and a pile of evidence for
 * something nobody can point at on camera.
 *
 * THE WHOLE POINT IS THE VALIDATOR, NOT THE MODEL CALL. "He's narcissistic"
 * is the brief a person actually types, and a model handed it will happily
 * write "B1: establishes his narcissism" and then find nothing, because
 * narcissism is not a thing that happens at a timecode. The fix is not a
 * better prompt. It is a deterministic check that a behaviour names something
 * a viewer could see, run on the output, with one regeneration and then a
 * refusal — and a `rejected` list so the user is told their diagnosis was
 * dropped rather than quietly turned into six searches.
 *
 * That is invariant 2 one layer up from timestamps: the model directs, and
 * something deterministic decides whether the direction is findable.
 *
 * WHY THE STOPLIST DOES NOT FIRE ON REPORTED SPEECH. "He wants to quit" is a
 * motive. "He says he wants to quit" is a thing on camera — the words are in
 * the audio and a viewer can hear them. A check that cannot tell those apart
 * fires on correct beats, and a check that fires on correct work gets
 * switched off, which is how this codebase lost a check before.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveModel } from "./models.ts";

/** Scout's beat roles. `outside` is the plan's; Scout writes subject and counter. */
export const SCOUT_ROLES = ["subject", "counter", "outside"] as const;
export type ScoutRole = (typeof SCOUT_ROLES)[number];

export interface ScoutBeat {
  id: string;
  role: ScoutRole;
  /** The beat in a few words — what it is called on the board. */
  name: string;
  /** What a viewer would SEE. The thing every search is trying to find. */
  behaviour: string;
  /** How many verified moments before this beat is covered. */
  needMin: number;
  /** For a counter beat: the subject beat id it inverts. */
  inverts?: string;
  /**
   * A subject beat that survived with nothing sought against it. Not a
   * failure — a thing the board has to show, because an argument with no
   * other side is not an argument and the balance meter has to say so.
   */
  counterGap?: boolean;
}

export interface Persona {
  name: string;
  queries: string[];
}

export interface Rejected {
  /** The user's words, or the model's, verbatim. */
  said: string;
  why: string;
}

export interface Decomposition {
  beats: ScoutBeat[];
  personas: Persona[];
  rejected: Rejected[];
  /** Fewer than four beats between them. A narrow brief, honestly narrow. */
  narrow: boolean;
  tokensIn: number;
  tokensOut: number;
  model: string;
  /** How many model calls it took. Two means the first output broke a rule. */
  rounds: number;
}

/* ── The stoplist ───────────────────────────────────────────────────────── */

/**
 * A DIAGNOSIS: a word that names what someone IS, not what they did.
 *
 * Clinical and quasi-clinical labels, and the trait words that read as
 * character rather than conduct. None of these happen at a timecode. The
 * stems are deliberate: `narcissis` covers narcissist, narcissistic and
 * narcissism without three entries and without matching anything else.
 */
const DIAGNOSIS = [
  "narcissis",
  "psychopath",
  "sociopath",
  "borderline personality",
  "npd",
  "bipolar",
  "schizophren",
  "autistic",
  "insecure",
  "insecurity",
  "jealous",
  "pathological",
  "delusional",
  "unhinged",
  "toxic",
  "abusive",
  "manipulative",
  "entitled",
  "arrogant",
  "egotistical",
  "a grifter",
  "a liar",
  "a bully",
  "two-faced",
];

/**
 * A MOTIVE: a claim about what is going on inside someone's head.
 *
 * Observable only when it is attributed — see `ATTRIBUTED`. "Because he" is
 * the one that catches the most, because it is how an explanation smuggles
 * itself in behind a description.
 */
const MOTIVE = [
  "wants to",
  "wanted to",
  "trying to",
  "tries to",
  "in order to",
  "so that he",
  "so that she",
  "so that they",
  "because he",
  "because she",
  "because they",
  "can't handle",
  "cannot handle",
  "couldn't handle",
  "knows that",
  "knew that",
  "doesn't care",
  "does not care",
  "deliberately",
  "intentionally",
  "on purpose",
  "pretends",
  "pretending",
  "feels",
  "feeling",
  "thinks",
  "believes",
  "resents",
];

/**
 * ATTRIBUTION: the words that turn a mind-read into a thing in the audio.
 *
 * "He wants to quit" is a motive. "He says he wants to quit" is a sentence a
 * viewer hears him say. Everything here has to be a verb of speech or of
 * visible conduct — not "obviously" or "clearly", which attribute to the
 * narrator and are exactly how a diagnosis gets through.
 */
const ATTRIBUTED = [
  "says",
  "said",
  "saying",
  "tells",
  "told",
  "claims",
  "claimed",
  "states",
  "stated",
  "announces",
  "announced",
  "admits",
  "admitted",
  "denies",
  "denied",
  "explains",
  "explained",
  "argues",
  "argued",
  "writes",
  "wrote",
  "posts",
  "posted",
  "describes",
  "described",
  "calls",
  "called",
  "asks",
  "asked",
  "replies",
  "replied",
  "reads out",
  "on stream",
  "to camera",
];

/** Every phrase the stoplist knows, for the prompt and for the tests. */
export const STOPLIST = { diagnosis: DIAGNOSIS, motive: MOTIVE, attributed: ATTRIBUTED };

const WORD = (p: string) => new RegExp("(^|[^a-z])" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/**
 * Is this behaviour something a viewer could point to on camera?
 *
 * Returns the offending phrase, or null. Returns the PHRASE rather than a
 * boolean because the regeneration prompt has to quote it back — "rewrite B1
 * without 'narcissistic'" produces a behaviour; "rewrite B1, it was invalid"
 * produces the same beat with a synonym.
 */
export function diagnosis(behaviour: string): string | null {
  const text = String(behaviour || "");
  const lower = text.toLowerCase();

  for (const d of DIAGNOSIS) {
    if (WORD(d).test(lower)) return d;
  }

  /* A motive is allowed when the sentence attributes it. The attribution has
     to come BEFORE the motive in the sentence — "he says he wants to quit"
     attributes; "he wants to say something" does not, and reversing the test
     would pass it. */
  for (const m of MOTIVE) {
    const at = lower.search(WORD(m));
    if (at < 0) continue;
    const before = lower.slice(0, at);
    if (ATTRIBUTED.some((a) => WORD(a).test(before))) continue;
    return m;
  }

  return null;
}

/* ── The schema ─────────────────────────────────────────────────────────── */

const SCHEMA = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          role: { type: "string" },
          name: { type: "string" },
          behaviour: { type: "string" },
          need_min: { type: "number" },
        },
        /* Required for the reason essay.ts marked clip_id so: Cloudflare's
           json_schema mode drops optional properties, and a beat with no
           behaviour is a beat with nothing to search for. */
        required: ["id", "role", "name", "behaviour", "need_min"],
      },
    },
    counter: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          inverts: { type: "string" },
          name: { type: "string" },
          behaviour: { type: "string" },
          need_min: { type: "number" },
        },
        required: ["id", "inverts", "name", "behaviour", "need_min"],
      },
    },
    personas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          queries: { type: "array", items: { type: "string" } },
        },
        required: ["name", "queries"],
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        properties: { said: { type: "string" }, why: { type: "string" } },
        required: ["said", "why"],
      },
    },
  },
  required: ["beats", "counter", "personas", "rejected"],
} as const;

/* ── Reading the answer ─────────────────────────────────────────────────── */

/** 4 to 8 beats between subject and counter. The spec's range, not a guess. */
export const MIN_BEATS = 4;
export const MAX_BEATS = 8;

export interface Parsed {
  beats: ScoutBeat[];
  personas: Persona[];
  rejected: Rejected[];
}

/**
 * Reads the model's answer into beats. Pure and exported: every way this
 * fails is quiet, so every one of them is handled where it can be tested.
 */
export function parseDecomposition(response: unknown): Parsed {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return { beats: [], personas: [], rejected: [] };
    }
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const beats: ScoutBeat[] = [];
  const seen = new Set<string>();

  const take = (raw: unknown, role: ScoutRole) => {
    for (const b of Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []) {
      const behaviour = String(b.behaviour ?? "").trim();
      const name = String(b.name ?? "").trim();
      const id = String(b.id ?? "").trim();
      /* A beat with no behaviour cannot be searched for and a beat with no id
         cannot be referred to by a counter beat, a search or a moment. */
      if (!behaviour || !name || !id || seen.has(id)) continue;
      seen.add(id);
      const asked = String(b.role ?? role).toLowerCase();
      const got: ScoutRole = (SCOUT_ROLES as readonly string[]).includes(asked)
        ? (asked as ScoutRole)
        : role;
      const n = Number(b.need_min);
      const beat: ScoutBeat = {
        id,
        role: role === "counter" ? "counter" : got,
        name,
        behaviour,
        needMin: Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 6) : role === "counter" ? 1 : 2,
      };
      const inverts = String(b.inverts ?? "").trim();
      if (inverts) beat.inverts = inverts;
      beats.push(beat);
    }
  };

  take(obj.beats, "subject");
  take(obj.counter, "counter");

  const personas: Persona[] = [];
  for (const p of Array.isArray(obj.personas) ? (obj.personas as Array<Record<string, unknown>>) : []) {
    const name = String(p.name ?? "").trim();
    const queries = (Array.isArray(p.queries) ? p.queries : [])
      .map((q) => String(q ?? "").trim())
      .filter(Boolean);
    if (name) personas.push({ name, queries });
  }

  const rejected: Rejected[] = [];
  for (const r of Array.isArray(obj.rejected) ? (obj.rejected as Array<Record<string, unknown>>) : []) {
    const said = String(r.said ?? "").trim();
    if (said) rejected.push({ said, why: String(r.why ?? "").trim() || "not a behaviour" });
  }

  return { beats, personas, rejected };
}

/* ── The validator ──────────────────────────────────────────────────────── */

export interface Offence {
  beatId: string;
  /** The phrase that did it, or "" when the fault is a missing counter beat. */
  phrase: string;
  kind: "diagnosis" | "uncountered";
}

export interface Validated extends Parsed {
  offences: Offence[];
  narrow: boolean;
}

/**
 * Enforces the three rules the prompt states. Deterministic, pure, and the
 * reason this step is trustworthy.
 *
 * `final` is the second pass. On the first, an offending beat is REPORTED so
 * it can be quoted back to the model; on the second it is DROPPED and listed
 * under `rejected`, because a model that has been told once and done it again
 * is not going to get there on the third ask and the user is owed the news.
 *
 * A subject beat left without a counter is not dropped. Dropping it would
 * throw away the user's own case to satisfy a rule about balance, which is
 * backwards. It is marked `counterGap` so the board shows that nothing was
 * sought against it — invariant 4's "nothing backs this" must be reachable,
 * applied to the other side.
 */
export function validateDecomposition(p: Parsed, opts: { final?: boolean } = {}): Validated {
  const offences: Offence[] = [];
  const rejected = [...p.rejected];
  let beats = [...p.beats];

  /* 1. Every behaviour is something a viewer could point to. */
  const kept: ScoutBeat[] = [];
  for (const b of beats) {
    const hit = diagnosis(b.behaviour) || diagnosis(b.name);
    if (!hit) {
      kept.push(b);
      continue;
    }
    offences.push({ beatId: b.id, phrase: hit, kind: "diagnosis" });
    if (opts.final) {
      rejected.push({
        said: b.behaviour,
        why: `“${hit}” is a diagnosis, not a behaviour — nothing on camera shows it`,
      });
    } else {
      kept.push(b);
    }
  }
  beats = kept;

  /* 2. A counter beat whose subject beat is gone inverts nothing. It would
        sit on the board arguing against an absence. */
  const ids = new Set(beats.map((b) => b.id));
  beats = beats.filter((b) => b.role !== "counter" || !b.inverts || ids.has(b.inverts));

  /* 3. Every subject beat has at least one counter beat. */
  const countered = new Set(
    beats.filter((b) => b.role === "counter").map((b) => b.inverts).filter(Boolean) as string[],
  );
  /* A counter beat that inverts nothing in particular answers the brief as a
     whole, so it counts for every subject beat. */
  const blanket = beats.some((b) => b.role === "counter" && !b.inverts);
  for (const b of beats) {
    if (b.role !== "subject" || blanket || countered.has(b.id)) continue;
    offences.push({ beatId: b.id, phrase: "", kind: "uncountered" });
    if (opts.final) b.counterGap = true;
  }

  /* 4. Four to eight. Over the cap, the LAST SUBJECT beats go — the model
        wrote them in its own order of importance and a counter beat cannot be
        dropped without breaking rule 3. */
  if (beats.length > MAX_BEATS) {
    const over = beats.length - MAX_BEATS;
    const droppable = beats.filter((b) => b.role === "subject" && !countered.has(b.id)).slice(-over);
    const drop = new Set(droppable.map((b) => b.id));
    for (const b of beats) {
      if (!drop.has(b.id)) continue;
      rejected.push({ said: b.behaviour, why: `over ${MAX_BEATS} beats — this one was asked for last` });
    }
    beats = beats.filter((b) => !drop.has(b.id)).slice(0, MAX_BEATS);
  }

  return { beats, personas: p.personas, rejected, offences, narrow: beats.length < MIN_BEATS };
}

/* ── The call ───────────────────────────────────────────────────────────── */

export interface DecomposeInput {
  /** What the user wants the video to say. */
  claim: string;
  /** Their own words. Invariant 10: these win where they exist. */
  brief?: string;
  /** What is already in the plan. Scout keeps these; it does not rewrite them. */
  existing?: Array<{ id: string; role: ScoutRole; name: string; behaviour: string }>;
  /** One paragraph on what the user's own footage covers. */
  archive?: string;
}

function systemPrompt(): string {
  return [
    "You are briefing a researcher who will go looking for video evidence.",
    "You have not seen any footage and you will not. You are deciding WHAT",
    "TO LOOK FOR.",
    "",
    "Return BEATS, COUNTER beats, PERSONAS and REJECTED.",
    "",
    "A BEAT is one behaviour, written as the thing a viewer would see and",
    "hear. Not a trait, not a verdict, not an explanation.",
    "",
    "  Good:  “Berates live chat during streams; addresses chat as an",
    "         adversary”",
    "  Good:  “Says on stream that he no longer reads chat, then reads it”",
    "  Bad:   “Establishes his narcissism” — narcissism is not a thing that",
    "         happens at a timecode.",
    "  Bad:   “Lashes out because he can't handle criticism” — the first half",
    "         is a behaviour, the second is a guess about his head. Drop it.",
    "",
    "If the brief gives you a diagnosis or a motive — narcissistic, insecure,",
    "jealous, “because he…”, “wants to…” — DO NOT translate it into a beat.",
    "Put it in `rejected` with one line saying why, and write the observable",
    "behaviours that made the person believe it instead.",
    "",
    "A COUNTER beat is the strongest honest version of the other side, and",
    "`inverts` names the beat it answers. EVERY subject beat gets one. Where",
    "the brief is about a conflict, the other party's own conduct is a",
    "required counter beat.",
    "",
    "PERSONAS are four people who would search differently about this: name",
    "each one and the queries they would type.",
    "",
    "`need_min` is how many separate moments it takes before the beat is",
    "proved: 2 for a subject beat, 1 for a counter beat, more only for a",
    "claim about a pattern.",
    "",
    "Four to eight beats in total, counting counter beats. Do not name,",
    "quote, cite or invent any video, channel, timecode or clip.",
  ].join("\n");
}

function userPrompt(input: DecomposeInput): string {
  const lines = [`The claim: ${input.claim}`];
  if (input.brief) lines.push("", "In their own words:", input.brief);
  if (input.existing?.length) {
    lines.push("", "Beats the plan already has — keep these, do not rewrite them:");
    for (const b of input.existing) lines.push(`- ${b.id} (${b.role}) ${b.name}: ${b.behaviour}`);
  }
  if (input.archive) lines.push("", "What their own footage covers:", input.archive);
  return lines.join("\n");
}

/** The regeneration ask. Quotes the phrase back, because a vague ask gets a synonym. */
function retryPrompt(offences: Offence[], beats: ScoutBeat[]): string {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const lines = ["Three of those break the rules. Return the whole answer again, fixed."];
  for (const o of offences) {
    const b = byId.get(o.beatId);
    if (!b) continue;
    if (o.kind === "diagnosis") {
      lines.push(
        `- ${o.beatId} says “${b.behaviour}”. “${o.phrase}” is a diagnosis or a motive, not something on camera.` +
          " Write what a viewer would see that made someone say that, or put it in `rejected`.",
      );
    } else {
      lines.push(`- ${o.beatId} has no counter beat. Write one, with inverts: "${o.beatId}".`);
    }
  }
  lines.push("Everything that was already fine stays exactly as it was.");
  return lines.join("\n");
}

/**
 * ONE REGENERATION, THEN A REFUSAL.
 *
 * The spec's rule, and the reason it is a rule: a loop here is a loop that
 * spends a frontier call per turn arguing with a model about whether
 * narcissism is visible. One ask with the phrase quoted back fixes most of
 * it. What survives the second pass is dropped and SHOWN as dropped, which
 * is the honest outcome and the one the user can act on.
 */
export async function decompose(env: Env, input: DecomposeInput): Promise<Decomposition> {
  const model = resolveModel("reason", env, "upgrade");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt(input) },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let rounds = 0;

  const ask = async () => {
    rounds += 1;
    const res = await run(model.id, {
      messages,
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 4000,
    });
    const used = usageTokens(res);
    tokensIn += used.tokensIn;
    tokensOut += used.tokensOut;
    return res;
  };

  const first = await ask();
  const parsedFirst = parseDecomposition(first);
  let checked = validateDecomposition(parsedFirst);

  if (checked.offences.length) {
    messages.push({ role: "assistant", content: assistantText(first) || JSON.stringify(parsedFirst) });
    messages.push({ role: "user", content: retryPrompt(checked.offences, checked.beats) });
    const second = await ask();
    const parsedSecond = parseDecomposition(second);
    /* An empty second answer is worse than the first one's offences: it would
       turn a fixable beat list into no beat list at all. Keep the first. */
    checked = validateDecomposition(parsedSecond.beats.length ? parsedSecond : parsedFirst, { final: true });
  }

  return {
    beats: checked.beats,
    personas: checked.personas,
    rejected: checked.rejected,
    narrow: checked.narrow,
    tokensIn,
    tokensOut,
    model: model.id,
    rounds,
  };
}
