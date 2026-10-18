/**
 * A RECORDED TAKE, CHECKED AGAINST THE LINE IT WAS MEANT TO BE.
 *
 * Phase 5's acceptance: "a recorded take aligns to the script within one
 * frame". Two halves, and only one of them was ever about timing.
 *
 * THE TIMING HALF is forced alignment, which this product now has: the
 * take's words are placed to about 20 ms (src/align.ts), which is half a
 * frame. What a beat carried before was `x-duration-ms` — a number the
 * BROWSER sent, unverified, about a file the server had not looked at. A
 * cut built on it is a cut whose length is whatever the client said.
 *
 * THE OTHER HALF IS WHETHER IT IS THE SAME LINE. Forced alignment cannot
 * refuse: it searches for the best path through the audio that produces the
 * given words, so it will place a script over a recording of something else
 * entirely and report times for every word. What it does report honestly is
 * how WELL each word matched, and a take of a different sentence matches
 * badly all the way through.
 *
 * So the verdict is the mean score against a threshold, and a take that
 * drifts is SAID rather than silently used — the beat's text is what the
 * captions and the cue sheet will claim was said.
 *
 * PURE. The container call is src/align-source.ts; everything here is
 * arithmetic over what came back, so every rule can be pinned.
 */

import { FRAME_MS } from "./align.ts";
import type { Aligned } from "./align.ts";

/**
 * How well a take has to match its line.
 *
 * MMS_FA returns a per-word probability, and on a clean reading of the
 * written words it is near 1 — the sample in scripts/check-align.cjs scores
 * 0.97 to 1.00 on every word. A take of a DIFFERENT sentence has to force
 * the path through audio that does not contain those sounds, and the score
 * collapses.
 *
 * 0.5 is deliberately far below a good reading and far above a wrong one.
 * A threshold tight enough to catch a fluffed word would reject takes a
 * person is happy with, and the person is the one who has to be happy.
 */
export const MATCHES_AT = 0.5;

/** Under this, it is not a reading of this line at all. */
export const DRIFTED_AT = 0.2;

export type TakeVerdict = "matches" | "drifted" | "unclear";

export interface Take {
  verdict: TakeVerdict;
  /** What a person reads. Never a score — invariant 3. */
  reason: string;
  /** Measured from the words, not from what the browser said. */
  durationMs: number;
  /** Word timings, for the captions and for placing the cut. */
  words: Aligned[];
  /** The words the aligner could not place at all. */
  unplaced: number;
}

/**
 * The script line, as the words a take should contain.
 *
 * Punctuation and case go, because neither is spoken. Numbers stay as
 * written: "2019" is a word somebody says, and dropping it would leave the
 * aligner a gap where a word was.
 */
export function scriptWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Is every word placed to within a frame of where the one before it ended?
 *
 * Not an accuracy measure — nothing here knows the truth — but the thing
 * that would show a take placed by the wrong clock: word timings that do
 * not run in order, or that leave the recording's own length behind. A
 * drift of more than a frame between a word's end and the next word's start
 * is a pause; a NEGATIVE one is an alignment nobody should build a cut on.
 */
export function placedInOrder(words: Aligned[]): boolean {
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].startMs + FRAME_MS < words[i - 1].startMs) return false;
    if (words[i].endMs < words[i].startMs) return false;
  }
  return true;
}

/**
 * WHAT CAME BACK, AS A VERDICT.
 *
 * `expected` is how many words the script had, so a take that aligned four
 * words of a twelve-word line is caught even when those four scored well —
 * which is the shape a take that stops halfway takes.
 */
export function readTake(words: Aligned[], expected: number): Take {
  if (!expected) {
    return { verdict: "unclear", reason: "there is no line to read", durationMs: 0, words: [], unplaced: 0 };
  }
  if (!words.length) {
    return {
      verdict: "unclear",
      reason: "nothing in the recording could be lined up with the line",
      durationMs: 0,
      words: [],
      unplaced: expected,
    };
  }

  const mean = words.reduce((n, w) => n + w.score, 0) / words.length;
  const unplaced = Math.max(0, expected - words.length);
  /*
   * MEASURED FROM THE WORDS. The first word's start to the last word's end
   * — not the file's length, which includes whatever silence the browser
   * caught before and after somebody pressed a button.
   */
  const durationMs = Math.max(0, words[words.length - 1].endMs - words[0].startMs);

  /*
   * A TAKE MISSING MOST OF ITS LINE IS NOT A TAKE OF THAT LINE, however
   * well the part it has scores. Checked before the score, because the
   * score of four words says nothing about the eight that are absent.
   */
  if (unplaced > expected / 2) {
    return {
      verdict: "drifted",
      reason: `only ${words.length} of ${expected} words are in it — it stops part-way through the line`,
      durationMs,
      words,
      unplaced,
    };
  }

  /*
   * WORDS THAT DO NOT RUN IN ORDER are an alignment nobody should build a
   * cut on, whatever they scored. It is not a judgement about the take —
   * it is a judgement about the alignment, and the honest thing to do with
   * one that came back confused is say so rather than place a cut on it.
   */
  if (!placedInOrder(words)) {
    return {
      verdict: "unclear",
      reason: "the words did not line up in order — worth recording it again",
      durationMs,
      words,
      unplaced,
    };
  }

  if (mean >= MATCHES_AT) {
    return {
      verdict: "matches",
      reason: unplaced
        ? `it reads the line, give or take ${unplaced} word${unplaced === 1 ? "" : "s"}`
        : "it reads the line",
      durationMs,
      words,
      unplaced,
    };
  }

  if (mean < DRIFTED_AT) {
    return {
      verdict: "drifted",
      reason: "what is said in it is not this line",
      durationMs,
      words,
      unplaced,
    };
  }

  return {
    verdict: "unclear",
    reason: "some of it does not match the line — worth listening back",
    durationMs,
    words,
    unplaced,
  };
}

