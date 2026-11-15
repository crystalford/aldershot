/**
 * THE WRITER FIREWALL — a deterministic lint, not a model.
 *
 * `labs/FORMATS.md` names it and nothing built it: "a maintained stoplist of
 * genre markers ... On a hit, regenerate that sentence only." Invariant 10 is
 * the input half of the same idea — "the genre word never reaches the writer;
 * the user's own words win where they exist" — and doc 05 says what happens to
 * it: "The genre word is stored and discarded; the writer never sees it."
 *
 * WHY A LINT AND NOT A JUDGE. FORMATS puts it in one line: genre markers are
 * "conventional and cheap to imitate", which is exactly what makes them cheap
 * to MATCH. Asking a model whether its own output sounds like a YouTube
 * thumbnail is a model call to grade a model call. A regex is free, it never
 * has an off day, and this codebase's convention is explicit about which of
 * those to reach for.
 *
 * TWO LISTS, TWO JOBS, AND THEY MUST NOT BE MERGED.
 *
 * GENRE_LABELS are names for a KIND of video, and they are an INPUT problem.
 * Decision 15: "a genre word is a costume; the model performs it." Handed
 * "write a video essay", a model writes what video essays sound like instead
 * of what this argument needs.
 *
 * TEASERS are things no honest sentence says, and they are an OUTPUT problem:
 * they are what the costume looks like once it is on, and they turn up even
 * when nobody named a genre.
 *
 * A label is only a problem on the way IN and a teaser only on the way OUT, so
 * one combined list would flag a user who wants to make a video about
 * documentaries, and miss "buckle up" in a draft.
 */

/**
 * Names for a kind of video.
 *
 * Deliberately short. A long list strips more of the user's sentence, and
 * invariant 10's second half — "the user's own words win where they exist" —
 * loses every time this list wins. Each of these is a word somebody uses to
 * say WHAT KIND of thing they want rather than what it is about.
 */
export const GENRE_LABELS: string[] = [
  "video essay",
  "essay",
  "documentary",
  "doc",
  "mini-doc",
  "docuseries",
  "vlog",
  "reaction",
  "reaction video",
  "explainer",
  "tutorial",
  "how-to",
  "commentary",
  "montage",
  "supercut",
  "compilation",
  "think piece",
  "thinkpiece",
  "hot take",
  "deep dive",
  "breakdown",
  "exposé",
  "expose",
  "retrospective",
  "video",
  "short",
  "reel",
];

/**
 * THE COSTUMES: the labels that name an IDENTITY rather than a medium.
 *
 * "video", "short" and "reel" are in the list above because "a video about X"
 * is the commonest framing there is, and stripping it leaves the subject. But
 * they are not costumes — "You are planning a video" is the correct plain
 * register and says nothing about how to write. "You are planning a video
 * essay" is a costume, and the model puts it on.
 *
 * So the prompt check uses this narrower list. One list for both jobs would
 * either forbid the word "video" in a writing prompt or allow "documentary"
 * in one.
 */
/*
 * The exclusions are all the same distinction, made three times:
 *
 *   "video", "short", "reel"  — the medium. "You are planning a video" is the
 *                               plain register, not a costume.
 *   "reaction"                — the NOUN for a thing in a cut (the creator
 *                               stopping to speak), which src/reactions.ts
 *                               legitimately needs to name. "reaction video",
 *                               the format label, stays on the list.
 *   "compilation"             — a FACT about somebody else's video, which
 *                               scout_ledger.is_compilation_only records. Not
 *                               a costume anybody is being asked to wear.
 *   "doc"                     — too short to match safely.
 */
export const COSTUMES: string[] = GENRE_LABELS.filter(
  (g) => !["video", "short", "reel", "doc", "reaction", "compilation"].includes(g),
);

/**
 * THE GENRE WORD IS ONLY STRIPPED WHERE IT FRAMES THE ASK.
 *
 * "Make me a video essay about NASA" is somebody naming a format. "A video
 * about how documentaries lie" is somebody naming a subject, and a rule that
 * removed the word there would hand the writer a sentence its author did not
 * write — which breaks invariant 10's own second half in the name of its
 * first.
 *
 * So these match the genre word only in the position where it IS the ask: at
 * the front, attached to what follows by "about", "on", "of" or a colon.
 * Everything else the person typed survives untouched.
 */
const FRAMES: Array<(g: string) => RegExp> = [
  /* "make me a video essay about X", "do a supercut on X" */
  (g) => new RegExp(`^\\s*(?:please\\s+)?(?:can you\\s+)?(?:make|do|build|create|write|cut)\\s+(?:me\\s+)?(?:an?\\s+)?${g}\\s+(?:about|on|of|covering|regarding)\\s+`, "i"),
  /* "a video essay about X", "the documentary on X" */
  (g) => new RegExp(`^\\s*(?:an?|the)\\s+${g}\\s+(?:about|on|of|covering|regarding)\\s+`, "i"),
  /* "video essay: X", "supercut — X" */
  (g) => new RegExp(`^\\s*(?:an?|the)?\\s*${g}\\s*[:\\u2013\\u2014-]\\s+`, "i"),
];

export interface PlainWords {
  /** What the writer is given: the person's own words, minus the costume. */
  said: string;
  /**
   * What was taken out — STORED, not thrown away.
   *
   * Doc 05: the genre word is "stored and discarded", and doc 04 says what it
   * is for: "Genre is a parameter set applied after the cut is aligned, not a
   * writing instruction." It is an edit-profile hint, and it belongs anywhere
   * except the writing prompt.
   */
  genre: string | null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The person's words, ready for a writer.
 *
 * Strips at most ONE framing genre word, longest label first so "video essay"
 * is not read as "video", and never touches the rest of the sentence.
 */
export function plainRegister(text: string): PlainWords {
  const byLength = [...GENRE_LABELS].sort((a, b) => b.length - a.length);
  for (const label of byLength) {
    for (const frame of FRAMES) {
      const re = frame(esc(label));
      const m = re.exec(text);
      if (!m) continue;
      /*
       * There is always something left, because every frame above ends in
       * `\s+` and so cannot match without a subject after it. "make a
       * documentary about", with nothing following, matches nothing and comes
       * back untouched — which is right: with no subject there is no way to
       * tell the framing from the thing, and inventing a split would hand the
       * writer an empty topic.
       *
       * This paragraph replaces a guard that returned the original text when
       * the remainder was empty. It could never run, and a dead branch with a
       * confident comment on it is a claim nobody can check.
       */
      return { said: text.slice(m[0].length).trim(), genre: label };
    }
  }
  return { said: text.trim(), genre: null };
}

/**
 * Things no honest sentence says.
 *
 * FORMATS.md's list, plus the two shapes it describes rather than enumerates:
 * a script that ends on a question, and a second-person hook. Each carries why
 * it is here, because a lint that only says "no" gets switched off.
 */
export const TEASERS: Array<{ find: RegExp; why: string }> = [
  { find: /\bin a world\b/i, why: "a trailer voice, and this is not a trailer" },
  { find: /\bbut what happened next\b/i, why: "withholding, which is the opposite of a claim" },
  { find: /\blittle did (?:he|she|they|we|i|you)\b/i, why: "narrator omniscience nobody earned" },
  { find: /\bbuckle up\b/i, why: "a promise about how exciting this will be" },
  { find: /\blet'?s dive in\b/i, why: "a sentence that says nothing and costs a second" },
  { find: /\byou won'?t believe\b/i, why: "tells the viewer what to feel before showing them anything" },
  { find: /\bforever changed\b/i, why: "a size claim with no evidence behind it" },
  { find: /\bstay tuned\b/i, why: "withholding again" },
  { find: /\bthe truth about\b/i, why: "claims the answer in the framing" },
  { find: /\bwhat they don'?t want you to know\b/i, why: "a conspiracy frame worn as a style" },
];

/** A sentence ending on a question — FORMATS' "end-of-script questions". */
const TRAILING_QUESTION = /\?\s*$/;

export interface Marker {
  /** The sentence it was found in, so a caller can regenerate that one. */
  sentence: string;
  found: string;
  why: string;
}

/**
 * Every genre marker in a piece of writing, with the sentence that carries it.
 *
 * Per-sentence because FORMATS says what to do on a hit — "regenerate that
 * sentence only" — and a caller cannot do that from a boolean.
 */
export function teaserMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  for (const sentence of sentences) {
    for (const t of TEASERS) {
      const m = t.find.exec(sentence);
      if (m) out.push({ sentence: sentence.trim(), found: m[0], why: t.why });
    }
  }
  /* Only the LAST sentence, because a question mid-argument is a real
     rhetorical move and only the sign-off question is the genre tic. */
  const last = sentences[sentences.length - 1]?.trim();
  if (last && TRAILING_QUESTION.test(last)) {
    out.push({ sentence: last, found: "?", why: "a script that signs off on a question is asking for a comment, not making a point" });
  }
  return out;
}
