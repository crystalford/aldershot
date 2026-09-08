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
    /*
     * KEEP THESE, or CUT THESE.
     *
     * The same call answers both — "find the strong bits" and "cut the false
     * starts" both return the moments that match, and the two mean opposite
     * things about the other ninety per cent of the video. Without this a pass
     * could only annotate, which is why pressing Find the strong bits left the
     * cut exactly as long as it was.
     */
    action: { type: "string", enum: ["keep", "cut"] },
  },
  required: ["clips", "action"],
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
  "- score: 0-100, how well it satisfies the rules below AND what they asked",
  "  for. A moment that starts mid-sentence or needs context you have not",
  "  shown scores low however good the content is.",
  "- heat: 0, 1 or 2 — how densely interesting this stretch is.",
  "",
  "WHAT MAKES A MOMENT WORTH KEEPING. These are the rules, in order — a",
  "moment that breaks one of the first three is not a good moment however",
  "interesting it sounds:",
  "",
  "1. COMPLETE THOUGHT. It starts where the point starts and ends where it",
  "   lands. Never begin or end mid-sentence. A clipped sentence is the single",
  "   most common thing people throw these away for.",
  "2. SELF-CONTAINED. Somebody who has not heard the rest can follow it. If it",
  "   opens on \"that\", \"he\", \"this one\", \"like I said\", \"so anyway\" or",
  "   any other word pointing at something you have not shown them, either",
  "   start earlier so the reference is inside the moment, or leave it out.",
  "3. NOT HOUSEKEEPING. Sponsor and ad reads, \"like and subscribe\", mic",
  "   checks, \"can you hear me\", agenda recaps and sign-offs are never the",
  "   moment, whatever else is in them.",
  "4. THEN interesting: it makes a point, tells something, or lands a joke.",
  "",
  "Judge it on those, in that order. Do not judge it on how loud, fast or",
  "excited the speaker sounds — that reads as energy and is not the same",
  "thing as a moment worth watching.",
  "",
  "If nothing in the transcript matches, return an empty list. Saying you",
  "found nothing is a correct answer; padding the list is not.",
  "",
  "Then say what the user wants DONE with them, in `action`:",
  '  "keep" — these are what they want, and the rest of the video should go.',
  '           "find the strong bits", "keep only the ones under 20 seconds",',
  '           "just the story".',
  '  "cut"  — these are what they want removed, and the rest should stay.',
  '           "cut the false starts", "also cut the sponsor read",',
  '           "cut anything I said better later".',
  "This decides what happens to the other ninety per cent of the video, so",
  "read the sentence carefully. When it is genuinely ambiguous, say \"keep\".",
].join("\n");

export interface ScoreResult {
  clips: ScoredClip[];
  /** What to do with them — see the schema. "keep" when the model is unsure. */
  action: "keep" | "cut";
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

/**
 * How long one window may take before we stop waiting for it.
 *
 * There was no limit. The owner watched "reading it for meaning · 0%" for four
 * minutes on a three-minute video — one window, one call, and nothing in the
 * product able to tell the difference between a model thinking and a model
 * that was never going to answer. The only thing that would eventually have
 * noticed was the thirty-minute stale-job reaper.
 *
 * Ninety seconds is far longer than this model takes on a window of this size
 * and short enough that a wedged call is a failure you can retry rather than
 * an afternoon.
 */
/*
 * Ninety seconds flat was wrong, and it failed a real pass: a 13:56 video,
 * 116 lines, one window, "Couldn't work out what to keep: the model didn't
 * answer in time". A big window is a big prompt and legitimately takes longer
 * than a small one, so a fixed number is either too tight for the long ones or
 * useless for the short ones.
 *
 * Scaled to the work, with a floor that is generous and a ceiling that still
 * stops a wedged call holding a queue invocation all afternoon.
 */
const WINDOW_TIMEOUT_FLOOR_MS = 150_000;
const WINDOW_TIMEOUT_PER_KCHAR_MS = 12_000;
const WINDOW_TIMEOUT_CEIL_MS = 420_000;

export function windowTimeout(chars: number): number {
  return Math.min(
    WINDOW_TIMEOUT_CEIL_MS,
    WINDOW_TIMEOUT_FLOOR_MS + Math.round((chars / 1000) * WINDOW_TIMEOUT_PER_KCHAR_MS),
  );
}

/** One window, once, with a deadline and a single retry. */
async function readWindow(
  run: (m: string, i: Record<string, unknown>) => Promise<unknown>,
  modelId: string,
  window: Segment[],
  brief: string,
  timeoutMs: number,
): Promise<{ clips: ScoredClip[]; tokensIn: number; tokensOut: number; cutting: boolean }> {
  const prompt = `What the user asked for: ${asked(brief)}\n\nTranscript:\n${transcriptForPrompt(window)}`;

  const once = async () =>
    await run(modelId, {
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

  /*
   * One retry, after a pause.
   *
   * These fail because something was busy, and asking the same busy thing
   * again a millisecond later asks the same question. The same reasoning as
   * the queue consumer's backoff in src/queue.ts.
   */
  let res: unknown;
  try {
    res = await withDeadline(once(), timeoutMs);
  } catch {
    await new Promise((r) => setTimeout(r, 3_000));
    res = await withDeadline(once(), timeoutMs);
  }

  const used = usageTokens(res);
  return {
    /* Grounded against THIS window, so a model that wanders outside the lines
       it was shown is corrected rather than trusted. */
    clips: groundClips(parseClips(res), window),
    tokensIn: used.tokensIn,
    tokensOut: used.tokensOut,
    cutting: readAction(res) === "cut",
  };
}

/**
 * A promise, or a plain refusal to keep waiting for it.
 *
 * env.AI.run takes no AbortSignal, so the call itself cannot be cancelled —
 * this only stops the pass from being held hostage by it. The abandoned call
 * finishes into nothing, which costs tokens we would have spent anyway.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  /* The timer is CLEARED when the call wins. Left dangling it keeps the event
     loop alive for its full ninety seconds after the work is done — which in a
     queue consumer is ninety seconds of an invocation that has nothing to do,
     and in the test runner was a ninety-second suite. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("the model didn't answer in time")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function scorePass(
  env: Env,
  segments: Segment[],
  brief: string,
  opts: {
    upgrade?: boolean;
    onProgress?: (fraction: number, done: number, total: number) => void;
    /* Injectable so a stalled window can be tested in milliseconds rather than
       in three minutes. Nothing in the product passes it. */
    windowTimeoutMs?: number;
  } = {},
): Promise<ScoreResult> {
  if (!segments.length) return { clips: [], action: "keep", tokensIn: 0, tokensOut: 0, model: "" };

  const model = resolveModel("reason", env, opts.upgrade ? "upgrade" : "default");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;
  const windows = windowSegments(segments);

  /**
   * Windows are read AT THE SAME TIME.
   *
   * They were read one after another, and they have nothing to say to each
   * other — each is grounded against its own lines and the merge below is
   * already order-independent. A three-hour transcript is a dozen windows, so
   * running them in series made a pass twelve times longer than it had to be
   * for no gain at all.
   *
   * Bounded, because Workers AI is a shared resource and firing fifty calls at
   * once earns a rate limit rather than an answer.
   */
  const LANES = 4;
  const answers: Array<{ clips: ScoredClip[]; tokensIn: number; tokensOut: number; cutting: boolean }> =
    new Array(windows.length);

  let finished = 0;
  let next = 0;
  let lost = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= windows.length) return;
      const chars = windows[i].reduce((n, sg) => n + sg.text.length + 32, 0);
      try {
        answers[i] = await readWindow(
          run,
          model.id,
          windows[i],
          brief,
          opts.windowTimeoutMs ?? windowTimeout(chars),
        );
      } catch (err) {
        /*
         * ONE BAD WINDOW IS NOT A BAD PASS.
         *
         * This threw, and the throw came out of Promise.all, and the whole
         * pass failed — so eleven stretches the model had already read were
         * discarded because the twelfth was slow. The owner got "Couldn't work
         * out what to keep: the model didn't answer in time" on a fourteen
         * minute video and nothing else.
         *
         * A stretch nobody could read is a stretch with no moments in it,
         * which is a true and useful answer. Only a pass where EVERY window
         * failed has genuinely failed, and that is raised below.
         */
        lost++;
        answers[i] = { clips: [], tokensIn: 0, tokensOut: 0, cutting: false };
        console.log(`[score] window ${i + 1}/${windows.length}: ${err instanceof Error ? err.message : String(err)}`);
      }
      finished++;
      opts.onProgress?.(finished / windows.length, finished, windows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, windows.length) }, lane));

  /* Nothing was read at all. That is a failure, and it keeps its reason. */
  if (lost === windows.length) {
    throw new Error(
      windows.length === 1
        ? "the model didn't answer in time"
        : `the model didn't answer for any of the ${windows.length} stretches`,
    );
  }

  const clips: ScoredClip[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  /* A long transcript is read in windows and each one answers separately. One
     window saying "cut" is enough — an instruction is about the whole video,
     and treating a cut as a keep would strike everything the user wanted. */
  let cutting = false;

  for (const a of answers) {
    clips.push(...a.clips);
    tokensIn += a.tokensIn;
    tokensOut += a.tokensOut;
    if (a.cutting) cutting = true;
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

  /* The sentence wins. The model is the tie-break, not the authority. */
  const stated = actionFor(brief);
  return {
    clips: merged,
    action: stated ?? (cutting ? "cut" : "keep"),
    tokensIn,
    tokensOut,
    model: model.id,
  };
}

/**
 * Does this instruction mean KEEP what you find, or CUT it?
 *
 * Read from the sentence rather than from the model. The schema asks for an
 * `action` and the model usually gives one, but JSON mode here is not
 * constrained decoding — this file already says so about the clips — and a
 * field that silently goes missing would default every instruction to "keep",
 * which turns "cut the false starts" into "keep ONLY the false starts". That
 * is the one mistake in this whole feature that ruins an edit rather than
 * merely disappointing.
 *
 * So the sentence decides, deterministically and testably, and the model's
 * answer is only consulted when the sentence does not say.
 *
 * "cut it down to the strong bits" is the trap: it opens with a removal verb
 * and means the opposite. A removal verb only counts when what follows is the
 * thing being removed, so "down to", "to just" and "to only" put it back.
 */
export function actionFor(instruction: string): "keep" | "cut" | null {
  const t = instruction.toLowerCase().trim();
  if (!t) return null;

  /* "cut it down to X", "trim it to just X" — a removal verb pointed at the
     result rather than at what goes. */
  if (/\b(down to|to just|to only|so it.s just)\b/.test(t)) return "keep";

  if (/^(cut|remove|drop|delete|lose|get rid of|take out|strip)\b/.test(t)) return "cut";
  if (/\b(also cut|and cut|cut out|cut all|cut every|cut any|remove all|remove every|remove any)\b/.test(t)) return "cut";

  if (/^(keep|find|just|only|show|give me)\b/.test(t)) return "keep";
  if (/\b(keep only|only the|the best|the strongest|the funniest|worth keeping)\b/.test(t)) return "keep";

  return null;
}

/**
 * The model's own answer, when the sentence did not settle it.
 *
 * Anything unreadable is "keep", which is the safer of the two: keeping what
 * it found and cutting the rest is a visible, undoable edit, while mistaking a
 * keep for a cut strikes exactly the moments the user asked to see.
 */
function readAction(res: unknown): "keep" | "cut" {
  try {
    const raw = (res as { response?: unknown })?.response ?? res;
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (obj as { action?: string })?.action === "cut" ? "cut" : "keep";
  } catch {
    return "keep";
  }
}
