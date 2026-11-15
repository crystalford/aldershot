/**
 * DUCK BY WORD TIMINGS — Phase 5's sound rule, and the reason it is not a
 * compressor.
 *
 * The container already ducks a clip's own audio under a voice-over, with
 * `sidechaincompress` keyed off the voice. That is how it is done when you
 * do not know where the words are. We do know: a take is force-aligned
 * (src/take.ts) and `beats.take_words` holds every word with its start and
 * end, which is the one thing in this product that knows where speech is in
 * a recording.
 *
 * SO THE ENVELOPE IS COMPUTED, NOT REACTED TO, and that is three different
 * fixes at once:
 *
 *   A sidechain ducks for a cough, a chair, a door and a breath, because it
 *   hears level and not language.
 *   It does NOT duck for a quiet word, so the one line somebody leaned away
 *   from the mic for is the line the bed buries.
 *   And it pumps: the bed rises in every half-second between sentences and
 *   drops again, which is the artefact a listener hears as "edited".
 *
 * AND IT IS A MEASUREMENT, which makes it invariant 1's kind of thing. A
 * cut is re-produced from rules; so is its mix. The same words give the same
 * envelope on every render, and a person can be shown where the bed moves
 * and why, because the answer is "there is a word there".
 *
 * NOTHING HERE IS A MODEL CALL and nothing here touches audio. It turns word
 * spans into one ffmpeg expression; the container applies it.
 */

/** A word with its span, in SECONDS — the shape `beats.take_words` stores. */
export interface TimedWord {
  w?: string;
  s: number;
  e: number;
}

export interface Run {
  startS: number;
  endS: number;
}

/**
 * HOW FAR UNDER THE VOICE THE BED SITS.
 *
 * −12 dB leaves the clip clearly audible and clearly behind, which is what
 * the sidechain this replaces was reaching for: its own comment says "the
 * clip should still be audible underneath, just clearly behind".
 */
export const DUCK_DB = -12;

/**
 * The bed is down BEFORE the first syllable.
 *
 * A duck that begins on the word clips its attack, and the attack is where
 * a consonant lives — so the word arrives sounding soft and the listener
 * hears the edit rather than the sentence.
 */
export const LEAD_S = 0.18;

/**
 * And comes back slowly after the last.
 *
 * 0.35s, which is the release the sidechain already used (`release=350`) —
 * a number somebody in this codebase already chose by ear, kept rather than
 * replaced with a fresh guess.
 */
export const TAIL_S = 0.35;

/**
 * THE ANTI-PUMP RULE, and the one number this file turns on.
 *
 * Gaps shorter than this do not bring the bed back up. A natural pause
 * between sentences is half a second; raising music for 400ms and dropping
 * it again is exactly the pumping a compressor does and the reason this is
 * computed instead.
 *
 * AND IT MUST EXCEED LEAD + TAIL. Two runs closer than their own shoulders
 * would have those shoulders overlap, the terms in the expression would sum
 * above 1, and the bed would duck further than −12 dB for no reason anybody
 * could point at. `SHOULDERS_FIT` asserts the relationship rather than
 * leaving it as an arithmetic coincidence that a later tweak could break.
 */
export const GAP_S = 0.6;

export const SHOULDERS_FIT = GAP_S > LEAD_S + TAIL_S;

/**
 * The most runs one expression carries.
 *
 * An ffmpeg expression is parsed per frame; a few hundred terms is a real
 * cost for a bed nobody is listening to that closely. Past this the caller
 * is told so and keeps the sidechain, which is worse and bounded — see
 * `plan` below.
 */
export const MAX_RUNS = 80;

/**
 * Words into speech runs, with short gaps closed.
 *
 * Sorted first, because a word list that arrived out of order would produce
 * runs that overlap and an expression that over-ducks. Zero-length and
 * reversed spans are dropped rather than repaired: a word the aligner could
 * not place is not a reason to move the bed.
 */
export function speechRuns(words: readonly TimedWord[], gapS = GAP_S): Run[] {
  const spans = words
    .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s)
    .map((w) => ({ startS: w.s, endS: w.e }))
    .sort((a, b) => a.startS - b.startS);

  const out: Run[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.startS - last.endS < gapS) {
      last.endS = Math.max(last.endS, s.endS);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export interface Point {
  tS: number;
  /** A multiplier, 1 for full level. Never dB — that is for the expression. */
  gain: number;
}

/** −12 dB as a multiplier. 20log10 because this is amplitude, not power. */
export const gainOf = (db: number): number => 10 ** (db / 20);

/**
 * The envelope as points, which is what the tests can actually check.
 *
 * A trapezoid per run: full level, down over the lead, held under the words,
 * up over the tail. Clamped to the media, so a take that starts on its first
 * frame still gets a duck rather than a ramp from before time zero.
 */
export function envelope(
  runs: readonly Run[],
  opts: { durationS: number; duckDb?: number; leadS?: number; tailS?: number } = { durationS: 0 },
): Point[] {
  const duck = gainOf(opts.duckDb ?? DUCK_DB);
  const lead = opts.leadS ?? LEAD_S;
  const tail = opts.tailS ?? TAIL_S;
  const end = Math.max(0, opts.durationS);

  /*
   * THE FILE DOES NOT ALWAYS OPEN AT FULL LEVEL.
   *
   * A take whose first word lands inside the lead time has its ramp clipped
   * by time zero, and then the bed has to START down — there is a word at
   * the top of the file. Opening with {0, 1} regardless produced two points
   * at t=0 with different gains, which is not an envelope, it is an
   * ambiguity: a reader and an interpolator would disagree about the first
   * sample. Found by a test asking what the gain is over a word at 0:00.
   */
  const opensOnSpeech = runs.some((r) => r.startS - lead <= 0);
  const pts: Point[] = opensOnSpeech ? [] : [{ tS: 0, gain: 1 }];
  for (const r of runs) {
    const a = Math.max(0, r.startS - lead);
    const b = Math.min(end || r.endS + tail, r.endS + tail);
    if (a > 0) pts.push({ tS: a, gain: 1 });
    else pts.push({ tS: 0, gain: duck });
    pts.push({ tS: r.startS, gain: duck });
    pts.push({ tS: r.endS, gain: duck });
    pts.push({ tS: b, gain: 1 });
  }
  if (end > 0) pts.push({ tS: end, gain: 1 });

  /* Monotonic in time, and no two points at the same instant — an expression
     built from a non-monotonic list would ramp backwards. */
  return pts
    .filter((p) => p.tS >= 0 && (!end || p.tS <= end))
    .sort((x, y) => x.tS - y.tS)
    .filter((p, i, all) => i === 0 || p.tS > all[i - 1].tS || p.gain !== all[i - 1].gain);
}

const n3 = (v: number): string => v.toFixed(3);

/**
 * ONE ffmpeg `volume` EXPRESSION for the whole bed.
 *
 * Each run contributes a trapezoid that is 0 away from it and 1 under the
 * words, built from `min`/`max` rather than branches so there is nothing to
 * get wrong about precedence:
 *
 *   f = min(max(min((t−A)/lead, (B−t)/tail), 0), 1)
 *
 * and the gain is `1 − (1−duck) · Σf`. The sum is safe because `GAP_S`
 * exceeds lead + tail, so no two trapezoids are ever non-zero at the same
 * instant — which is the whole reason that constant has the value it does.
 */
export function volumeExpr(
  runs: readonly Run[],
  opts: { duckDb?: number; leadS?: number; tailS?: number } = {},
): string {
  const duck = gainOf(opts.duckDb ?? DUCK_DB);
  const lead = opts.leadS ?? LEAD_S;
  const tail = opts.tailS ?? TAIL_S;
  if (!runs.length) return "1";

  const terms = runs.map((r) => {
    const a = Math.max(0, r.startS - lead);
    const b = r.endS + tail;
    /*
     * BACKSLASH-COMMA, AND IT IS BELT AND BRACES — measured, after a first
     * version of this comment claimed more than was true.
     *
     * The claim was that an unescaped comma would end the volume filter and
     * the rest of the expression would parse as another filter. It does not,
     * where the expression is quoted and handed to ffmpeg as one argv
     * element — which is how both container/render.mjs and
     * scripts/check-duck.cjs build it. Both forms were run through real
     * ffmpeg inside a filter_complex and both duck the bed to the same
     * −33.03 dB at the same instant.
     *
     * The escape stays because it costs nothing and is correct in the one
     * case where the quoting is lost — a filtergraph assembled as a single
     * shell string, which nothing here does today and which is one refactor
     * away. What is no longer claimed is that ffmpeg requires it.
     *
     * (The first version of the LINE was a real bug: `\,` inside a template
     * literal is a plain comma to JavaScript, so nothing was escaped. That
     * was worth fixing. The reason given for fixing it was wrong.)
     */
    return `min(max(min((t-${n3(a)})/${n3(lead)}\\,(${n3(b)}-t)/${n3(tail)})\\,0)\\,1)`;
  });
  return `1-${n3(1 - duck)}*(${terms.join("+")})`;
}

export interface Plan {
  /** The expression, or null when the bed should be left alone. */
  expr: string | null;
  runs: Run[];
  /** Why there is no expression, for the log and for a person asking. */
  why: string;
}

/**
 * WHAT TO DO WITH THIS TAKE'S WORDS, including doing nothing.
 *
 * NO WORDS IS NOT NO DUCKING — it is "we do not know where the speech is",
 * and the container's sidechain is the honest answer to that: worse, and
 * better than a bed at full level under somebody talking. A take whose
 * alignment failed is exactly that case, and src/align-source.ts already
 * refuses to call such a take frame-accurate.
 */
export function plan(words: readonly TimedWord[], durationS: number): Plan {
  const runs = speechRuns(words);
  if (!runs.length) {
    return { expr: null, runs: [], why: "no word timings for this take — the sidechain keys off the voice instead" };
  }
  if (runs.length > MAX_RUNS) {
    return {
      expr: null,
      runs,
      why: `${runs.length} separate runs of speech is past the ${MAX_RUNS} one expression carries — the sidechain takes it`,
    };
  }
  void durationS;
  return { expr: volumeExpr(runs), runs, why: `${runs.length} run(s) of speech, ducked by ${DUCK_DB} dB` };
}
