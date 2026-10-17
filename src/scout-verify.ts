/**
 * THE VERIFIER. The one thing Scout is judged on.
 *
 * Spec 18 section 0: "every quote he hands back is in the source, word for
 * word, at the time he says, and a model never typed that timestamp." This is
 * the function that makes that true, and section 3.6 is explicit that it is
 * deterministic and uses no model. Not because a model could not judge
 * similarity, but because this is the step that CHECKS the model — a checker
 * that is itself a model call has nothing underneath it.
 *
 * It does three things and refuses the fourth.
 *
 * 1. Finds the quote in the transcript, exactly, as a sequence of words.
 * 2. Failing that, finds the nearest thing to it and SCORES the difference,
 *    so a paraphrase is labelled a paraphrase instead of silently passing as
 *    a quote or silently failing as a miss.
 * 3. Reads the times off the words it matched.
 *
 * And it never takes a time from the model. The model's `first_word_id` is a
 * HINT about where to look — it narrows the fuzzy search and it breaks ties
 * when a phrase occurs twice — and it cannot move a timestamp by one
 * millisecond. A model that returns the right quote with a confidently wrong
 * time gets the right time anyway, which is the difference between invariant
 * 2 being a sentence and being enforced.
 *
 * WHY TOKENS AND NOT A SUBSTRING. The spec says "norm(quote) is a substring
 * of norm(window text)", which is the right idea and the wrong unit: a
 * substring match gives a character offset, and what is needed out of the
 * other end is word ids. Matching a SEQUENCE OF WORDS gives those directly,
 * cannot match half a word, and is the same answer in every case a substring
 * match would have been right about.
 *
 * THE REJECTION RATE IS THE MEASUREMENT. Section 3.6: "log the rejection rate
 * per model and prompt version from day one. That rate is Scout's measured
 * hallucination rate, and it gates model swaps." Every result carries its
 * score for that reason — the thresholds are a policy that may move, and the
 * number underneath them is the evidence.
 */

import type { IndexedWord } from "./align.ts";

/* ── Normalising ────────────────────────────────────────────────────────── */

/**
 * Contractions, expanded before anything is split.
 *
 * Expanded rather than stripped because a recogniser and a model disagree
 * about them constantly — one writes "don't", the other "do not", and they
 * are the same words said once. Expanding BOTH sides makes them match; the
 * token count changes on both sides equally, which is why the word-id map
 * below allows two tokens to belong to one transcript word.
 *
 * "'s" is deliberately absent. "he's" is "he is" or "he has" and guessing
 * wrong turns a match into a near-miss; left alone it is one token on both
 * sides and matches itself.
 */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bcan't\b/g, "cannot"],
  [/\bwon't\b/g, "will not"],
  [/\bshan't\b/g, "shall not"],
  [/\bain't\b/g, "is not"],
  [/\b(\w+)n't\b/g, "$1 not"],
  [/\b(\w+)'ll\b/g, "$1 will"],
  [/\b(\w+)'ve\b/g, "$1 have"],
  [/\b(\w+)'re\b/g, "$1 are"],
  [/\b(\w+)'d\b/g, "$1 would"],
  [/\bgonna\b/g, "going to"],
  [/\bwanna\b/g, "want to"],
  [/\bgotta\b/g, "got to"],
];

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * One token's number words turned into digits.
 *
 * WITHIN A TOKEN ONLY. "twenty-five" is one token and becomes "25"; "twenty
 * five" is two tokens and stays "20" "5". Joining across tokens would change
 * the token count on one side and not the other, and the word-id map would
 * stop lining up with the transcript — a correctness problem to buy a
 * cosmetic match. Where the model writes "25" and the speaker said "twenty
 * five", the exact pass misses and the fuzzy pass catches it as a paraphrase,
 * which is an honest description of what happened.
 */
function digits(token: string): string {
  const parts = token.split("-").filter(Boolean);
  if (!parts.length || !parts.every((p) => p in UNITS || p in TENS)) return token;
  let total = 0;
  for (const p of parts) total += p in TENS ? TENS[p] : UNITS[p];
  return String(total);
}

/** Punctuation off the outside; an inner apostrophe or hyphen is part of the word. */
const strip = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * Text to comparable tokens. The spec's `norm`, in the unit that matters.
 *
 * Exported because it is the definition of "the same words" in this product,
 * and anything else that has to decide whether two quotes are the same thing
 * must decide it the same way or the answers disagree.
 */
export function normTokens(text: string): string[] {
  let s = (text || "").toLowerCase();
  /* Curly apostrophes first, or every contraction rule misses. */
  s = s.replace(/[‘’ʼ]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s
    .split(/\s+/)
    .map(strip)
    .filter(Boolean)
    .flatMap((t) => t.split(/\s+/))
    .map(digits)
    .filter(Boolean);
}

/**
 * The transcript as tokens, each remembering which word it came from.
 *
 * One transcript word can produce two tokens ("don't" becomes "do" "not"), so
 * the map is token index to word index and not the other way round. Without
 * it a match would know WHAT it found and not WHERE, which is the entire
 * output of this file.
 */
export interface Tokenised {
  tokens: string[];
  /** owner[i] is the index into the words array that token i came from. */
  owner: number[];
  words: IndexedWord[];
}

export function tokeniseWords(words: IndexedWord[]): Tokenised {
  const tokens: string[] = [];
  const owner: number[] = [];
  words.forEach((w, i) => {
    for (const t of normTokens(w.text)) {
      tokens.push(t);
      owner.push(i);
    }
  });
  return { tokens, owner, words };
}

/* ── Matching ───────────────────────────────────────────────────────────── */

/** Levenshtein over whole tokens. Two rows, because a transcript window is long. */
export function tokenDistance(a: string[], b: string[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. The spec's "token-level ratio". */
export function tokenRatio(a: string[], b: string[]): number {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - tokenDistance(a, b) / longest;
}

/* ── The thresholds ─────────────────────────────────────────────────────── */

/**
 * Spec 3.6's three bands. A policy, which is why they are named and exported
 * rather than typed into an `if`: the rejection rate measured against them is
 * what gates a model swap, and a threshold nobody can see is a threshold
 * nobody can argue with.
 */
export const VERIFIED_AT = 0.9;
export const PARAPHRASE_AT = 0.8;
/** How far either side of the model's hint the fuzzy pass is allowed to look. */
export const FUZZY_WINDOW_MS = 60_000;
/** How much transcript is kept either side of a find, for fairness. */
export const CONTEXT_MS = 90_000;

export type Verdict = "verified" | "paraphrase" | "rejected";

export interface Verification {
  verify: Verdict;
  /** 1 for an exact word-for-word match. The measurement, not the verdict. */
  matchScore: number;
  /** Word indices, inclusive. Null when nothing was close enough to point at. */
  span: { startWord: number; endWord: number } | null;
  /** Read off the matched words. Never from the model. */
  tStartS: number | null;
  tEndS: number | null;
  /** True when the match was word for word, before any fuzzy allowance. */
  exact: boolean;
  /** What was actually said, where that differs from what was quoted. */
  foundText: string | null;
}

const REJECTED: Verification = {
  verify: "rejected",
  matchScore: 0,
  span: null,
  tStartS: null,
  tEndS: null,
  exact: false,
  foundText: null,
};

/** Every place a token sequence occurs. */
function occurrences(hay: string[], needle: string[]): number[] {
  const at: number[] = [];
  if (!needle.length || needle.length > hay.length) return at;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    at.push(i);
  }
  return at;
}

function spanOf(t: Tokenised, from: number, length: number) {
  const startWord = t.owner[from];
  const endWord = t.owner[Math.min(from + length - 1, t.owner.length - 1)];
  return { startWord, endWord };
}

function timesOf(t: Tokenised, span: { startWord: number; endWord: number }) {
  const a = t.words[span.startWord];
  const b = t.words[span.endWord];
  return { tStartS: a.startMs / 1000, tEndS: b.endMs / 1000 };
}

const textOf = (t: Tokenised, span: { startWord: number; endWord: number }) =>
  t.words.slice(span.startWord, span.endWord + 1).map((w) => w.text).join(" ");

/**
 * Is this quote in this transcript, and if so, when?
 *
 * `hintWordIndex` is the model's `first_word_id`, and it is used for exactly
 * two things: narrowing the fuzzy search to plus or minus sixty seconds
 * around it, and choosing between two identical occurrences of the same
 * phrase. It cannot change a verdict and it cannot change a time. A hint
 * pointing at the wrong end of a two-hour stream still gets the right
 * timestamp out of an exact match, because the exact pass does not look at
 * it — it searches the whole window, which is what makes the timestamp the
 * transcript's rather than the model's.
 */
export function verifyQuote(
  quote: string,
  words: IndexedWord[],
  hintWordIndex?: number | null,
): Verification {
  const needle = normTokens(quote);
  if (!needle.length || !words.length) return REJECTED;

  const t = tokeniseWords(words);
  if (!t.tokens.length) return REJECTED;

  /* 1. EXACT. Over the whole window, not around the hint. */
  const found = occurrences(t.tokens, needle);
  if (found.length) {
    /* Two identical phrases in one window is the only thing the hint decides,
       and it decides WHICH, never WHEN. */
    const hint = typeof hintWordIndex === "number" ? hintWordIndex : null;
    let at = found[0];
    if (hint !== null && found.length > 1) {
      let best = Infinity;
      for (const i of found) {
        const d = Math.abs(t.owner[i] - hint);
        if (d < best) {
          best = d;
          at = i;
        }
      }
    }
    const span = spanOf(t, at, needle.length);
    return { verify: "verified", matchScore: 1, span, ...timesOf(t, span), exact: true, foundText: null };
  }

  /* 2. FUZZY, within sixty seconds of the hint. With no hint there is nowhere
        to centre the search, so the whole window is the window — which is
        slower and strictly more generous, never less. */
  const centreMs =
    typeof hintWordIndex === "number" && words[hintWordIndex]
      ? words[hintWordIndex].startMs
      : null;

  let lo = 0;
  let hi = t.tokens.length - 1;
  if (centreMs !== null) {
    lo = t.tokens.length;
    hi = -1;
    t.owner.forEach((w, i) => {
      const ms = words[w].startMs;
      if (ms < centreMs - FUZZY_WINDOW_MS || ms > centreMs + FUZZY_WINDOW_MS) return;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    });
    if (hi < lo) return REJECTED;
  }

  /*
   * Lengths within twenty per cent either way. A paraphrase adds or drops a
   * word or two; one that adds a third of them is not the same sentence, and
   * trying every length would spend the time to prove it.
   */
  const L = needle.length;
  const lengths = new Set<number>();
  for (const f of [1, 0.9, 1.1, 0.8, 1.2]) lengths.add(Math.max(1, Math.round(L * f)));

  let bestScore = 0;
  let bestSpan: { startWord: number; endWord: number } | null = null;

  for (const len of lengths) {
    for (let i = lo; i + len - 1 <= hi; i++) {
      const score = tokenRatio(needle, t.tokens.slice(i, i + len));
      if (score > bestScore) {
        bestScore = score;
        bestSpan = spanOf(t, i, len);
      }
    }
  }

  if (!bestSpan || bestScore < PARAPHRASE_AT) {
    /* The score is kept even on a rejection: it is the measurement that gates
       a model swap, and "rejected at 0.79" and "rejected at 0.02" are
       different facts about a model. */
    return { ...REJECTED, matchScore: bestSpan ? Number(bestScore.toFixed(4)) : 0 };
  }

  return {
    verify: bestScore >= VERIFIED_AT ? "verified" : "paraphrase",
    matchScore: Number(bestScore.toFixed(4)),
    span: bestSpan,
    ...timesOf(t, bestSpan),
    exact: false,
    foundText: textOf(t, bestSpan),
  };
}

/* ── Context ────────────────────────────────────────────────────────────── */

export interface Context {
  before: string;
  after: string;
}

/**
 * Ninety seconds either side, stored at find time.
 *
 * Spec 3.6 step 4, and its parenthesis says why: "the provocation before the
 * outburst". A quote can be accurate and unfair, and the only moment the
 * surrounding words are cheap to keep is the moment the transcript is already
 * open. Going back for them later means the VOD has expired, the channel is
 * gone, or the words cost another transcription.
 */
export function contextAround(
  words: IndexedWord[],
  span: { startWord: number; endWord: number },
  ms = CONTEXT_MS,
): Context {
  const startMs = words[span.startWord]?.startMs ?? 0;
  const endMs = words[span.endWord]?.endMs ?? 0;
  const before: string[] = [];
  const after: string[] = [];
  for (const w of words) {
    if (w.index < span.startWord && w.endMs >= startMs - ms) before.push(w.text);
    else if (w.index > span.endWord && w.startMs <= endMs + ms) after.push(w.text);
  }
  return { before: before.join(" "), after: after.join(" ") };
}

/* ── The measurement ────────────────────────────────────────────────────── */

export interface RejectionRate {
  model: string;
  promptVersion: string;
  verified: number;
  paraphrase: number;
  rejected: number;
  /** The headline: how often this model said something that was not there. */
  rate: number;
}

/**
 * Scout's measured hallucination rate, per model and prompt version.
 *
 * Spec 3.6: "log the rejection rate per model and prompt version from day
 * one ... that rate gates model swaps." A paraphrase counts as neither — it
 * is a human's decision, not a failure — so the rate is rejections over
 * rejections plus verifications, and a run that produced only paraphrases
 * reports no rate rather than zero.
 */
export function rejectionRate(
  rows: Array<{ verify: Verdict; model: string; promptVersion: string }>,
): RejectionRate[] {
  const by = new Map<string, RejectionRate>();
  for (const r of rows) {
    const key = r.model + "\u0000" + r.promptVersion;
    const cell =
      by.get(key) ??
      { model: r.model, promptVersion: r.promptVersion, verified: 0, paraphrase: 0, rejected: 0, rate: 0 };
    cell[r.verify] += 1;
    by.set(key, cell);
  }
  for (const cell of by.values()) {
    const decided = cell.verified + cell.rejected;
    cell.rate = decided ? Number((cell.rejected / decided).toFixed(4)) : 0;
  }
  return [...by.values()];
}
