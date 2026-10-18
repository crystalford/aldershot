/**
 * WHICH LINES WOULD STAND ALONE — the fragment self-sufficiency test.
 *
 * Phase 5's acceptance, word for word: "no short ends mid-sentence or
 * carries an unresolved referent". Both are the same failure seen from two
 * ends — a clip that needs the video around it to make sense is not a short,
 * it is an excerpt, and an excerpt posted on its own is a clip about
 * nothing.
 *
 * DETERMINISTIC, because it can be. The house rule is that anything which
 * can be a regex, a lint or a measurement is not a model call, and sentence
 * completeness and a dangling pronoun are both readable from the text. That
 * also makes the REASON exact: not "this one is weaker", but "it ends
 * mid-sentence" and "it opens on 'that', and nothing before it says what".
 *
 * REASONS, NOT SCORES (invariant 3). Strong · Worth a look · Long shot, each
 * carrying the line that caused it. There is no number here and no field one
 * could go in.
 *
 * A DOWNGRADE IS NOT A REFUSAL. Everything is listed; the grade says what to
 * expect and the reason says why, and a person who disagrees presses it
 * anyway. The failure to avoid is silently withholding a line somebody would
 * have wanted, so this never filters.
 */

/** Under this, a clip is over before a viewer has arrived. */
export const TOO_SHORT_MS = 4_000;

/** Over this it is not a short, whatever else is true of it. */
export const TOO_LONG_MS = 90_000;

export type Grade = "strong" | "worth" | "long";

export const GRADE_NAME: Record<Grade, string> = {
  strong: "Strong",
  worth: "Worth a look",
  long: "Long shot",
};

/**
 * THE TWO THE ACCEPTANCE NAMES ARE HARD; the rest are soft.
 *
 * A clip that ends mid-sentence or opens on a word pointing at something
 * off-screen is broken in a way no amount of interest redeems. A clip that
 * starts mid-sentence is survivable — a viewer joins a thought in progress
 * all the time — and length is a format question rather than a sense one.
 */
const HARD: ReadonlySet<string> = new Set(["ends-mid-sentence", "dangling-referent"]);

export interface Problem {
  kind: "ends-mid-sentence" | "starts-mid-sentence" | "dangling-referent" | "too-short" | "too-long";
  /** The sentence a person reads. Never a score. */
  reason: string;
}

/**
 * WORDS THAT POINT AT SOMETHING ELSE.
 *
 * A clip opening on one of these is a clip whose subject is in the part
 * nobody is watching. "I" and "we" are deliberately absent: the speaker is
 * on screen, so a self-reference resolves itself.
 *
 * `it` is here and is the one that over-flags — "it was raining" points at
 * nothing in particular. The cost of being wrong is a downgrade with a
 * stated reason that a person can read and ignore, against a clip that
 * genuinely opens on a mystery. That trade only goes one way.
 *
 * ONLY THE FIRST WORD IS ASKED ABOUT, and the first version asked about
 * every word in the opening sentence. "The house has a room THAT gets sun
 * until four" was graded a long shot over a relative pronoun — a sentence
 * that stands on its own perfectly, failed by a rule reaching for grammar
 * it has no way to read. What a viewer actually hears is the first second,
 * and a referential word there is the whole failure.
 */
const REFERENTIAL = new Set([
  "he", "she", "they", "him", "her", "them", "his", "hers", "their", "theirs",
  "it", "its", "that", "this", "these", "those",
]);

/**
 * WORDS THAT CONTINUE A THOUGHT nobody is going to hear.
 *
 * Starting a clip on one is starting in the middle, and the viewer knows it
 * within a word.
 */
const CONTINUATIONS = new Set(["and", "but", "so", "because", "then", "or", "which", "also", "anyway"]);

const TERMINATORS = /[.!?…]["'”’)\]]*\s*$/;

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The first sentence, which is where an opening problem lives. */
export function opening(text: string): string {
  const m = text.trim().match(/^[\s\S]*?[.!?…]/);
  return (m ? m[0] : text).trim();
}

/**
 * THE WORD A VIEWER HEARS FIRST, past a conjunction if there is one.
 *
 * "And he said no" opens on "and" and is about "he"; both are problems and
 * the second is the one that makes it unwatchable, so the conjunction is
 * stepped over rather than hiding what is behind it.
 */
export function subjectWord(first: string): string {
  const w = words(first);
  if (w.length > 1 && CONTINUATIONS.has(w[0])) return w[1];
  return w[0] ?? "";
}

export interface Candidate {
  text: string;
  durationMs: number;
}

/**
 * Everything wrong with this line as a short, in the order a person would
 * notice it.
 */
export function problems(c: Candidate): Problem[] {
  const out: Problem[] = [];
  const text = c.text.trim();
  if (!text) {
    return [{ kind: "ends-mid-sentence", reason: "there are no words in it" }];
  }

  /* THE ONE THE ACCEPTANCE NAMES FIRST. A clip that stops mid-sentence
     reads as a mistake, every time, to everybody. */
  if (!TERMINATORS.test(text)) {
    out.push({ kind: "ends-mid-sentence", reason: "it stops mid-sentence" });
  }

  const first = opening(text);
  const opener = words(first)[0] ?? "";
  if (CONTINUATIONS.has(opener)) {
    out.push({
      kind: "starts-mid-sentence",
      reason: `it opens on “${opener}”, which carries on something nobody heard`,
    });
  } else if (/^[a-z]/.test(text)) {
    out.push({ kind: "starts-mid-sentence", reason: "it starts part-way through a sentence" });
  }

  /*
   * THE OTHER ONE THE ACCEPTANCE NAMES. The clip opens on a word pointing
   * at something nobody watching has seen, so its subject is in the part
   * nobody is watching.
   */
  const subject = subjectWord(first);
  if (REFERENTIAL.has(subject)) {
    out.push({
      kind: "dangling-referent",
      reason: `it opens on “${subject}”, and nothing in it says what that is`,
    });
  }

  /* Two ifs would do: a clip cannot be both. The else reads as the one
     question it is — how long is this — and breaking it changes nothing,
     which is recorded here rather than left as a test that could not be
     written. */
  if (c.durationMs < TOO_SHORT_MS) {
    out.push({ kind: "too-short", reason: "it is over before a viewer has arrived" });
  } else if (c.durationMs > TOO_LONG_MS) {
    out.push({ kind: "too-long", reason: "it is longer than a short" });
  }

  return out;
}

export interface Graded {
  grade: Grade;
  /** Why, in one sentence. The line that caused it. */
  reason: string;
  problems: Problem[];
}

/**
 * Strong · Worth a look · Long shot, with the line that caused it.
 *
 * The grade is a statement about the PROBLEMS, not a ranking: two Strong
 * lines are not ordered against each other, because nothing here can tell
 * which of two self-sufficient sentences is the better short and a number
 * pretending otherwise is the thing invariant 3 forbids.
 */
export function grade(c: Candidate): Graded {
  const found = problems(c);
  const hard = found.filter((p) => HARD.has(p.kind));
  if (hard.length) {
    return { grade: "long", reason: hard[0].reason, problems: found };
  }
  if (found.length) {
    return { grade: "worth", reason: found[0].reason, problems: found };
  }
  return { grade: "strong", reason: "it stands on its own", problems: found };
}
