/**
 * DOES A MOMENT SURVIVE BEING LIFTED OUT OF ITS INTERVIEW?
 *
 * src/score.ts already asks for this. Rules 1 and 2 of the scoring prompt are
 * COMPLETE THOUGHT and SELF-CONTAINED, and the prompt says a moment breaking
 * either "is not a good moment however interesting it sounds". It even lists
 * the words: "that", "he", "this one", "like I said", "so anyway".
 *
 * So this is not a new idea. It is the first way to find out whether the model
 * does what the prompt tells it. A clip scored 90 that opens on "and so that's
 * why he said" means rule 2 is being ignored, and nothing in this codebase
 * could have told us that — the score is the model's own opinion of its own
 * compliance, which is not evidence of anything.
 *
 * It also happens to be the property that matters most for everything else:
 * a span that stands alone is the one that can be retrieved usefully, embedded
 * usefully, and placed anywhere in an assembly without a dangling reference at
 * the cut. One check, three consumers. Only the measurement uses it today.
 *
 * WHY THERE IS NO SINGLE SCORE HERE. The obvious shape is a 0-100 number, and
 * it would be an invented one: subtract 30 for this, 12 for that, and the
 * weights are taste wearing arithmetic's clothes. Flags are reportable without
 * inventing anything — "34% of clips scored 80+ open on a dangling reference"
 * is a sentence somebody can act on, and "mean portability 61.4" is not.
 *
 * WHAT IT IS NOT. A parser. It is a word-list check over ASR text, so it will
 * miss a dangling reference phrased unusually and will occasionally flag a
 * sound opening. Every rule here is one a person can read and disagree with,
 * which is the point: it is a ruler, not a judge.
 */

/** What is wrong with the span, in the terms the scoring prompt uses. */
export type FlagKind =
  /** Rule 1, the front: begins part-way through a sentence. */
  | "opens-mid-sentence"
  /** Rule 1, the back: stops before the point lands. */
  | "ends-mid-sentence"
  /** Rule 2: the first words point at something outside the span. */
  | "opens-on-dangling-reference";

export interface Flag {
  kind: FlagKind;
  /**
   * "hard" is the prompt's own disqualifying standard — a clipped sentence or
   * an opening demonstrative. "soft" is where this check genuinely cannot
   * tell: a bare "so" sometimes opens a thought, and an expletive "it's" is
   * fine where a referential "it" is not. Reported separately so a soft flag
   * never gets counted as a defect.
   */
  severity: "hard" | "soft";
  /** The text that triggered it, so a flag can be argued with. */
  detail: string;
}

/*
 * Openings that point backwards at something the listener has not been shown.
 * Longest first, because "and then" must beat "and".
 */
const BACK_REFERENCES = [
  "that's why", "thats why", "which is why", "that's the thing", "thats the thing",
  "like i said", "like i mentioned", "as i said", "as i mentioned", "as i was saying",
  "going back to that", "back to that", "because of that", "and because of that",
  "so anyway", "anyway so", "that said", "the thing is", "the other thing",
  "and then", "but then", "so then", "and so", "which meant", "which means",
  "the same thing", "same thing", "this one", "that one", "the second one",
];

/** Words that, standing first, name something outside the span. */
const DEMONSTRATIVES = ["that", "this", "these", "those", "there"];

/** Third person, with nobody named yet. "I" and "you" need no antecedent. */
const PRONOUNS = ["he", "she", "they", "him", "her", "them", "his", "hers", "their", "theirs"];

/**
 * Connectives that USUALLY continue a thought and sometimes open one. Soft.
 * Speech really does begin "So — the first four weeks are not about strength".
 */
const CONNECTIVES = [
  "so", "and", "but", "because", "which", "then", "also", "well", "plus", "or",
  "anyway", "actually", "basically", "however", "though", "although", "meanwhile",
];

/**
 * Nouns that resolve a pronoun without being capitalised, so "my dad never
 * said he was proud" is not flagged. Not a complete list of human relations
 * and does not need to be: it only has to cover the common case of an
 * antecedent sitting inside the span in lower case.
 */
const ROLE_NOUNS = [
  "dad", "mum", "mom", "father", "mother", "parents", "brother", "sister", "wife",
  "husband", "partner", "friend", "boss", "client", "teacher", "doctor", "nurse",
  "guy", "man", "woman", "kid", "kids", "son", "daughter", "neighbour", "neighbor",
  "someone", "somebody", "everyone", "everybody", "nobody", "people", "editor",
  "producer", "director", "engineer", "founder", "customer", "driver", "owner",
];

/**
 * Words that open a sentence in capitals without being a name.
 *
 * Needed because sentence-initial capitalisation carries no information: "The
 * whole studio smelled of turpentine" and "Marcus told me he was leaving" both
 * start with a capital, and only one of them names somebody who can resolve a
 * later pronoun. Everything that is not one of these is treated as a name.
 */
const FUNCTION_OPENERS = new Set([
  "the", "a", "an", "my", "our", "your", "we", "i", "you", "if", "when", "while",
  "after", "before", "every", "most", "some", "all", "what", "how", "why", "who",
  "once", "at", "in", "on", "for", "to", "no", "yes", "nobody", "everyone",
  "everybody", "someone", "somebody", "people", "here", "now", "look", "listen",
  "maybe", "honestly", "obviously", "sometimes", "usually", "first", "second",
]);

const words = (s: string): string[] => s.toLowerCase().match(/[a-z']+/g) ?? [];

/** "it's" -> "it", "that's" -> "that". The transcript contracts; the lists do not. */
const stem = (w: string): string => w.replace(/'s$/, "");

/**
 * The flags on one span of speech.
 *
 * `quote` is the span's own words, exactly as the transcript has them.
 */
export function portabilityFlags(quote: string): Flag[] {
  const text = quote.trim();
  if (!text) return [];
  const flags: Flag[] = [];

  /*
   * THE PUNCTUATION CHECKS ARE CONDITIONAL, and that is not a nicety.
   *
   * Whisper punctuates and capitalises, but a transcript that arrived from
   * somewhere else may not — and against an unpunctuated transcript a
   * sentence-boundary check flags every single clip, reports 100% defects, and
   * says nothing about anything. So each one first asks whether this text
   * carries the signal at all, and stays silent when it does not.
   */
  /*
   * "Does this transcript use capitals at all" — any capital letter anywhere,
   * which an uncased transcript simply does not have. An earlier version
   * looked for a lower-case letter, whitespace, then a capital, and missed
   * every real sentence break because the whitespace comes AFTER the full
   * stop: "strength. Nobody" has a period where that pattern wanted a space.
   */
  const cased = /[A-Z]/.test(text);
  /* Whisper emits punctuation and capitals together or neither, so casing is
     evidence this transcript punctuates even in a quote too short to contain
     an internal full stop. */
  const punctuated = /[.!?]/.test(text.slice(0, -1)) || cased;

  if (cased && /^[a-z]/.test(text)) {
    flags.push({
      kind: "opens-mid-sentence",
      severity: "hard",
      detail: text.slice(0, 32),
    });
  }

  if (punctuated && !/[.!?]["')\]]?$/.test(text)) {
    flags.push({
      kind: "ends-mid-sentence",
      severity: "hard",
      detail: text.slice(-32),
    });
  }

  /*
   * AT MOST ONE OPENING FLAG, whichever is most specific.
   *
   * "And then he said" trips the phrase list, the pronoun rule and the
   * connective list. Reporting three flags for one defect would treble its
   * weight in any rate this feeds, so the most specific explanation wins and
   * the rest are not looked for.
   */
  const opener = openingFlag(text);
  if (opener) flags.push(opener);

  return flags;
}

function openingFlag(text: string): Flag | null {
  const ws = words(text);
  if (!ws.length) return null;
  /*
   * The opening read as words, not as raw text. "Like I said, the camera gear"
   * has a comma where the phrase list expects a space, and matching against
   * the raw string missed every back-reference that happened to be followed by
   * punctuation — which is most of them.
   */
  const head = ws.join(" ");

  const dangling = (detail: string, severity: "hard" | "soft"): Flag => ({
    kind: "opens-on-dangling-reference",
    severity,
    detail,
  });

  for (const phrase of BACK_REFERENCES) {
    if (head.startsWith(phrase + " ") || head === phrase) return dangling(phrase, "hard");
  }

  const first = stem(ws[0] ?? "");
  if (DEMONSTRATIVES.includes(first)) return dangling(first, "hard");

  /*
   * A third-person pronoun in the first few words with nobody named yet.
   *
   * Bounded to the opening deliberately. A "he" in the middle of a span
   * almost always has its antecedent inside the span, and flagging those
   * turned a check about openings into a check about pronoun density.
   */
  const head6 = ws.slice(0, 6);
  const pronounAt = head6.findIndex((w) => PRONOUNS.includes(stem(w)));
  if (pronounAt >= 0) {
    /*
     * Somebody has to have been named BEFORE the pronoun, inside the span.
     * Two ways that happens, and an early version only handled neither well:
     * a capitalised word ("Marcus told me he was leaving") or a lower-case
     * relation ("my dad never said he was proud"). Missing the second flagged
     * perfectly sound clips; missing the first flagged every clip that opens
     * on a name, which in interview footage is a great many of them.
     */
    const capitalised: string[] = text.match(/\b[A-Z][a-z]+/g) ?? [];
    const isName = (w: string) => !FUNCTION_OPENERS.has(w.toLowerCase());
    const earlier = ws.slice(0, pronounAt);
    const antecedent =
      earlier.some((w) => ROLE_NOUNS.includes(stem(w))) ||
      capitalised.some((n) => isName(n) && earlier.includes(n.toLowerCase()));
    if (!antecedent) return dangling(head6.slice(0, pronounAt + 1).join(" "), "hard");
  }

  /* "It" last, and soft: expletive "it's the first time" is fine, referential
     "it was awful" is not, and no word list separates them. */
  if (first === "it" || first === "its") return dangling(first, "soft");

  if (CONNECTIVES.includes(first)) return dangling(first, "soft");

  return null;
}

/** Only the flags the scoring prompt treats as disqualifying. */
export function hardFlags(quote: string): Flag[] {
  return portabilityFlags(quote).filter((f) => f.severity === "hard");
}
