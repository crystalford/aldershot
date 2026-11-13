/**
 * AN ANGLE: a video that could be made.
 *
 * The object this product did not have. Today's flow is a one-way funnel —
 * a topic, then one claim, then beats, then footage, then a cut — so there
 * was no way to hold two versions of a video beside each other and choose.
 * `docs/research/PASS-4-BRIEF.md` names the hole exactly: "There is no
 * representation of a video that could be made — and therefore no way to
 * have several, compare them, or rank them."
 *
 * THE CASE THAT FORCED IT. A McLuhan clip about NASA — "the stuff they put
 * out is cheap science fiction" — as the opening of an essay. That one seed
 * contains at least two different films: one about MEDIUM, where an
 * institution was shaped by the fiction it published, and one about whether
 * the events happened. Same source, same speaker, wildly different videos,
 * and only one of them survives contact with invariant 4. Choosing between
 * those is the editorial act, and `draftPlan` cannot represent the choice
 * because it returns one plan.
 *
 * ── Two rules this module exists to obey ─────────────────────────────────
 *
 * THE MODEL PROPOSES; IT NEVER SAYS WHAT IS BACKED. Invariant 2 in spirit:
 * the model directs and a deterministic thing places. So `draftAngles` asks
 * only for claims and beats — the same shape `draftPlan` already asks for,
 * because a beat's `need` is already the query retrieval runs. What each
 * angle would actually COST is then measured against the real archive by
 * `priceAngles`, which makes no model call at all. A model allowed to say
 * "this one is well supported" is a model inventing the one fact the person
 * is choosing on.
 *
 * NO SCORES, AND THE BAND IS ABOUT BUILDABILITY (invariant 3). The bands are
 * Strong / Worth a look / Long shot, the same three words src/shorts.ts
 * uses, and here they answer "how much of this do you already have?" — NOT
 * "which of these is the better video". The second question is the person's
 * and a number would be a lie about it. What the machine honestly knows is
 * how much footage meets each beat, so that is what it says, with the line
 * that caused it.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import { runRead } from "./llm.ts";
import { ROLES, type Beat, type Role } from "./plan.ts";
import { type Grade, GRADE_NAME } from "./shorts.ts";

/**
 * WHERE THE VIDEO STARTS, in the person's own words.
 *
 * `draftPlan` takes a topic string and says so in its own header: "no clip
 * is named". That is right for "a video about leaving" and wrong for "start
 * with this quote and build outward", which is how people actually begin.
 *
 * `text` is verbatim and load-bearing — invariant 10, the user's own words
 * win where they exist. A transcript they pasted is the thing the angles
 * have to be readings OF, not a topic to be paraphrased away.
 *
 * `source` is a LINK and stays one. Invariant 9: Scout finds and links, and
 * nothing in this codebase downloads what a platform forbids. The seed's
 * origin travels with it so a credit can be written and a receipt can point
 * somewhere, and it is never fetched to be cut from.
 */
export interface Seed {
  /** The quote, the paragraph, the sentence. Used verbatim. */
  text: string;
  /** Where it came from, if anywhere. Linked, never downloaded. */
  source?: string | null;
  /** Who said it, when it is somebody. Travels into the credit. */
  speaker?: string | null;
}

export interface Angle {
  /** One sentence: what THIS version of the video argues. */
  claim: string;
  /**
   * Why this reading of the seed and not another.
   *
   * The thing a slate is useless without. Three claims with no account of
   * what separates them is three ways of saying the same sentence, and the
   * person cannot choose between them in thirty seconds — which PASS-4's Q5
   * sets as the bar an angle has to clear.
   */
  take: string;
  beats: Beat[];
}

/** An angle with what it would take, measured rather than guessed. */
export interface PricedAngle extends Angle {
  /** Beats the person's own archive already has something for. */
  backed: number;
  /** Beats nothing here meets — Scout's work, or a camera's. */
  missing: number;
  /** Strong / Worth a look / Long shot, about what it would take to build. */
  band: Grade;
  /** The line that caused the band. Invariant 3: never a number alone. */
  why: string;
}

export interface Slate {
  angles: PricedAngle[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/**
 * How many angles. Three, and the number is a judgement.
 *
 * One is the funnel this exists to replace. Two reads as a binary and
 * invites a coin toss. Beyond four nobody compares them — they skim, which
 * is the failure mode a slate is supposed to prevent. Three is small enough
 * to hold in the head and wide enough that the middle one is not obviously
 * the answer.
 */
export const SLATE_SIZE = 3;

const SCHEMA = {
  type: "object",
  properties: {
    angles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          take: { type: "string" },
          beats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string" },
                name: { type: "string" },
                need: { type: "string" },
              },
              /* Required for the reason plan.ts gives: Cloudflare's
                 json_schema mode drops optional properties, and a beat with
                 no `need` is a beat nothing can find footage for. */
              required: ["role", "name", "need"],
            },
          },
        },
        required: ["claim", "take", "beats"],
      },
    },
  },
  required: ["angles"],
} as const;

function systemPrompt(seed: Seed): string {
  const said = seed.speaker ? `${seed.speaker} said this:` : "This is the seed:";
  return [
    "You are proposing different videos that could be made from one seed,",
    "before any footage has been looked at.",
    "",
    said,
    "",
    seed.text,
    "",
    `Return ${SLATE_SIZE} ANGLES. An angle is one video that could be made`,
    "from this seed — not one topic described three ways.",
    "",
    "They must differ in what they ARGUE, not in how they are worded. If two",
    "of them could use the same footage in the same order, you have written",
    "one angle twice. Readings that take the seed at its word and readings",
    "that treat it as evidence of something else are different angles.",
    "",
    "Each angle has:",
    "- claim: one sentence saying what that video argues — not what it is",
    "  about. A subject is not a claim.",
    "- take: one sentence on why THIS reading of the seed rather than",
    "  another. This is what a person chooses between, so it has to name the",
    "  difference rather than restate the claim.",
    "- beats: five to eight, each with a role and a need.",
    "",
    "A beat has:",
    '- role: "subject" for the case being made, "counter" for the strongest',
    '  version of the other side, "outside" for a voice that is not the',
    "  speaker's own.",
    "- name: the beat in a few words.",
    "- need: WHAT THE FOOTAGE HAS TO SHOW, written as you would describe the",
    "  moment you are looking for. This is searched against real footage, so",
    "  describe the moment, not the argument.",
    "",
    "At least one counter beat per angle, because an argument with no other",
    "side is not an argument.",
    "",
    "Do not name, cite or invent any clip, timecode or quote — you have not",
    "seen the footage and will not. Do not say which angle is best or how",
    "well supported any of them is: you cannot know, and something else",
    "measures it.",
  ].join("\n");
}

/**
 * Proposes the slate. No grounding here, because nothing claims to be
 * grounded — exactly as draftPlan. What each angle would take is measured
 * afterwards, against the archive, by code that cannot hallucinate.
 */
export async function draftAngles(
  env: Env,
  seed: Seed,
): Promise<{ angles: Angle[]; tokensIn: number; tokensOut: number; model: string }> {
  /* Directing: what the video says. The same capability draftPlan resolves,
     for the same reason — this IS that call, asked three times over. */
  const model = resolveFor("direct", env);

  const res = await runRead(env, "angles", model.id, {
    messages: [
      { role: "system", content: systemPrompt(seed) },
      { role: "user", content: `Three ways to build this: ${seed.text}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    /*
     * Three plans, not one. draftPlan learned the hard way that 4000 cuts a
     * single claim-plus-beats off mid-structure; this asks for that three
     * times plus a take each, so it gets room in proportion rather than the
     * same figure with more to do.
     */
    /*
     * AND NO `upgrade` FLAG. draftPlan declares `opts: { upgrade?: boolean }`
     * and never reads it, so copying the signature here would have carried a
     * parameter that does nothing — and runRead passes its input straight to
     * the provider, so a stray `upgrade: true` would be sent to Workers AI
     * as a field it has never heard of. The tier is resolveFor's business.
     */
    max_tokens: 24_000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  return { angles: parseAngles(res), tokensIn, tokensOut, model: model.id };
}

/**
 * Reads the model's answer into angles.
 *
 * Pure and exported for the reason plan.ts gives: every way this fails is
 * quiet. An angle with no beats is a video that cannot be made; a beat with
 * no need finds nothing and reads as an empty library; an unrecognised role
 * would fall through to a label nobody wrote. All are dropped here rather
 * than carried into a slate somebody is choosing from.
 */
export function parseAngles(response: unknown): Angle[] {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return [];
    }
  }

  const obj = (parsed ?? {}) as { angles?: unknown };
  const raw = Array.isArray(obj.angles) ? (obj.angles as Array<Record<string, unknown>>) : [];

  const out: Angle[] = [];
  for (const a of raw) {
    const claim = typeof a.claim === "string" ? a.claim.trim() : "";
    const take = typeof a.take === "string" ? a.take.trim() : "";
    if (!claim) continue;

    const beats: Beat[] = [];
    for (const b of Array.isArray(a.beats) ? (a.beats as Array<Record<string, unknown>>) : []) {
      const need = typeof b.need === "string" ? b.need.trim() : "";
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!need || !name) continue;
      const role = ROLES.includes(b.role as Role) ? (b.role as Role) : "subject";
      beats.push({ role, name, need });
    }

    /* An angle with no beats is not a video that could be made. It is a
       sentence, and a slate of sentences is what this replaces. */
    if (!beats.length) continue;
    out.push({ claim, take, beats });
  }
  return out;
}

/**
 * WHAT EACH ANGLE WOULD TAKE, measured against the real archive.
 *
 * No model call. `has` is injected rather than imported so this stays a
 * pure function of its inputs — the caller passes whatever retrieval it
 * already uses, and the test passes a fake. That is also what keeps the
 * promise in this file's header true: nothing here can decide an angle is
 * well supported except by counting footage that exists.
 *
 * The bands are deliberately about BUILDABILITY and say so on screen. A
 * machine can know how much of a video you already have; it cannot know
 * which video you should make, and a band that implied it could would be
 * invariant 3 broken in the most expensive place — the moment somebody
 * picks what to spend a week on.
 */
export async function priceAngles(
  angles: Angle[],
  has: (need: string) => Promise<boolean>,
): Promise<PricedAngle[]> {
  const out: PricedAngle[] = [];
  for (const angle of angles) {
    let backed = 0;
    for (const beat of angle.beats) {
      if (await has(beat.need)) backed += 1;
    }
    const missing = angle.beats.length - backed;
    out.push({ ...angle, backed, missing, ...verdict(backed, angle.beats.length) });
  }
  return out;
}

/**
 * The band, and the sentence that caused it.
 *
 * Thresholds, not a score: most of it, some of it, little of it. They are
 * round numbers chosen to be legible rather than tuned, which is the honest
 * state of them — the same thing shorts.ts says about its own bands, and
 * the same remedy applies when there is real usage to read.
 */
export function verdict(backed: number, total: number): { band: Grade; why: string } {
  const missing = total - backed;
  const of = `${backed} of ${total} beats`;
  if (!total) return { band: "long", why: "no beats, so there is nothing to look for yet" };

  if (backed === total) {
    return { band: "strong", why: `${of} — you already have footage for all of it` };
  }
  if (backed * 2 >= total) {
    return {
      band: "strong",
      why: `${of} are in your footage; ${missing} would have to be found or filmed`,
    };
  }
  if (backed > 0) {
    return {
      band: "worth",
      why: `${of} are in your footage, so most of this one is Scout's work or a camera's`,
    };
  }
  return {
    band: "long",
    why: `nothing here meets any of its ${total} beats — every one would have to be found`,
  };
}

/** The band as a person reads it. One vocabulary, shared with Shorts. */
export const BAND_NAME = GRADE_NAME;
