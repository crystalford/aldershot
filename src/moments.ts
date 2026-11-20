/**
 * MOMENTS FROM A TRANSCRIPT, WITHOUT ASKING A MODEL ANYTHING.
 *
 * Until now a moment existed only where a brief had run a score pass. No
 * brief, no moments — so the library, the thing the whole product is supposed
 * to accumulate, was a side-effect of asking for a cut. Upload an hour of
 * footage and say nothing about it and you had a transcript and no library:
 * search found it, retrieval could not, and nothing could be cut with it
 * until somebody typed a sentence about it.
 *
 * That is the wrong way round. Reading is the expensive step and it is paid
 * for once (invariant 5); the moments are what the reading is FOR.
 *
 * AND IT IS NOT A MODEL CALL. "Deterministic first: if it can be a regex, a
 * lint or a measurement, it is not a model call." Where one point ends and
 * the next begins is in the transcript already — a sentence ends, the speaker
 * stops. A model is not needed to see that, and adding one would make every
 * read more expensive to produce something the words already say.
 *
 * WHICH LEAVES THE MODEL A SMALLER JOB, and this is the part worth keeping.
 * A score pass no longer decides WHERE a moment is, only how good it is and
 * why — see the enrichment path in saveClips. The spans are the transcript's
 * own either way, which is the same reasoning as groundClips snapping to
 * segment edges, one level up: the range and the words are the same thing.
 */

import type { Segment } from "./sources.ts";
import type { ScoredClip } from "./grounding.ts";

/**
 * How long a moment is, measured off the reference engine rather than guessed.
 *
 * `design/one-take/footage.js` is the behavioural spec and its fourteen
 * moments run 29 to 47 seconds, each one a complete thought of one to three
 * sentences. So: nothing shorter than 20s is a point — it is a line — and
 * nothing longer than 60s is one point, it is two.
 *
 * These are the shape of the thing, not a tuning parameter. If they move it
 * should be because somebody measured a real library, and then this comment
 * should say so.
 */
export const MIN_MS = 20_000;
export const MAX_MS = 60_000;

/**
 * Does this segment finish a sentence?
 *
 * The break we prefer, because a moment that ends mid-clause reads as a
 * mistake however good the material is. A closing quote or bracket after the
 * stop still counts.
 */
const ENDS_SENTENCE = /[.!?…]["'”’)\]]?\s*$/;

/**
 * The transcript, cut into moment-sized spans.
 *
 * Score, heat and reason are all null: nothing here has an opinion about the
 * material, and a made-up score would be exactly the invented number invariant
 * 3 exists to keep away from people. `ScoredClip` already documents null as
 * the hand-picked case — "a model supplies a reason and a score, a person does
 * not" — and a span the transcript drew is nearer to hand-picked than to
 * model-picked.
 */
export function momentSpans(segments: Segment[]): ScoredClip[] {
  const out: ScoredClip[] = [];
  let run: Segment[] = [];

  const spanOf = (rows: Segment[]) => rows[rows.length - 1].end_ms - rows[0].start_ms;

  const close = (final: boolean) => {
    if (!run.length) return;
    const start = run[0].start_ms;
    const end = run[run.length - 1].end_ms;
    const quote = run.map((s) => s.text.trim()).filter(Boolean).join(" ").trim();
    run = [];
    if (!quote || end <= start) return;

    /*
     * A SHORT TAIL JOINS THE MOMENT BEFORE IT rather than becoming an orphan.
     *
     * The last run ends where the video does, not where a sentence does, so
     * it is routinely a few seconds long. A four-second moment in the library
     * is noise somebody has to scroll past; the same words on the end of the
     * moment before them are just the rest of the thought. Pushing that
     * moment over MAX_MS is the better of the two prices.
     */
    if (final && end - start < MIN_MS && out.length) {
      const last = out[out.length - 1];
      last.end_ms = end;
      last.quote = `${last.quote} ${quote}`.trim();
      return;
    }

    out.push({ start_ms: start, end_ms: end, quote, why: null, score: null, heat: null });
  };

  for (const s of segments) {
    if (!s.text.trim()) continue;
    run.push(s);
    const span = spanOf(run);
    /* Long enough to be two points: break here whatever the words are doing. */
    if (span >= MAX_MS) {
      close(false);
      continue;
    }
    /* Long enough to be one point, and the sentence is over. */
    if (span >= MIN_MS && ENDS_SENTENCE.test(s.text)) close(false);
  }
  close(true);

  return out;
}
