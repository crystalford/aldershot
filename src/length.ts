/**
 * WHETHER THE FILE IS THE LENGTH THE CUT PROMISED.
 *
 * Invariant 2 has a second sentence that gets quoted less than the first:
 * "Validate and measure every edit before showing it; never trust the model's
 * claim of success." The first half is about the model. This file is the other
 * half, one layer out — the encoder is not a model, but the same rule applies,
 * because an export is a claim about a video and the only thing that settles
 * it is the finished file.
 *
 * WHAT WAS HAPPENING INSTEAD. src/render-job.ts held both numbers in the same
 * scope and wrote one of them:
 *
 *     .bind(key, size, measuredS || Math.round(built.edl.durationMs / 1000), …)
 *
 * The measured value REPLACED the promised one, with a comment explaining why
 * that is the right value for the row — and it is. What was missing is that
 * nothing ever differenced them. An export that came out forty seconds short
 * because a source ended before its transcript claimed landed in the row as a
 * forty-seconds-shorter video, correctly described and silently different from
 * the cut the person approved. And a render with no `x-duration-s` header at
 * all fell back to the EDL's figure, so an UNMEASURED export was
 * indistinguishable in the row from a measured one that happened to agree.
 *
 * Invariant 7's subject is work that fails without saying so. This is that,
 * in the one place where the product hands somebody a file.
 *
 * `loudnessVerdict` is the model for it, including the stance: a measurement
 * that could not be taken is not a pass.
 */

/**
 * How far apart the two numbers may be before it is worth saying.
 *
 * Not a doc number — there is no acceptance figure for this anywhere in the
 * handoff — so it is derived from the two roundings it has to survive and
 * written down rather than tuned: the measured value is rounded to whole
 * seconds on the way out of the container, and the encoder lands the last
 * frame on a frame boundary. One second for the first, one for the second
 * and anything over that is a real difference in the video. Tighten it the
 * day there is a measurement to tighten it against.
 */
export const TOLERANCE_S = 2;

export interface Lengths {
  /** What the EDL said the cut adds up to. */
  promisedMs: number;
  /** What the container measured on the finished file. Null when it did not. */
  measuredS: number | null;
}

export interface LengthVerdict {
  /** True only when it was measured AND the two numbers agree. */
  ok: boolean;
  /** Whether a measurement was taken at all. */
  measured: boolean;
  /** Measured minus promised, in seconds. Null when unmeasured. */
  offS: number | null;
  /** What it found, said once, however it came out. */
  says: string;
}

const secs = (n: number): string => `${n}s`;

/**
 * The finished file against the cut it was built from.
 *
 * A zero or absent measurement is "not measured" rather than "zero seconds
 * long" — the same reasoning as the loudness headers, where reading a missing
 * value as a number would report an unmeasured export as 14 LU too loud.
 */
export function lengthVerdict({ promisedMs, measuredS }: Lengths): LengthVerdict {
  const promisedS = Math.round(promisedMs / 1000);

  if (measuredS === null || !Number.isFinite(measuredS) || measuredS <= 0) {
    return {
      ok: false,
      measured: false,
      offS: null,
      says:
        `The finished file's length was not measured, so nothing here vouches for it. ` +
        `The cut adds up to ${secs(promisedS)}.`,
    };
  }

  const offS = measuredS - promisedS;
  if (Math.abs(offS) <= TOLERANCE_S) {
    return { ok: true, measured: true, offS, says: `${secs(measuredS)}, which is the length the cut adds up to.` };
  }

  return {
    ok: false,
    measured: true,
    offS,
    says:
      offS < 0
        ? `It came out ${secs(Math.abs(offS))} shorter than the cut: ${secs(measuredS)} against ${secs(promisedS)}. ` +
          `Something in it ran out before its words did.`
        : `It came out ${secs(offS)} longer than the cut: ${secs(measuredS)} against ${secs(promisedS)}.`,
  };
}
