/**
 * SCAN: read a transcript in windows, one narrow question at a time.
 *
 * Spec 18 section 3.5. This is where a source stops being a title and starts
 * being evidence, and it is the step that costs real money — a small model
 * over twelve hours of transcript is most of a run's bill. Everything about
 * its shape is a consequence of two measurements from the labs research.
 *
 * NEVER STUFF A WHOLE VOD INTO A LONG CONTEXT. Non-literal matching collapses
 * past roughly 8 to 32K tokens: the model stops finding the thing and starts
 * agreeing that the thing is probably in there. A three-hour stream is around
 * 35,000 words, which is well past it. Chunk-and-scan is cheaper AND more
 * accurate, which is rare enough to be worth writing down.
 *
 * ONE NARROW QUESTION PER WINDOW. "Does the streamer address or insult a chat
 * member? Give the exact quote and the first word's id, or NONE." Several
 * beats means several passes over the same window, never one combined
 * question — a combined question gets one answer about whichever beat the
 * model found most interesting, and the other beats come back empty having
 * been paid for.
 *
 * WINDOWS START AT CROWD TIMESTAMPS WHERE THERE ARE ANY, and there usually
 * are: fans have already indexed this. A run that tiles a three-hour VOD from
 * the beginning spends forty windows to reach a moment four people had
 * already pointed at. The planner puts those first and tiles what is left
 * behind them, so a budget that runs out runs out having read the places
 * somebody said to look.
 *
 * AND "NONE" IS A VALID, EXPECTED ANSWER. Most windows do not contain the
 * thing. A scan that treats NONE as a failure retries, logs an error, or —
 * worst — nudges the prompt until something comes back, which is how a
 * fabricated quote is born. NONE is the common case and costs nothing to say.
 */

import type { Env } from "./env.ts";
import type { IndexedWord } from "./align.ts";
import { assistantText, usageTokens } from "./grounding.ts";
import { resolveModel } from "./models.ts";
import { type CrowdTimestamp, scanWindowStart } from "./scout-triage.ts";

/* ── Windows ────────────────────────────────────────────────────────────── */

/**
 * Spec 3.5's window, in tokens. Deliberately under the 8K floor where
 * non-literal matching starts to go, with room for the prompt around it.
 */
export const WINDOW_TOKENS = 2000;
/** The spec's overlap. A moment that straddles a boundary is in both halves. */
export const OVERLAP = 0.15;

/**
 * Tokens per word of English transcript.
 *
 * An ESTIMATE, and deliberately an over-estimate: there is no tokeniser in
 * this runtime, and the cost of guessing high is slightly smaller windows
 * while the cost of guessing low is a window that overflows the context and
 * takes the non-literal-matching collapse with it. 1.4 is above the usual
 * 1.3 for ordinary prose, and transcripts are worse than prose — disfluencies
 * and proper names both tokenise badly.
 */
export const TOKENS_PER_WORD = 1.4;

export const WORDS_PER_WINDOW = Math.floor(WINDOW_TOKENS / TOKENS_PER_WORD);
export const STRIDE = Math.max(1, Math.round(WORDS_PER_WINDOW * (1 - OVERLAP)));

export interface Window {
  /** Word indices, inclusive. The address everything downstream uses. */
  startWord: number;
  endWord: number;
  /** Seconds, read off the words. Never typed by anything. */
  tStartS: number;
  tEndS: number;
  /** Why this window exists. Crowd-anchored windows are read first. */
  anchor: "crowd" | "tile";
  /** For a crowd window: how many people pointed here. */
  weight: number;
  /** The words, for the prompt. */
  words: IndexedWord[];
}

/**
 * The window of WORDS_PER_WINDOW words starting at or before `startWord`.
 *
 * Not nullable. Three guards against an empty word list used to stand between
 * here and a caller — two `!words.length` tests and a `last < first` test —
 * and two of them could never run: the tiling and the coverage pass both
 * iterate over the WORDS, so a transcript with none produces no calls.
 *
 * The third is real, and the crowd loop is why: it iterates over crowd
 * SIGNALS, so a source with no readable transcript and four fans pointing
 * into it reaches this function with nothing to slice. That guard lives at
 * the top of planWindows, where it is the only one, and the test for it
 * passes crowd signals — which is what caught this while the other two were
 * being removed for being unreachable.
 */
const windowFrom = (
  words: IndexedWord[],
  startWord: number,
  anchor: "crowd" | "tile",
  weight = 0,
): Window => {
  /* A WINDOW NEAR THE END SLIDES BACK rather than ending short. A short
     window costs the same model call for less transcript, and the part it
     drops is the lead-in — the words before the moment, which are what make
     the moment legible and what the overlap exists to preserve. */
  const latest = Math.max(0, words.length - WORDS_PER_WINDOW);
  const first = Math.max(0, Math.min(startWord, latest));
  const last = Math.min(words.length - 1, first + WORDS_PER_WINDOW - 1);
  const slice = words.slice(first, last + 1);
  return {
    startWord: slice[0].index,
    endWord: slice[slice.length - 1].index,
    tStartS: slice[0].startMs / 1000,
    tEndS: slice[slice.length - 1].endMs / 1000,
    anchor,
    weight,
    words: slice,
  };
};

/** The first word at or after a given second. */
export function wordAtSecond(words: IndexedWord[], seconds: number): number {
  const ms = seconds * 1000;
  for (const w of words) if (w.endMs >= ms) return w.index;
  return Math.max(0, words.length - 1);
}

/**
 * Every window of a transcript, in the order they are worth reading.
 *
 * Crowd-anchored first, heaviest crowd first, then the tiling of whatever is
 * left. A tile whose middle already sits inside a crowd window is dropped: it
 * would be a second payment for words already read, and the overlap that
 * matters — a moment straddling a boundary — is handled by the fifteen per
 * cent, not by scanning the same stretch twice.
 *
 * The tiling still covers the WHOLE transcript when there are no crowd
 * signals, which is the case on every source nobody has indexed. That is the
 * expensive case and the honest one; the budget is what bounds it, and the
 * stopping rule says so by name when it does.
 */
export function planWindows(
  words: IndexedWord[],
  crowd: CrowdTimestamp[] = [],
): Window[] {
  /* The one guard that can fire: the crowd loop below iterates over crowd
     signals, not over words, so a source with no readable transcript and four
     fans pointing into it would otherwise reach windowFrom with nothing to
     slice. See its comment. */
  if (!words.length) return [];

  const out: Window[] = [];
  const covered: Array<[number, number]> = [];
  /*
   * TWO WINDOWS CLOSER TOGETHER THAN THE TILING WOULD PUT THEM ARE ONE
   * WINDOW. A crowd window starting a hundred and fifty words into another
   * shares eighty-nine per cent of it, and reading it again is a model call
   * for a stretch already read. One starting a stride away shares only the
   * overlap, which is the amount the overlap is for.
   */
  const alreadyRead = (startWord: number) => covered.some(([a]) => Math.abs(startWord - a) < STRIDE);

  /* Heaviest crowd first — the moment forty people timestamped before the one
     two people did. */
  for (const t of [...crowd].sort((a, b) => b.weight - a.weight || a.tS - b.tS)) {
    const at = wordAtSecond(words, scanWindowStart(t));
    const w = windowFrom(words, at, "crowd", t.weight);
    /* Clustering already merged timestamps twenty seconds apart, but two
       clusters a minute apart still land in substantially the same window. */
    if (alreadyRead(w.startWord)) continue;
    covered.push([w.startWord, w.endWord]);
    out.push(w);
  }

  for (let at = 0; at < words.length; at += STRIDE) {
    const w = windowFrom(words, at, "tile");
    if (alreadyRead(w.startWord)) continue;
    covered.push([w.startWord, w.endWord]);
    out.push(w);
  }

  /*
   * AND THEN A PASS THAT GUARANTEES COVERAGE, because neither of the two
   * above does.
   *
   * Dropping a near-duplicate window leaves a hole whenever two windows do
   * not overlap by enough to bridge the one between them — a window is 1428
   * words and a stride is 1214, so two of them reach 2642 and three strides
   * is 3642. Sliding the last window back off the end leaves another, since
   * the tile it replaced started later than it does.
   *
   * Both were real: a 9,000-word transcript lost its last 288 words, and a
   * beat in them would have come back a gap with the words never read. So
   * coverage is not an emergent property of the stride arithmetic here. It is
   * a pass, and the pass is what the acceptance test checks.
   */
  const merged: Array<[number, number]> = [];
  for (const [a, b] of [...covered].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    /* Math.max rather than `= b`: every window built here is exactly
       WORDS_PER_WINDOW long, so sorted by start they also end in order and
       the two are the same today. They stop being the same the day a window
       is built short. */
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  let at = 0;
  for (const [a, b] of merged) {
    while (at < a) {
      const w = windowFrom(words, at, "tile");
      out.push(w);
      at = w.endWord + 1;
    }
    at = Math.max(at, b + 1);
  }
  while (at < words.length) {
    const w = windowFrom(words, at, "tile");
    out.push(w);
    /* The cursor always advances: a window starting at `at` ends at least
       there, and one that slid back off the end ends at the last word. A
       `if (w.endWord + 1 <= at) break` used to guard against a loop that
       could not, and it could not fire. */
    at = w.endWord + 1;
  }

  return out;
}

/* ── The question ───────────────────────────────────────────────────────── */

/**
 * One beat, one question.
 *
 * Takes a single beat on purpose. A function that took several and joined
 * them would be the combined question the spec forbids, and it would be
 * cheaper per window, which is exactly why somebody would write it.
 */
export function questionFor(beat: { behaviour: string }): string {
  const b = beat.behaviour.trim().replace(/\.$/, "");
  return `Does this transcript show: ${b}?`;
}

/* ── The call ───────────────────────────────────────────────────────────── */

export const SCAN_PROMPT_VERSION = "scan-v1";

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    quote: { type: "string" },
    first_word_id: { type: "string" },
  },
  /* All three required for the reason essay.ts marks clip_id so: Cloudflare's
     json_schema mode drops optional properties, and an answer of QUOTE with
     no quote in it is a row that claims evidence and carries none. */
  required: ["answer", "quote", "first_word_id"],
} as const;

export interface ScanResult {
  /** NONE is the common case, and is not a failure. */
  answer: "QUOTE" | "NONE";
  quote: string;
  /**
   * The model's guess at where the quote starts. A HINT — the verifier uses
   * it to narrow a fuzzy search and to break ties, and it cannot move a
   * timestamp. Null when the model did not give a usable one, which changes
   * nothing about the verdict.
   */
  hintWordIndex: number | null;
  model: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

function systemPrompt(): string {
  return [
    "You are reading part of a transcript and answering ONE question about it.",
    "",
    "Each line is numbered with the id of its first word, like [w1240].",
    "",
    "If the transcript shows the thing asked about, answer QUOTE and give:",
    "- quote: the words AS THEY APPEAR, copied exactly. Not a summary, not",
    "  tidied up, not with the numbers turned into digits. One or two",
    "  sentences — the moment itself, not the paragraph around it.",
    "- first_word_id: the id beside the line the quote starts on.",
    "",
    'If it does not, answer NONE with an empty quote and an empty id. MOST',
    "WINDOWS DO NOT CONTAIN THE THING AND NONE IS THE EXPECTED ANSWER. Do not",
    "stretch a nearby passage to fit, and do not answer QUOTE because the",
    "subject seems like the sort of person who would.",
    "",
    "Answer about THIS transcript only. You have no other knowledge of these",
    "people and nothing else you know about them is evidence.",
  ].join("\n");
}

/**
 * The window as the model sees it, with a word id every few lines.
 *
 * THE IDS ARE WHY THIS IS NOT JUST THE TEXT. The model has to be able to say
 * where it found something, and it cannot count words. Marking every line
 * gives it something to copy instead of something to calculate — the same
 * reason essay.ts used short clip ids: asked to reproduce a long identifier,
 * a model describes the right thing and mistypes the reference.
 */
export function renderWindow(w: Window, wordsPerLine = 12): string {
  const lines: string[] = [];
  for (let i = 0; i < w.words.length; i += wordsPerLine) {
    const chunk = w.words.slice(i, i + wordsPerLine);
    lines.push(`[w${chunk[0].index}] ${chunk.map((x) => x.text).join(" ")}`);
  }
  return lines.join("\n");
}

/** Reads the answer. Pure and exported: every way this fails is quiet. */
export function parseScan(response: unknown, w: Window): Omit<ScanResult, "model" | "promptVersion" | "tokensIn" | "tokensOut"> {
  const text = assistantText(response) || (typeof response === "string" ? response : "");
  let parsed: unknown = response;
  if (text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try {
      parsed = JSON.parse(fenced ? fenced[1] : text);
    } catch {
      /* Prose instead of JSON is NONE, not an error. A scan that threw here
         would fail a workflow item over a window that probably had nothing in
         it anyway. */
      return { answer: "NONE", quote: "", hintWordIndex: null };
    }
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const quote = String(obj.quote ?? "").trim();
  const said = String(obj.answer ?? "").trim().toUpperCase();

  /* An answer of QUOTE with no quote in it is NONE. It is a row that would
     claim evidence and carry none, and the verifier would reject it anyway —
     at the cost of a verification and a hallucination against this model's
     rejection rate, for something that was never a claim. */
  if (said !== "QUOTE" || !quote) return { answer: "NONE", quote: "", hintWordIndex: null };

  const raw = String(obj.first_word_id ?? "");
  const digits = raw.match(/\d+/);
  let hintWordIndex: number | null = digits ? Number(digits[0]) : null;
  /* A hint outside this window is a hint about a different window. Dropped
     rather than clamped: the verifier searches the whole window without one,
     which is more generous than searching around a wrong answer. */
  if (hintWordIndex !== null && (hintWordIndex < w.startWord || hintWordIndex > w.endWord)) {
    hintWordIndex = null;
  }

  return { answer: "QUOTE", quote, hintWordIndex };
}

/**
 * One window, one question, one answer.
 *
 * A small model, per the spec: this is a reading-comprehension question over
 * two thousand tokens, run thousands of times, and the frontier tier is for
 * the two calls that direct the run rather than the ones that do the reading.
 */
export async function scanWindow(
  env: Env,
  w: Window,
  question: string,
): Promise<ScanResult> {
  const model = resolveModel("reason", env, "default");
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<unknown>;

  const res = await run(model.id, {
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: `${question}\n\nThe transcript:\n\n${renderWindow(w)}` },
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    /* Short on purpose. The answer is a quote and an id; a budget that allows
       an essay invites one, and the essay would be the model explaining why
       the passage nearly fits. */
    max_tokens: 400,
  });

  const { tokensIn, tokensOut } = usageTokens(res);
  return {
    ...parseScan(res, w),
    model: model.id,
    promptVersion: SCAN_PROMPT_VERSION,
    tokensIn,
    tokensOut,
  };
}
