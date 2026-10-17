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
import { resolveModel } from "./models.ts";

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

function systemPrompt(topic: string): string {
  return [
    "You are planning a video essay, before any footage has been looked at.",
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
export async function draftPlan(env: Env, topic: string, opts: { upgrade?: boolean } = {}): Promise<Draft> {
  const model = resolveModel("reason", env, opts.upgrade ? "upgrade" : "default");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt(topic) },
      { role: "user", content: `Plan it: ${topic}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 4000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const { claim, beats } = parsePlan(res);
  return { claim, beats, tokensIn, tokensOut, model: model.id };
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
 * AN OUTSIDE BEAT IS A GAP, HONESTLY. "One voice that isn't yours" means
 * footage the user did not shoot, which is Scout's job, and Scout is not
 * built. Searching their own library for it would return their own voice and
 * label it somebody else's — so outside beats find nothing on purpose and say
 * why.
 */
export const THIN_BELOW = 2;

export interface Found {
  beatId: string;
  clipIds: string[];
  thin: boolean;
  /** Why it is empty, when the reason is not "your library has nothing". */
  gap: string | null;
}

export async function findForBeats(
  beats: Array<{ id: string; role: Role; need: string }>,
  search: (need: string) => Promise<string[]>,
): Promise<Found[]> {
  const out: Found[] = [];
  for (const b of beats) {
    if (b.role === "outside") {
      out.push({
        beatId: b.id,
        clipIds: [],
        thin: true,
        gap: "a voice that isn't yours — nothing here can find that yet",
      });
      continue;
    }
    const clipIds = await search(b.need);
    out.push({ beatId: b.id, clipIds, thin: clipIds.length < THIN_BELOW, gap: null });
  }
  return out;
}
