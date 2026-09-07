/**
 * Clipping — scored vertical shorts, no brief needed.
 *
 * "Point at a video → scored vertical shorts with captions burned in"
 * (01-PRODUCT.md §Clipping). Unlike the score pass, there is no user sentence
 * to match: the model is asked what would stand alone as a post, and each
 * result has to say why it scored and where it was found.
 *
 * Grounding is the same as everywhere else — the model picks WHERE, and the
 * quote is rebuilt from our own transcript, so it cannot invent a line.
 */

import type { Env } from "./env.ts";
import { groundClips, parseClips, usageTokens, type ScoredClip } from "./grounding.ts";
import { windowSegments } from "./score.ts";
import { resolveModel } from "./models.ts";
import type { Segment } from "./sources.ts";

/** The batch controls, with the design's own values. */
export const CLIP_LENGTHS = [
  { id: "15-30", name: "15–30s", min: 15, max: 30 },
  { id: "30-60", name: "30–60s", min: 30, max: 60 },
  { id: "60-90", name: "60–90s", min: 60, max: 90 },
] as const;

export const CLIP_COUNTS = [4, 8, 12] as const;
export const ASPECTS = ["9:16", "1:1", "4:5"] as const;
export const CAPTION_STYLES = ["Bold", "Clean", "None"] as const;

export type ClipLength = (typeof CLIP_LENGTHS)[number]["id"];

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
        },
        required: ["start_ms", "end_ms", "why", "score"],
      },
    },
  },
  required: ["clips"],
} as const;

function systemPrompt(min: number, max: number, count: number): string {
  return [
    "You find the moments in a transcript that would stand alone as a short video.",
    "",
    `Return up to ${count} of them, each between ${min} and ${max} seconds long.`,
    "",
    "A good short has a hook in its first seconds and a satisfying finish. It",
    "must make sense to someone who has not seen the rest — no dangling",
    "pronouns, no answer to a question that was asked earlier and is not",
    "included.",
    "",
    "For each one:",
    "- start_ms and end_ms MUST come from the ranges shown. Never invent a",
    "  timecode, and never return a range the transcript does not cover.",
    "- why: a short, plain reason this would land, in the words a person would",
    '  use. Shown to the user exactly as written. Good: "Blunt admission,',
    '  lands in four seconds". Bad: "High engagement potential".',
    "- score: 0-100, how likely this is to do well on its own.",
    "",
    "If nothing in the transcript would stand alone, return an empty list.",
    "Saying you found nothing is a correct answer; padding the list is not.",
  ].join("\n");
}

export interface ShortsResult {
  clips: ScoredClip[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/*
 * WHY THIS IS NOT scorePass.
 *
 * They look like duplicates and were listed as such: two model passes both
 * meaning "find the good bits". Read side by side they ask different
 * questions. scorePass takes the user's sentence and returns what MATCHES it,
 * at whatever length the thought runs. This takes no brief and returns
 * moments that stand alone at a length you asked for, ranked so the best is
 * watched first.
 *
 * The duplication that actually hurt is gone: both windows the transcript the
 * same way, both ground against real timecodes, and Clipping is a subset of
 * the library rather than a rival to it. Merging the prompts as well would
 * mean one that does neither job properly.
 */
export async function findShorts(
  env: Env,
  segments: Segment[],
  opts: {
    length?: ClipLength;
    count?: number;
    upgrade?: boolean;
    onProgress?: (fraction: number, done: number, total: number) => void;
  } = {},
): Promise<ShortsResult> {
  if (!segments.length) return { clips: [], tokensIn: 0, tokensOut: 0, model: "" };

  const len = CLIP_LENGTHS.find((l) => l.id === opts.length) ?? CLIP_LENGTHS[1];
  const count = opts.count ?? 8;
  const model = resolveModel("reason", env, opts.upgrade ? "upgrade" : "default");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  /*
   * Read in windows, for the same two reasons the score pass does: progress
   * can only be honest if the work is actually divided, and asked for the best
   * moments in three hours at once a model returns things from the first
   * stretch and thins out. Clipping's bar sat at zero through the whole slow
   * part until this — the same complaint that was fixed for "Find the strong
   * bits" and left here.
   */
  const windows = windowSegments(segments);
  const grounded: ScoredClip[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    const transcript = window.map((sg) => `[${sg.start_ms}-${sg.end_ms}] ${sg.text}`).join("\n");

    const res = await run(model.id, {
      messages: [
        { role: "system", content: systemPrompt(len.min, len.max, count) },
        { role: "user", content: `Transcript:\n${transcript}` },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 8000,
    });

    const used = usageTokens(res);
    tokensIn += used.tokensIn;
    tokensOut += used.tokensOut;
    grounded.push(...groundClips(parseClips(res), window));
    opts.onProgress?.((i + 1) / windows.length, i + 1, windows.length);
  }

  return {
    // Highest-scoring first: Clipping is a triage surface, so the best should
    // be the first thing watched.
    clips: enforceLength(grounded, len.min, len.max).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, count),
    tokensIn,
    tokensOut,
    model: model.id,
  };
}

/**
 * Drops results outside the length the user asked for.
 *
 * Trimming them to fit would be worse: the model chose those boundaries
 * because that is where the thought starts and ends, and cutting to length
 * would clip the punchline. A short that does not fit the batch is not a
 * short the user asked for.
 */
export function enforceLength(clips: ScoredClip[], minS: number, maxS: number): ScoredClip[] {
  return clips.filter((c) => {
    const seconds = (c.end_ms - c.start_ms) / 1000;
    // A little slack either side — the model reasons in whole thoughts, not
    // stopwatch seconds, and rejecting a 31-second clip from a "15-30" batch
    // would throw away good material on a technicality.
    return seconds >= minS * 0.8 && seconds <= maxS * 1.25;
  });
}

/**
 * "Ask for a specific clip" — transcript search, NOT scoring
 * (01-PRODUCT.md §Clipping). The user already knows what they want, so
 * matching text is both faster and more honest than asking a model to guess.
 */
export function searchTranscript(segments: Segment[], query: string, padMs = 2000): ScoredClip[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return [];

  const hits: ScoredClip[] = [];
  for (const seg of segments) {
    const text = seg.text.toLowerCase();
    const matched = terms.filter((t) => text.includes(t));
    if (!matched.length) continue;

    hits.push({
      // Pad either side so the clip does not begin mid-sentence.
      start_ms: Math.max(0, seg.start_ms - padMs),
      end_ms: seg.end_ms + padMs,
      quote: seg.text,
      why: `Found “${matched.join("”, “")}” here`,
      // How much of what was asked for this line actually contains.
      score: Math.round((matched.length / terms.length) * 100),
      heat: 0,
    });
  }
  return hits.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
