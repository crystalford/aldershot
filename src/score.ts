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

import type { Env } from "./env.ts";
import { resolveModel } from "./models.ts";
import type { Segment } from "./sources.ts";
import { groundClips, parseClips, usageTokens, type ScoredClip } from "./grounding.ts";

export { groundClips, parseClips, type ScoredClip } from "./grounding.ts";

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
 * How much transcript goes into one call.
 *
 * The model's window is a million tokens, so this is not about fitting. It is
 * about two things a single call cannot give:
 *
 * - **Real progress.** A pass used to be one opaque call, so the job sat at
 *   0% from start to finish and the editor showed a label that never changed.
 *   The owner: "it's not giving like proper progress". Progress can only be
 *   honest if the work is actually divided, so it is.
 * - **Attention.** Asked to pick the best moments from three hours at once,
 *   a model returns things from the first stretch and thins out. Windows get
 *   read evenly.
 *
 * Characters rather than tokens because the prompt is built from characters
 * and the bound only has to be safe, not exact.
 */
const WINDOW_CHARS = 24_000;

/**
 * Splits the transcript into windows that do not cut a line in half.
 *
 * Segments are never split — a line's timecode prefix is what grounds the
 * model's answer, so half a line is worse than no line.
 */
export function windowSegments(segments: Segment[], max = WINDOW_CHARS): Segment[][] {
  const out: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;

  for (const seg of segments) {
    const cost = seg.text.length + 32;
    if (current.length && size + cost > max) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(seg);
    size += cost;
  }
  if (current.length) out.push(current);
  return out.length ? out : [segments];
}

/**
 * Runs the pass. Returns [] rather than throwing when the model finds nothing
 * — "a pass that finds nothing must say so honestly" (04-API-AND-JOBS.md §3).
 *
 * `onProgress` is called with a real fraction of the windows completed, so
 * the bar the user watches is measured work rather than elapsed time.
 */
/**
 * What the model is actually asked, when nothing was typed.
 *
 * Exported because the pass log shows the instruction, and an edit begun with
 * "Skip the brief" recorded an empty one — a row saying nothing was asked,
 * about a pass that plainly asked something. One definition, so the log and
 * the prompt cannot disagree.
 */
export const asked = (brief: string) => brief.trim() || "the moments worth keeping";

export async function scorePass(
  env: Env,
  segments: Segment[],
  brief: string,
  opts: {
    upgrade?: boolean;
    onProgress?: (fraction: number, done: number, total: number) => void;
  } = {},
): Promise<ScoreResult> {
  if (!segments.length) return { clips: [], tokensIn: 0, tokensOut: 0, model: "" };

  const model = resolveModel("reason", env, opts.upgrade ? "upgrade" : "default");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;
  const windows = windowSegments(segments);

  const clips: ScoredClip[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    const prompt = `What the user asked for: ${asked(brief)}\n\nTranscript:\n${transcriptForPrompt(window)}`;

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

    const used = usageTokens(res);
    tokensIn += used.tokensIn;
    tokensOut += used.tokensOut;

    /* Grounded against THIS window, so a model that wanders outside the lines
       it was shown is corrected rather than trusted. */
    clips.push(...groundClips(parseClips(res), window));

    opts.onProgress?.((i + 1) / windows.length, i + 1, windows.length);
  }

  /* One window can end mid-thought and the next pick the same thought up, so
     the same moment arrives twice. Transcript order, strongest kept. */
  clips.sort((a, b) => a.start_ms - b.start_ms);
  const merged: ScoredClip[] = [];
  for (const c of clips) {
    const last = merged[merged.length - 1];
    const overlap = last ? Math.min(last.end_ms, c.end_ms) - Math.max(last.start_ms, c.start_ms) : 0;
    if (last && overlap > 0 && overlap / Math.min(last.end_ms - last.start_ms, c.end_ms - c.start_ms) > 0.5) {
      if ((c.score ?? 0) > (last.score ?? 0)) merged[merged.length - 1] = c;
      continue;
    }
    merged.push(c);
  }

  return { clips: merged, tokensIn, tokensOut, model: model.id };
}
