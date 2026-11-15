/**
 * THE PLAN: a claim, and the beats that would argue it.
 *
 * "A topic with no source video produces an act structure whose every claim
 * is backed by a real clip or an honestly-marked gap." That was essay.ts's
 * design and this is the same promise kept a better way.
 *
 * ESSAY.TS ASKED THE MODEL TO PICK THE CLIPS. It was handed a menu of real
 * ones and allowed to cite only those, with two measured fixes holding it
 * together: clip_id marked required or Cloudflare's json_schema mode dropped
 * every citation, and short ids because asked to copy a 26-character ULID the
 * model described the right clip and mistyped the reference.
 *
 * This does not ask. Each beat declares what it NEEDS — "the trade priced in
 * rent, then the admission that the price is embarrassing" — and retrieval
 * decides which footage meets it. That is invariant 2: the model directs, a
 * deterministic thing places. It also makes both of those fixes unnecessary
 * rather than load-bearing, because a model that never names a clip cannot
 * name one that does not exist.
 *
 * THE ONE STOP is between the beats and the footage. Everything before it is
 * cheap and reversible; everything after costs retrieval over the library and
 * produces a cut. Asking once, at the point where the answer changes what
 * gets made, is the whole of the flow's design.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import { runRead } from "./llm.ts";
import { plainRegister } from "./register.ts";
import { diagnosis } from "./scout-decompose.ts";

/** What a beat is for. The prototype's own three. */
export const ROLES = ["subject", "counter", "outside"] as const;
export type Role = (typeof ROLES)[number];

/** What each role is called on screen. */
export const ROLE_NAME: Record<Role, string> = {
  subject: "YOUR CASE",
  counter: "AGAINST",
  outside: "OUTSIDE VOICE",
};

export interface Beat {
  role: Role;
  /** The beat, in a few words. */
  name: string;
  /** What it wants from the footage — and the query retrieval runs. */
  need: string;
}

export interface Draft {
  claim: string;
  beats: Beat[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  /**
   * The genre word the person used, if they used one — kept, not thrown away.
   *
   * Invariant 10 says the writer never sees it, not that it never existed.
   * Doc 04: "Genre is a parameter set applied after the cut is aligned, not a
   * writing instruction." Nothing applies it yet; carrying it is what makes
   * that possible later without asking the person again.
   */
  genre: string | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    claim: { type: "string" },
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          name: { type: "string" },
          need: { type: "string" },
        },
        /* All three required for the same reason essay.ts marks clip_id so:
           Cloudflare's json_schema mode drops optional properties, and a beat
           arriving without its `need` is a beat nothing can find footage for. */
        required: ["role", "name", "need"],
      },
    },
  },
  required: ["claim", "beats"],
} as const;

/*
 * A PLAIN REGISTER, WITH NO GENRE WORD IN IT.
 *
 * This line read "You are planning a video essay" for as long as it has
 * existed, which is invariant 10 broken by us rather than by a user: the
 * writer was handed the costume in the first sentence of its instructions.
 * Decision 15 — "a genre word is a costume; the model performs it."
 *
 * The topic arrives through plainRegister, so a person who typed "make me a
 * video essay about NASA" is planning NASA and the word "video essay" is
 * stored as an edit-profile hint rather than sent.
 */
function systemPrompt(topic: string): string {
  return [
    "You are planning a video, before any footage has been looked at.",
    "",
    `The topic: ${topic}`,
    "",
    "Return a CLAIM and the BEATS that would argue it.",
    "",
    "The claim is one sentence saying what the video actually argues — not",
    "what it is about. “Leaving isn't a decision you make; it's one you",
    "notice you've already made” is a claim. “A video about leaving” is a",
    "subject, and a subject is not a claim.",
    "",
    "Each beat has:",
    "- role: \"subject\" for the case being made, \"counter\" for the strongest",
    "  version of the other side, \"outside\" for a voice that is not the",
    "  speaker's own.",
    "- name: the beat in a few words.",
    "- need: WHAT THE FOOTAGE HAS TO SHOW, written as you would describe the",
    "  moment you are looking for — \"the trade priced in rent, then the",
    "  admission that the price is embarrassing\". This is searched against",
    "  the person's own footage, so describe the moment, not the argument.",
    "",
    "Five to eight beats. At least one counter, because an argument with no",
    "other side is not an argument. Do not name, cite or invent any clip,",
    "timecode or quote — you have not seen the footage and will not.",
  ].join("\n");
}

/**
 * Drafts the claim and the beats.
 *
 * Nothing is grounded here because nothing claims to be: no clip is named, so
 * there is no citation to check. Grounding happens when the needs are run
 * against the library, where a beat that finds nothing is marked thin rather
 * than filled with something that does not meet it.
 */
export async function draftPlan(env: Env, rawTopic: string, opts: { upgrade?: boolean } = {}): Promise<Draft> {
  /* Invariant 10: the genre word is stored and discarded; the writer never
     sees it. `genre` is returned so a caller can keep it — it is an edit
     profile, which doc 04 applies after the cut is aligned. */
  const { said: topic, genre } = plainRegister(rawTopic);
  /* Directing: what the video says. Not a place to save a call. */
  const model = resolveFor("direct", env);
  const run = (m: string, i: Record<string, unknown>) => runRead(env, "plan", m, i);

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt(topic) },
      { role: "user", content: `Plan it: ${topic}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    /*
     * 8000, LIKE EVERY OTHER CALL THAT RETURNS A STRUCTURE THIS SIZE.
     *
     * It was 4000, and the first time anything actually called this — the
     * composer's new essay door — `reportRoom` said what had been true all
     * along: "[plan] cut off: spent all 4000 output token(s), so the answer is
     * incomplete and anything parsed from it is a guess. Raise the budget."
     * Nothing parsed, no beats came back, and the plan could not be reached.
     *
     * The ask is a claim plus five to eight beats, each with a role, a name
     * and a `need` written as a described moment — the same order of output as
     * score.ts, arrange.ts and essay.ts, which all use 8000. 4000 was the
     * figure for a call that returns a sentence.
     *
     * Unnoticed for as long as it was because POST /api/plans had no caller:
     * the budget was only ever wrong on a path nobody took.
     */
    max_tokens: 8000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const { claim, beats } = parsePlan(res);
  return { claim, beats, tokensIn, tokensOut, model: model.id, genre };
}

/**
 * Reads the model's answer into a claim and beats.
 *
 * Pure and exported, because every way this fails is quiet. A beat with no
 * `need` finds nothing and reads as a library with no footage in it; an
 * unrecognised role would fall through to a label nobody wrote. Both are
 * dropped or defaulted here rather than carried.
 */
export function parsePlan(response: unknown): { claim: string; beats: Beat[] } {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return { claim: "", beats: [] };
    }
  }

  const obj = (parsed ?? {}) as { claim?: unknown; beats?: unknown };
  const claim = typeof obj.claim === "string" ? obj.claim.trim() : "";
  const raw = Array.isArray(obj.beats) ? (obj.beats as Array<Record<string, unknown>>) : [];

  const beats: Beat[] = [];
  for (const b of raw) {
    const need = String(b.need ?? "").trim();
    const name = String(b.name ?? "").trim();
    /* A beat with nothing to find is not a beat. It would sit in the plan
       finding nothing and reading as an empty library. */
    if (!need || !name) continue;
    const asked = String(b.role ?? "").toLowerCase();
    const role: Role = (ROLES as readonly string[]).includes(asked) ? (asked as Role) : "subject";
    beats.push({ role, name, need });
  }

  return { claim, beats };
}

/**
 * FINDING FOOTAGE FOR EACH KEPT BEAT — after the stop, never before.
 *
 * Each beat's `need` is the query. Retrieval is the same hybrid the room and
 * the cut use, so a beat finds exactly what a person would find typing that
 * sentence into the search box, and the plan cannot disagree with the library
 * about what is in it.
 *
 * A BEAT THAT FINDS LITTLE IS MARKED THIN, NOT PADDED. The prototype draws
 * thin beats in red for the same reason this does not quietly widen the
 * search until something turns up: a beat with nothing behind it is a hole in
 * the argument, and the useful thing to do with a hole is show it.
 *
 * AND "LITTLE" MEANS LITTLE THAT BACKS IT, NOT FEW RESULTS. Retrieval
 * returns six moments for any beat with words in it; counting them measured
 * whether the search box worked, not whether the beat has an argument under
 * it. Six moments about the same evening, none of which say the thing, is
 * exactly the hole this is for — and it read as a well-stocked beat. The
 * judge (src/judge.ts) is what tells them apart.
 *
 * NOBODY CHECKED IS NOT NOTHING BACKS IT. When no verdict is known — the
 * judge was not run, or the call failed — this falls back to counting
 * results, which is what it always did. A beat marked thin because a model
 * call failed would send somebody to reshoot footage they already have.
 *
 * AN OUTSIDE BEAT IS A GAP, HONESTLY. "One voice that isn't yours" means
 * footage the user did not shoot, which is Scout's job. Scout is built now
 * and runs per PROJECT; a plan is not a project until Cut it, so there is
 * nothing for a beat to hand off to yet and this still says so rather than
 * searching the user's own library and labelling their voice somebody
 * else's.
 */
export const THIN_BELOW = 2;

/**
 * WHAT THE ON-CAMERA STOPLIST MAKES OF A BEAT THE PERSON WROTE.
 *
 * Advice. Never a veto, and the distinction is the whole point of this
 * function existing rather than the route calling `diagnosis` directly.
 *
 * `18-SCOUT-BUILD-SPEC.md` requires every behaviour to be "something a viewer
 * could point to on camera", and src/scout-decompose.ts enforces it hard: a
 * hit gets one regeneration and a second hit drops the beat. That is right for
 * a model's output — a model asked again writes a better sentence. It is wrong
 * for a person's. Invariant 10 says "the user's own words win where they
 * exist", and invariant 3's posture throughout is reasons rather than
 * verdicts, so refusing somebody's sentence because a stoplist matched would
 * break both at once.
 *
 * But saying nothing would be its own failure. A `need` is a RETRIEVAL QUERY,
 * and "he wants to leave" describes why rather than what a camera saw, so it
 * genuinely finds nothing. Reporting that is a service; enforcing it is not.
 *
 * Returns the offending PHRASE rather than a sentence, for the reason
 * `diagnosis` does — the page sets it as the data it is, and the wording
 * around it is the design's. Checks the name as well as the need, as
 * validateDecomposition does, because a beat called "why he snapped" is the
 * same problem spelled in the other field.
 */
export function needAdvice(beat: { name?: string; need: string }): string | null {
  for (const field of [beat.need, beat.name]) {
    if (!field) continue;
    const hit = diagnosis(field);
    if (hit) return wholeWord(field, hit);
  }
  return null;
}

/*
 * THE WORD THEY TYPED, NOT THE STEM THAT MATCHED.
 *
 * The stoplist holds stems — "narcissist*" — so `diagnosis` on "narcissistic
 * framing" returns "narcissis". Quoting that back at Scout is fine, because
 * Scout is being told to rewrite and a stem is enough to identify what to
 * drop. Showing it to the person who typed the word reads like a bug, so the
 * match is extended to the end of the word it started in.
 *
 * Done here rather than in `diagnosis` on purpose: that function is Scout's
 * and its regeneration prompt depends on what it returns, so widening it
 * would change a working path to improve a sentence on a different one.
 */
function wholeWord(text: string, hit: string): string {
  const at = text.toLowerCase().indexOf(hit.toLowerCase());
  if (at < 0) return hit;
  let end = at + hit.length;
  while (end < text.length && /[\w'\u2019-]/.test(text[end])) end += 1;
  return text.slice(at, end);
}

/** One candidate for a beat, with the judge's answer when there is one. */
export interface Candidate {
  id: string;
  /** True when something said it backs the beat; null when nobody looked. */
  backs: boolean | null;
}

export interface Found {
  beatId: string;
  clipIds: string[];
  thin: boolean;
  /** How many of them back it. Null when nobody checked. */
  backed: number | null;
  /** Why it is empty, when the reason is not "your library has nothing". */
  gap: string | null;
}

export async function findForBeats(
  beats: Array<{ id: string; role: Role; need: string }>,
  search: (need: string) => Promise<Candidate[]>,
): Promise<Found[]> {
  const out: Found[] = [];
  for (const b of beats) {
    if (b.role === "outside") {
      out.push({
        beatId: b.id,
        clipIds: [],
        thin: true,
        backed: null,
        gap: "a voice that isn't yours — nothing here can find that yet",
      });
      continue;
    }

    const found = await search(b.need);
    const clipIds = found.map((f) => f.id);
    const checked = found.some((f) => f.backs !== null);
    const backed = checked ? found.filter((f) => f.backs).length : null;

    out.push({
      beatId: b.id,
      clipIds,
      backed,
      thin: (backed ?? clipIds.length) < THIN_BELOW,
      /*
       * FOUND SOMETHING, AND NONE OF IT SAYS THE THING. A different hole
       * from an empty one, and the only one a person can act on without
       * shooting anything: the words are wrong, not the footage.
       */
      /* `checked` already implies something was found — nothing can have
         been checked otherwise — so there is no length guard here. One was,
         and breaking it on purpose changed nothing, which is how it was
         found to be saying the same thing twice. */
      gap: checked && backed === 0 ? "nothing here says it — the moments are about it, not of it" : null,
    });
  }
  return out;
}
