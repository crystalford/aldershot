/**
 * The score pass — LLM pass #1 over a transcript, using the user's sentence.
 *
 * This is where "type a sentence, get a cut" actually happens. It reads the
 * whole transcript and returns the moments worth keeping, each with a short
 * human reason that is shown in the UI verbatim (04-API-AND-JOBS.md §2).
 *
 * Grounding rule, inherited from every AI feature in this product: the model
 * only ever points at real timecodes in a real transcript. It cannot invent a
 * quote, because quotes are rebuilt from the segments we already have rather
 * than taken from the model's output.
 */

import type { Env } from "./env";
import { resolveModel } from "./models";
import type { Segment } from "./sources";
import { groundClips, parseClips, usageTokens, type ScoredClip } from "./grounding";

export { groundClips, parseClips, type ScoredClip } from "./grounding";

/** What the model is asked to return. Kept strict and small. */
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
          heat: { type: "number" },
        },
        required: ["start_ms", "end_ms", "why", "score"],
      },
    },
  },
  required: ["clips"],
} as const;

function transcriptForPrompt(segments: Segment[]): string {
  return segments.map((s) => `[${s.start_ms}-${s.end_ms}] ${s.text}`).join("\n");
}

const SYSTEM = [
  "You pick the moments worth keeping from a transcript.",
  "",
  "You are given a transcript where every line is prefixed with its real",
  "millisecond range, and a sentence from the user saying what they want.",
  "",
  "Return the moments that match what they asked for. For each one:",
  "- start_ms and end_ms MUST be taken from the ranges shown. Never invent a",
  "  timecode, and never return a range the transcript does not cover.",
  "- why: a short, plain reason this moment was kept, in the words a person",
  "  would use. It is shown to the user exactly as you write it.",
  '  Good: "Awkward closer — good button". Bad: "This segment exhibits high",',
  '  "engagement potential".',
  "- score: 0-100, how strongly it matches what they asked for.",
  "- heat: 0, 1 or 2 — how densely interesting this stretch is.",
  "",
  "Prefer whole thoughts over fragments: start where the point starts and end",
  "where it lands. If nothing in the transcript matches, return an empty list.",
  "Saying you found nothing is a correct answer; padding the list is not.",
].join("\n");

export interface ScoreResult {
  clips: ScoredClip[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/**
 * Runs the pass. Returns [] rather than throwing when the model finds nothing
 * — "a pass that finds nothing must say so honestly" (04-API-AND-JOBS.md §3).
 */
export async function scorePass(
  env: Env,
  segments: Segment[],
  brief: string,
  opts: { upgrade?: boolean } = {},
): Promise<ScoreResult> {
  if (!segments.length) return { clips: [], tokensIn: 0, tokensOut: 0, model: "" };

  const model = resolveModel("reason", env, opts.upgrade ? "upgrade" : "default");
  const prompt = `What the user asked for: ${brief.trim() || "the moments worth keeping"}\n\nTranscript:\n${transcriptForPrompt(segments)}`;

  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  const res = await run(model.id, {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    // JSON mode is not constrained decoding — Cloudflare's own docs warn the
    // model may not respect the schema — so the parse below repairs and
    // validates rather than trusting it.
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 8000,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  return { clips: groundClips(parseClips(res), segments), tokensIn, tokensOut, model: model.id };
}
