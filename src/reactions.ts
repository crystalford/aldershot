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
import { groundClips, parseClips, usageTokens } from "./grounding.ts";
import { resolveFor } from "./models.ts";
import type { Segment } from "./sources.ts";
import { runRead } from "./llm.ts";

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

function systemPrompt(about: string): string {
  return [
    "You are laying out a reaction video.",
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
  about: string,
  opts: { upgrade?: boolean } = {},
): Promise<ReactionResult> {
  if (!segments.length) return { beats: [], tokensIn: 0, tokensOut: 0, model: "" };

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
  // Ground the ranges the same way as everywhere else, then carry the drafted
  // line across by position — grounding drops invented timecodes, so the two
  // lists are matched on the range that survived rather than on index.
  const grounded = groundClips(raw, segments);
  const sayFor = new Map(
    raw
      .filter((r) => typeof r.start_ms === "number")
      .map((r) => [Math.round(Number(r.start_ms)), String((r as { say?: string }).say ?? "")]),
  );

  const beats: ReactionBeat[] = [];
  for (const clip of grounded) {
    beats.push({
      kind: "clip",
      start_ms: clip.start_ms,
      end_ms: clip.end_ms,
      quote: clip.quote,
      why: clip.why ?? undefined,
    });
    // Nearest drafted line for this range — the grounded start may have been
    // clamped to the transcript's own bounds.
    const say = sayFor.get(clip.start_ms) ?? nearest(sayFor, clip.start_ms);
    beats.push({ kind: "react", say: say || "" });
  }

  const { tokensIn, tokensOut } = usageTokens(res);
  return { beats, tokensIn, tokensOut, model: model.id };
}

function nearest(map: Map<number, string>, target: number): string {
  let best = "";
  let bestDelta = Infinity;
  for (const [ms, say] of map) {
    const delta = Math.abs(ms - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = say;
    }
  }
  // Only trust it if it is genuinely the same moment; a line drafted for a
  // different clip is worse than no line at all.
  return bestDelta <= 2000 ? best : "";
}
