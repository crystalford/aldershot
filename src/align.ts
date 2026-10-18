/**
 * WHERE A TIMESTAMP CAME FROM, AND HOW MUCH TO TRUST IT.
 *
 * Every word in this product carries a start and an end, and until now
 * nothing recorded where those numbers came from. They come from Whisper,
 * which is a RECOGNISER: it reports roughly where it thinks a word sits,
 * accurate to about a tenth of a second. That is fine for finding a moment
 * and fine for playing one back, and it is not fine for cutting on a frame —
 * at 25fps a frame is 40ms, so a 110ms timing is somewhere in a three-frame
 * window, which is the difference between a cut on the breath and a cut
 * through the start of the next word.
 *
 * Phase 1 adds forced alignment for that, at roughly 20ms. This is the
 * contract it will arrive behind: a typed capability saying which kind of
 * timing a source has and what it is good for, so the day the aligner lands
 * nothing has to be hunted for, and until then anything that NEEDS frame
 * accuracy can refuse rather than quietly do the wrong thing with numbers
 * that were never that precise.
 *
 * WHY A CONTRACT BEFORE THE IMPLEMENTATION. The convention is that every
 * model call sits behind a typed capability contract, and the reason is on
 * display here: there is already code that would be wrong with recogniser
 * timings and has no way to say so. Writing the contract first means the
 * wrongness is visible as a refusal now, rather than as a frame of audio
 * nobody notices later.
 */

/** How a source's word timings were produced. */
export type TimingSource = "caption" | "recogniser" | "forced";

/**
 * What each is worth, in milliseconds of expected error.
 *
 * Whisper's own figure for word timestamps is around a tenth of a second;
 * forced aligners are an order better. Both are stated rather than measured
 * HERE — measuring them is Phase 1's acceptance ("word timings within one
 * frame on a 20-line spot check") and needs a real file on a real deploy.
 * They are written down so the comparison below is a comparison of numbers
 * rather than of adjectives.
 */
export const TOLERANCE_MS: Record<TimingSource, number> = {
  /*
   * A CAPTION CUE IS NOT A WORD TIMING, and this is the honest number for
   * pretending otherwise.
   *
   * A published WebVTT transcript gives a start and an end per CUE — five to
   * seven words over one to two seconds in the real files Scout reads. The
   * cue boundaries themselves are good, often better than a recogniser's,
   * because they came off an alignment. What is invented is the position of
   * each word INSIDE the cue, which this product interpolates by length.
   *
   * Half a word of a seven-word, 1.5-second cue is about 100ms, and cues run
   * longer than that, so 400 covers it. Worse than a recogniser, nowhere near
   * a frame, and a stated number rather than an adjective — which is the
   * whole point of this file.
   */
  caption: 400,
  recogniser: 110,
  forced: 20,
};

/** A frame at the slowest rate this product deals with. */
export const FRAME_MS = 40;

export interface Timing {
  source: TimingSource;
  /** Expected error, in ms. */
  toleranceMs: number;
}

export const timingOf = (source: TimingSource): Timing => ({
  source,
  toleranceMs: TOLERANCE_MS[source],
});

/**
 * Whether a timing is good enough to put a cut on a frame.
 *
 * The question every caller should be asking instead of assuming. A
 * recogniser timing fails it, which is correct and is the point: today every
 * source in this product would fail, and that is a true statement about the
 * product rather than a bug in this function.
 */
export const frameAccurate = (t: Timing): boolean => t.toleranceMs <= FRAME_MS;

/**
 * What a source's timings currently are.
 *
 * It took a source and ignored it for several commits — "there is no column
 * for it yet and inventing one that is always the same value would be a
 * schema change that records nothing" — on the understanding that the
 * signature would not have to change on the day there was one. This is that
 * day, and it did not.
 *
 * NULL IS `recogniser`, and is not backfilled. Every row written before the
 * column existed really does carry recogniser timings, and a migration that
 * wrote `forced` over them would be a claim that an alignment ran.
 *
 * A VALUE NOBODY RECOGNISES IS ALSO `recogniser`, which is the cautious
 * direction: an unknown string read as `forced` would let a cut land on a
 * frame using timings nothing has checked.
 */
export function timingFor(source: { timing_source?: string | null }): Timing {
  const s = source.timing_source;
  if (s === "forced" || s === "caption") return timingOf(s);
  return timingOf("recogniser");
}

/*
 * A COMPOSITE WORD ID IS NOT HERE, and was, briefly.
 *
 * `sourceId#index` looked right until there was something to use it on: a
 * moment's span lives on a row that already carries its source_id, so the
 * composite would have been the same two facts joined by a hash and taken
 * apart again by every reader. The index alone is the address; the row says
 * which source it indexes.
 *
 * It goes in when something addresses a word ACROSS sources — a cue sheet, a
 * dispute file — and not before, because an abstraction with one caller that
 * immediately decomposes it is a worse version of two columns.
 */

/** One word of a source, with its address and its timing. */
export interface IndexedWord {
  /** Position in the source, counted across segments in order. */
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Every word of a source in order, numbered.
 *
 * The numbering is what a word id refers to, so it has to be derived the same
 * way every time: segments in `idx` order, words in the order they are stored
 * within each. Anything that changes that renumbers the whole source and
 * invalidates every span pointing into it.
 */
export function indexWords(
  segments: Array<{ idx: number; words: string | null }>,
  parse: (json: string | null) => Array<{ w: string; s: number; e: number }>,
): IndexedWord[] {
  const out: IndexedWord[] = [];
  for (const seg of [...segments].sort((a, b) => a.idx - b.idx)) {
    for (const w of parse(seg.words)) {
      out.push({
        index: out.length,
        text: w.w,
        /* SECONDS in storage, milliseconds everywhere else — the landmine
           documented in src/cuts.ts. Converted here, once, so nothing
           downstream of this function has to know. */
        startMs: Math.round(w.s * 1000),
        endMs: Math.round(w.e * 1000),
      });
    }
  }
  return out;
}

/**
 * The word span a millisecond range covers.
 *
 * How a moment that was found in milliseconds gets an address that survives
 * re-alignment. Inclusive of any word that OVERLAPS the range rather than
 * only ones wholly inside it: a range whose edge lands mid-word was always
 * going to play that word, and a span that excluded it would describe a
 * different moment from the one the user watched.
 *
 * Null when the source has no words — a transcript that failed, or one from
 * before word timings were stored. The caller keeps its milliseconds, which
 * is what it has always had.
 */
export function spanFor(
  words: IndexedWord[],
  startMs: number,
  endMs: number,
): { startWord: number; endWord: number } | null {
  if (!words.length || endMs <= startMs) return null;
  let first = -1;
  let last = -1;
  for (const w of words) {
    if (w.endMs <= startMs || w.startMs >= endMs) continue;
    if (first < 0) first = w.index;
    last = w.index;
  }
  return first < 0 ? null : { startWord: first, endWord: last };
}

/*
 * READING A SPAN BACK IS NOT HERE EITHER, for the same reason.
 *
 * msForSpan existed for one commit and had no caller: nothing reads a word
 * span yet, because the only reason to prefer it over the milliseconds is a
 * re-alignment that has not happened. With recogniser timings the two agree
 * exactly, so a reader today would be a no-op with risk.
 *
 * WRITING the span now is still right, and is the whole point of this
 * commit: the address has to exist BEFORE the timings move, or every moment
 * saved today is unanchorable tomorrow. Writing is cheap exactly once — when
 * the transcript is already in hand at scoring time — and reading waits for
 * something that needs it.
 */

/* ── Windows: how a ten-hour file is aligned at all ─────────────────────── */

/**
 * THE WINDOW, AND WHY THERE HAS TO BE ONE.
 *
 * A forced aligner runs an acoustic model over the audio and then searches
 * for the best path through it that produces the given words. The search is
 * cheap; the model is not. An hour of 16 kHz audio is 57.6 million samples,
 * and the convolutional stack in front of the model holds activations for
 * all of them at once — tens of gigabytes for a file this product calls
 * ordinary. So the audio is aligned in pieces.
 *
 * Thirty seconds, because it is comfortably inside any machine we would rent
 * and comfortably longer than the pauses alignment uses to find its edges.
 */
export const WINDOW_MS = 30_000;

/**
 * Audio either side of the window's own words.
 *
 * The recogniser is wrong by about 110 ms, so a word's true start can sit
 * before the start it was given. Without a pad the first word of a window
 * begins mid-utterance and the aligner has nowhere to put its onset.
 *
 * THE PAD IS ALSO THE PROBLEM. Forced alignment consumes ALL of the audio it
 * is given — the path has to account for every frame — so silence or speech
 * outside the words gets absorbed by the word at that end. That is why
 * windows overlap and why the stitch below prefers interior readings.
 */
export const PAD_MS = 300;

/** How many words two neighbouring windows share. */
export const OVERLAP_WORDS = 3;

export interface AlignWindow {
  /** Audio to cut, in source milliseconds. Includes the pad. */
  startMs: number;
  endMs: number;
  /** The words it covers, by source word index. Inclusive. */
  first: number;
  last: number;
  /** Their text, in order, which is what the aligner is given. */
  words: string[];
}

/**
 * Cut a source's words into overlapping windows of about thirty seconds.
 *
 * Boundaries are at WORDS, never at a clock: a window that ended mid-word
 * would hand the aligner half an utterance and ask it to find a whole one.
 */
export function planAlignWindows(
  words: IndexedWord[],
  opts: { windowMs?: number; padMs?: number; overlap?: number } = {},
): AlignWindow[] {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const padMs = opts.padMs ?? PAD_MS;
  const overlap = opts.overlap ?? OVERLAP_WORDS;
  if (!words.length) return [];

  const out: AlignWindow[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    /* At least one word per window even when that word is somehow longer
       than the whole window — a recogniser timing can be nonsense, and a
       loop that refused to advance on one would never finish. */
    while (j + 1 < words.length && words[j + 1].endMs - words[i].startMs <= windowMs) j += 1;

    out.push({
      startMs: Math.max(0, words[i].startMs - padMs),
      endMs: words[j].endMs + padMs,
      first: words[i].index,
      last: words[j].index,
      words: words.slice(i, j + 1).map((w) => w.text),
    });

    if (j + 1 >= words.length) break;
    /*
     * BACK UP BY THE OVERLAP, but never past the start of this window: on a
     * window of one or two words that would step backwards and plan the same
     * window again, for ever. Found by planning a source whose recogniser
     * gave one word a forty-second duration.
     */
    i = Math.max(i + 1, j + 1 - overlap);
  }
  return out;
}

/** What the aligner says about one word: seconds within its window, and how sure. */
export type WindowTiming = [startS: number, endS: number, score: number] | null;

export interface Aligned {
  index: number;
  startMs: number;
  endMs: number;
  /** 0 to 1, from the model. Internal: invariant 3 — it never reaches a user. */
  score: number;
}

/**
 * ONE TIMING PER WORD, FROM THE WINDOW THAT HEARD IT BEST.
 *
 * A word in the overlap has two readings, and they are not equally good: the
 * one nearer a window's edge was competing with the pad for its audio, and
 * at the very edge it absorbed it. So the reading furthest from an edge
 * wins, and the model's own score settles a tie.
 *
 * A word the aligner could not place — a number, an emoji, a script the
 * model has no letters for — is simply absent from the result. The caller
 * keeps the recogniser's timing for it, which is worse and is honest.
 */
export function stitchAlignment(
  windows: AlignWindow[],
  results: Array<{ ok: boolean; timings?: WindowTiming[] }>,
): Aligned[] {
  const best = new Map<number, { a: Aligned; edge: number }>();

  windows.forEach((w, wi) => {
    const r = results[wi];
    if (!r?.ok || !r.timings) return;
    const n = w.last - w.first + 1;
    for (let k = 0; k < n; k += 1) {
      const t = r.timings[k];
      if (!t) continue;
      const index = w.first + k;
      const edge = Math.min(k, n - 1 - k);
      const cand: Aligned = {
        index,
        startMs: Math.round(w.startMs + t[0] * 1000),
        endMs: Math.round(w.startMs + t[1] * 1000),
        score: t[2],
      };
      const held = best.get(index);
      if (!held || edge > held.edge || (edge === held.edge && cand.score > held.a.score)) {
        best.set(index, { a: cand, edge });
      }
    }
  });

  return [...best.values()].map((v) => v.a).sort((a, b) => a.index - b.index);
}

/**
 * The aligned timings, made monotonic, and a count of what had to be moved.
 *
 * Two readings from two windows can disagree by a few milliseconds, and at a
 * seam that can put a word's start before the previous word's start. Nothing
 * downstream survives that: `spanFor` walks words in order and `playableRanges`
 * builds a render from them, so one word out of order is a cut that plays
 * backwards.
 *
 * The repair is a clamp, and the COUNT is the point of returning it: a source
 * that needed one is fine, and a source that needed four hundred has a window
 * size or a transcript problem that a silent clamp would hide for ever.
 */
export function monotonic(aligned: Aligned[]): { words: Aligned[]; repaired: number } {
  const words = aligned.map((a) => ({ ...a }));
  let repaired = 0;
  let floor = 0;
  for (const w of words) {
    if (w.startMs < floor) {
      w.startMs = floor;
      repaired += 1;
    }
    if (w.endMs < w.startMs) {
      w.endMs = w.startMs;
      repaired += 1;
    }
    floor = w.startMs;
  }
  return { words, repaired };
}
