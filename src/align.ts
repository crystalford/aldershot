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
 * Everything is `recogniser` until forced alignment exists — there is no
 * column for it yet and inventing one that is always the same value would be
 * a schema change that records nothing. It takes a source so the signature
 * does not change on the day there IS a column, which is the whole point of
 * putting the contract in before the implementation.
 */
export function timingFor(_source: { id: string }): Timing {
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
