/**
 * Essay outlines.
 *
 * "A topic with no source video produces an act structure whose every claim is
 * backed by a real clip or an honestly-marked gap" (06-BUILD-PLAN.md §Phase 7).
 * That sentence is the whole design of this module.
 *
 * An essay is built out of the LIBRARY rather than one source, so the model is
 * given a menu of real clips and may only cite their ids. A beat that cites
 * nothing gets marked `generated` or `stock` — visibly a gap the user has to
 * fill, never a claim quietly presented as supported.
 */

import type { Env } from "./env.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import { runRead } from "./llm.ts";

/** The design's own act names. */
export const ACTS = ["Setup", "Development", "Turn", "Resolution"] as const;
export type Act = (typeof ACTS)[number];

export interface MenuClip {
  id: string;
  quote: string;
  source_title: string;
}

export interface EssayBeat {
  act: Act;
  kind: "clip" | "vo" | "generated" | "stock";
  /** The clip that backs this beat, when one does. */
  clip_id?: string;
  /** What is said, or what the gap is for. */
  text: string;
}

export interface EssayOutline {
  beats: EssayBeat[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  /** Beats the model wanted backed by a clip that does not exist. */
  rejected: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    beats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          act: { type: "string" },
          kind: { type: "string" },
          clip_id: { type: "string" },
          text: { type: "string" },
        },
        /*
         * clip_id MUST be listed as required.
         *
         * Left optional, Cloudflare's json_schema mode silently drops it —
         * the model emits the citation (verified against the raw response)
         * and it never reaches us. Measured: 16 beats, 8 clip beats, 100% of
         * citations lost. Marking it required: 12 beats, 0 lost.
         *
         * The failure is invisible from the outside — the essay simply comes
         * back as all gaps, which reads like "your library has nothing
         * relevant" rather than "the citation was dropped in transit".
         */
        required: ["act", "kind", "text", "clip_id"],
      },
    },
  },
  required: ["beats"],
} as const;

function systemPrompt(topic: string, menu: MenuClip[]): string {
  return [
    "You are outlining a video essay from footage that already exists.",
    "",
    `Topic: ${topic}`,
    "",
    "Structure it in four acts: Setup, Development, Turn, Resolution.",
    "",
    "Below is EVERY clip available, each with a short id. These are the only",
    "clips that exist. You may cite an id only if it appears in this list.",
    "",
    menu.map((c, i) => `[c${i + 1}] "${c.quote.slice(0, 180)}" — ${c.source_title}`).join("\n"),
    "",
    "For each beat return:",
    '- act: one of "Setup", "Development", "Turn", "Resolution".',
    '- kind: "clip" if a clip above genuinely supports this point, "vo" for a',
    '  line the creator says, "stock" if it needs generic footage, "generated"',
    "  if it needs a made image.",
    '- clip_id: REQUIRED when kind is "clip", and it must be an id from the',
    "  list. Never invent one.",
    "- text: for a clip beat, one sentence on why it belongs here. For a vo",
    "  beat, the line to say. For stock or generated, what is needed.",
    "",
    "The rule that matters most: if no clip above supports a point you want to",
    'make, do NOT cite one. Mark the beat "stock" or "generated" and say what',
    "is missing. An honest gap is useful; a claim pointing at the wrong clip",
    "is worse than no claim at all.",
  ].join("\n");
}

/**
 * Drafts the outline.
 *
 * Beats citing a clip that is not in the menu are not dropped — they are
 * downgraded to `stock` with their text kept. The model wanted to make that
 * point; it just could not back it. Turning it into a visible gap preserves the
 * argument and makes the hole obvious, which is what the acceptance criterion
 * asks for.
 */
export async function draftOutline(
  env: Env,
  topic: string,
  menu: MenuClip[],
  opts: { upgrade?: boolean } = {},
): Promise<EssayOutline> {
  const model = resolveFor("direct", env);
  const run = (m: string, i: Record<string, unknown>) => runRead(env, "essay", m, i);

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt(topic, menu) },
      { role: "user", content: `Outline the essay: ${topic}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 8000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  const { beats, rejected } = groundOutline(res, menu);
  return { beats, tokensIn, tokensOut, model: model.id, rejected };
}

/**
 * Forces the outline onto real ground. Pure, so it is directly testable — and
 * it is the only thing standing between a model's confident citation and a
 * user believing a claim is supported when it is not.
 */
export function groundOutline(
  response: unknown,
  menu: MenuClip[],
): { beats: EssayBeat[]; rejected: number } {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      return { beats: [], rejected: 0 };
    }
  }

  const raw = Array.isArray((parsed as { beats?: unknown })?.beats)
    ? ((parsed as { beats: Array<Record<string, unknown>> }).beats)
    : [];

  /*
   * The menu presents clips as c1, c2, c3 rather than by their real ULID.
   *
   * This is not cosmetic. Asked to copy a 26-character random id, the model
   * describes the right clip and mistypes the reference — measured: 15 beats,
   * 0 backed, 8 citations rejected, while the beat text plainly referred to
   * clips that were in the menu. Short ids it can carry accurately; the real
   * id is looked up here, where a typo is impossible.
   */
  const byShort = new Map(menu.map((c, i) => [`c${i + 1}`, c.id]));
  const byReal = new Set(menu.map((c) => c.id));
  const resolve = (cited: string | undefined): string | undefined => {
    if (!cited) return undefined;
    const key = cited.trim().toLowerCase();
    // Accept the real id too, in case the model quotes it from the text.
    return byShort.get(key) ?? (byReal.has(cited) ? cited : undefined);
  };

  let rejected = 0;
  const beats: EssayBeat[] = [];

  for (const b of raw) {
    const act = ACTS.find((a) => a.toLowerCase() === String(b.act ?? "").toLowerCase()) ?? "Development";
    const wanted = String(b.kind ?? "vo").toLowerCase();
    const body = String(b.text ?? "").trim();
    if (!body) continue;

    const clipId = typeof b.clip_id === "string" ? b.clip_id : undefined;

    if (wanted === "clip") {
      const realId = resolve(clipId);
      if (realId) {
        beats.push({ act, kind: "clip", clip_id: realId, text: body });
      } else {
        // It wanted to cite something that does not exist. Keep the point,
        // mark the hole.
        rejected++;
        beats.push({ act, kind: "stock", text: body });
      }
      continue;
    }

    const kind = wanted === "stock" || wanted === "generated" ? (wanted as "stock" | "generated") : "vo";
    beats.push({ act, kind, text: body });
  }

  // Acts in order, so the essay reads as an argument rather than the order the
  // model happened to emit.
  return {
    beats: beats.sort((a, b2) => ACTS.indexOf(a.act) - ACTS.indexOf(b2.act)),
    rejected,
  };
}

/** How much of each act is backed by real footage, for act-level progress. */
export function actProgress(beats: EssayBeat[]): Array<{ act: Act; total: number; backed: number }> {
  return ACTS.map((act) => {
    const inAct = beats.filter((b) => b.act === act);
    return { act, total: inAct.length, backed: inAct.filter((b) => b.kind === "clip").length };
  });
}
