/**
 * Reaction placement.
 *
 * "Output beats alternating `clip` and `react`, where each `react` beat carries
 * a drafted script line the user can read aloud or ignore"
 * (04-API-AND-JOBS.md §4).
 *
 * The draft matters: a reaction project is unusable if the user has to invent
 * something to say at every gap from a blank page. But it is a suggestion, not
 * a script — they record whatever they actually want, and the beat keeps
 * whichever they end up with.
 */

import type { Env } from "./env.ts";
import { groundTraced, parseClips, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import type { Segment } from "./sources.ts";
import { runRead } from "./llm.ts";
import { plainRegister } from "./register.ts";

const SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_ms: { type: "number" },
          end_ms: { type: "number" },
          why: { type: "string" },
          score: { type: "number" },
          say: { type: "string" },
        },
        required: ["start_ms", "end_ms", "why", "score", "say"],
      },
    },
  },
  required: ["clips"],
} as const;

/*
 * PLAIN REGISTER. This opened "You are laying out a reaction video", which is
 * invariant 10 exactly: the intent parse read "react to this" — doc 05 says
 * that is the one place allowed to — and then handed the word straight to the
 * writer. Everything below already says what the job IS, so the costume was
 * carrying no information at all.
 */
function systemPrompt(about: string): string {
  return [
    "You are laying out where a creator stops a clip to speak.",
    "",
    `The creator wants to react to: ${about}`,
    "",
    "Pick the moments worth stopping on, in the order they happen. For each:",
    "- start_ms and end_ms MUST come from the ranges shown. Never invent a",
    "  timecode.",
    "- why: a short plain reason this moment is worth reacting to.",
    "- say: one or two sentences the creator could say AFTER this clip plays.",
    "  Write it as someone talking, not as narration — contractions, a real",
    "  opinion, no throat-clearing. They will read it aloud or ignore it, so",
    "  make it worth reading.",
    "- score: 0-100, how much this moment deserves a reaction.",
    "",
    "Leave room between reactions — a clip every few seconds is exhausting to",
    "watch. If nothing in this transcript is worth reacting to, return an",
    "empty list rather than padding it.",
  ].join("\n");
}

export interface ReactionBeat {
  kind: "clip" | "react";
  start_ms?: number;
  end_ms?: number;
  quote?: string;
  why?: string;
  /** The drafted line, on react beats. */
  say?: string;
}

export interface ReactionResult {
  beats: ReactionBeat[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/** Interleaves clips with the reactions drafted for them. */
export async function placeReactions(
  env: Env,
  segments: Segment[],
  rawAbout: string,
  opts: { upgrade?: boolean } = {},
): Promise<ReactionResult> {
  if (!segments.length) return { beats: [], tokensIn: 0, tokensOut: 0, model: "" };

  /* Invariant 10: the intent parse already read "react to this" — doc 05 says
     that is the one place allowed to. It does not travel further. */
  const { said: about } = plainRegister(rawAbout);
  const model = resolveFor("direct", env);
  const transcript = segments.map((s) => `[${s.start_ms}-${s.end_ms}] ${s.text}`).join("\n");
  const run = (m: string, i: Record<string, unknown>) => runRead(env, "reactions", m, i);

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt(about) },
      { role: "user", content: `Transcript:\n${transcript}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 8000,
  });

  const raw = parseClips(res);
  /*
   * THE RANGES ARE GROUNDED AND THE DRAFTED LINES RIDE ALONG BY INDEX.
   *
   * Invariant 2 for the ranges: groundTraced drops a range the transcript
   * does not contain and snaps the rest to segment edges, so nothing the
   * model typed as a millisecond reaches a beat. The prompt below also asks
   * it not to invent a timecode, and that line is politeness — this call is
   * the enforcement, and `times` in the gate is what keeps the two together.
   *
   * The lines used to be matched back by the model's OWN start_ms, with a
   * two-second fallback to the nearest draft. So a model that shifted its
   * milliseconds — exactly what grounding exists to tolerate — handed the
   * creator a sentence written about a different clip. `from` is our index
   * into the list we parsed, so the pairing is the one the model actually
   * made rather than one re-derived from a number we do not trust.
   */
  const grounded = groundTraced(raw, segments);

  const beats: ReactionBeat[] = [];
  for (const clip of grounded) {
    beats.push({
      kind: "clip",
      start_ms: clip.start_ms,
      end_ms: clip.end_ms,
      quote: clip.quote,
      why: clip.why ?? undefined,
    });
    const say = String((raw[clip.from] as { say?: string } | undefined)?.say ?? "").trim();
    beats.push({ kind: "react", say });
  }

  const { tokensIn, tokensOut } = usageTokens(res);
  return { beats, tokensIn, tokensOut, model: model.id };
}
