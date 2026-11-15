/**
 * HOW LOUD THE FINISHED THING IS.
 *
 * `09-EXPORT-AND-INTEGRITY.md`, Sound and captions: "loudness about −14 LUFS,
 * peaks under −1 dBTP; music ducked on the words", and the Fixes column says
 * "checked on every export, not offered as a fix".
 *
 * CHECKED, NOT APPLIED. That is the division this file keeps. Every export is
 * measured and told about; only an export that asked to be cleaned up is
 * normalised. The existing comment on the enhance flag gives the reason —
 * "changing how somebody's voice sounds without being asked is worse than
 * making them ask" — and the same holds for gain: a quiet cut is a true
 * record of a quiet room, every platform re-normalises on upload anyway, and
 * a person who wanted it louder can say so.
 *
 * THE TWO NUMBERS ARE NOT THE SAME KIND OF NUMBER, which is the thing worth
 * reading twice.
 *
 *   −14 LUFS is a TARGET. loudnorm aims at it, lands within a fraction of it,
 *   and encoding does not move it.
 *
 *   −1 dBTP is a CEILING ON THE DELIVERED FILE, and lossy encoding raises
 *   true peak after the filter has finished: an AAC encode can add half a
 *   decibel or more of inter-sample peak to a signal that measured compliant
 *   on the way in. So the filter aims at −1.5, and the file is checked
 *   against −1. Setting the filter to −1 to "match the spec" is the mistake
 *   that produces a file measuring −0.6 dBTP and a product that says it is
 *   compliant.
 *
 * `-16` was the target in container/render.mjs with no comment saying why,
 * which is two LU quieter than the handoff asks for and quiet enough that
 * every platform would have turned it up on the way in.
 */

/** What a finished export should measure. Doc 09's "about −14 LUFS". */
export const TARGET_LUFS = -14;

/** "Within ±1 LU of target", which is Phase 6's acceptance in its own words. */
export const TOLERANCE_LU = 1;

/** The ceiling the DELIVERED file must stay under. */
export const CEILING_DBTP = -1;

/**
 * What the filter aims at, which is lower. See the header: the encoder adds
 * true peak after this runs, so aiming at the ceiling lands above it.
 */
export const NORMALISE_TO_DBTP = -1.5;

/** Loudness range. Broadcast-ish, and gentle enough to leave speech alone. */
export const TARGET_LRA = 11;

/** The one place the filter string is written. */
export const LOUDNORM = `loudnorm=I=${TARGET_LUFS}:TP=${NORMALISE_TO_DBTP}:LRA=${TARGET_LRA}`;

export interface Measured {
  /** Integrated loudness, LUFS. Null when it could not be read. */
  lufs: number | null;
  /** True peak, dBTP. */
  truePeak: number | null;
  /** Loudness range, LU. */
  lra: number | null;
}

const NOTHING: Measured = { lufs: null, truePeak: null, lra: null };

/**
 * Reads what `loudnorm=print_format=json` printed.
 *
 * The `input_*` fields, because when this is run over a FINISHED file the
 * input is the finished file. Reading `output_*` would report what a second
 * normalisation pass would have produced — a number about a file that does
 * not exist, which is the quietest possible way to be wrong about loudness.
 *
 * ffmpeg writes the block to stderr among everything else it says, and prints
 * "-inf" for silence, which is not a number and must not become one: a silent
 * export is a real failure and -Infinity propagating into a comparison would
 * report it as merely quiet.
 */
export function parseLoudnorm(output: string): Measured {
  const block = output.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!block) return NOTHING;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(block[0]) as Record<string, unknown>;
  } catch {
    return NOTHING;
  }
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return { lufs: num(json.input_i), truePeak: num(json.input_tp), lra: num(json.input_lra) };
}

export interface Verdict {
  ok: boolean;
  /** What is wrong, in sentences. Empty when nothing is. */
  problems: string[];
  /** What it measured, said once, however it came out. */
  summary: string;
}

/** One decimal, and a sign a person reads as a level rather than as maths. */
const lu = (n: number): string => `${n.toFixed(1)} LUFS`;
const dbtp = (n: number): string => `${n.toFixed(1)} dBTP`;

/**
 * Whether a finished export is within doc 09's numbers.
 *
 * A measurement that could not be taken is NOT a pass. "We could not measure
 * it" and "it is fine" are different answers and only one of them is true;
 * invariant 7's whole subject is work that fails without saying so.
 */
export function loudnessVerdict(m: Measured): Verdict {
  const problems: string[] = [];

  if (m.lufs === null) {
    problems.push("The loudness could not be measured, so nothing here vouches for it.");
  } else {
    const off = m.lufs - TARGET_LUFS;
    if (Math.abs(off) > TOLERANCE_LU) {
      problems.push(
        off < 0
          ? `It is ${Math.abs(off).toFixed(1)} LU quieter than ${TARGET_LUFS} LUFS. Platforms will turn it up, and anything beside it will sound louder.`
          : `It is ${off.toFixed(1)} LU louder than ${TARGET_LUFS} LUFS. Platforms will turn it down, and the quiet parts go with it.`,
      );
    }
  }

  if (m.truePeak === null) {
    problems.push("The peaks could not be measured.");
  } else if (m.truePeak > CEILING_DBTP) {
    problems.push(
      `Peaks reach ${dbtp(m.truePeak)}, above the ${CEILING_DBTP} dBTP ceiling. Some players will clip it.`,
    );
  }

  const summary =
    m.lufs === null
      ? "Not measured."
      : `${lu(m.lufs)}${m.truePeak === null ? "" : `, peaks ${dbtp(m.truePeak)}`}.`;

  return { ok: problems.length === 0, problems, summary };
}
