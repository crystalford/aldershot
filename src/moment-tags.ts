/**
 * THE TAGS A RULE CAN MATCH, derived rather than typed in.
 *
 * The rule engine matches moments by tag — "keep the parts where you're
 * working something out", "take out the hellos", "lose the hedging". In the
 * reference footage set those tags are hand-written on fourteen sample clips.
 * On a real library nobody is going to tag three thousand moments, so the tags
 * have to come from the moments themselves.
 *
 * All of it deterministic, which is the house convention rather than thrift:
 * "if it can be a regex, a lint or a measurement, it is not a model call." It
 * is also the only way a rule can be honest about itself — a tag a model
 * assigned in a batch job last Tuesday cannot be re-derived when the user asks
 * why a moment was dropped, and a rule that cannot explain itself is the black
 * box with toggles this product is explicitly not.
 *
 * The four tags are the sample set's own, because the seed rules name them and
 * the seed rules have to mean something on real footage:
 *
 *   housekeeping  the sample's `chat` — hellos, mic checks, sponsor reads
 *   hedge         the "I don't know"s
 *   strong        the hard lines, which the cap rule may never drop
 *   core          working something out, which is everything else
 *
 * `core` is the complement on purpose. The seed keep rule asks for it, so if
 * core were its own positive test every moment it failed to recognise would
 * silently vanish from every cut — and a selection rule that fails closed is
 * far worse than one that fails open.
 */

export type MomentTag = "core" | "housekeeping" | "hedge" | "strong";

/**
 * Housekeeping, in the scoring prompt's own words: "Sponsor and ad reads,
 * 'like and subscribe', mic checks, 'can you hear me', agenda recaps and
 * sign-offs are never the moment, whatever else is in them."
 *
 * Those were already written as a rule for a model to follow. This is the same
 * rule written so it can be checked.
 */
const HOUSEKEEPING = [
  /\b(like and subscribe|hit the bell|smash that)\b/i,
  /\b(this (video|episode) is (sponsored|brought to you)|today's sponsor|our sponsor)\b/i,
  /\b(can you hear me|is this recording|are we recording|is it recording|am i on)\b/i,
  /\b(mic check|sound check|testing one two|say something so i can)\b/i,
  /\b(where was i|let me start (again|over)|take two|from the top)\b/i,
  /\b(thanks for watching|see you (next time|in the next one)|that's (it|all) for (today|now))\b/i,
  /\b(before we (start|begin|get into)|quick (housekeeping|admin))\b/i,
  /\b(welcome back to|hey everyone|hi everyone|hello and welcome)\b/i,
];

/**
 * Hedging. The sample calls it "the hedging — the 'I don't know's", and it is
 * the one tag where frequency matters more than presence: everybody says "I
 * think" once. A moment is hedging when it is MOSTLY hedging, so this counts
 * rather than matches.
 */
const HEDGES = [
  /\bi don'?t know\b/gi,
  /\bi guess\b/gi,
  /\bi mean\b/gi,
  /\bmaybe\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bprobably\b/gi,
  /\bor whatever\b/gi,
  /\bi suppose\b/gi,
  /\bperhaps\b/gi,
];

/** Hedges per hundred words, above which the moment IS the hedging. */
export const HEDGE_PER_100 = 6;

export interface Taggable {
  quote: string;
  /** 0, 1 or 2 from the scorer. Absent is treated as 1, not as 0. */
  heat?: number | null;
}

export function momentTags(m: Taggable): MomentTag[] {
  const text = m.quote ?? "";
  const tags: MomentTag[] = [];

  if (HOUSEKEEPING.some((re) => re.test(text))) tags.push("housekeeping");

  const words = (text.match(/[\w']+/g) ?? []).length;
  if (words) {
    const hedges = HEDGES.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0);
    if ((100 * hedges) / words >= HEDGE_PER_100) tags.push("hedge");
  }

  /*
   * STRONG, which is the tag with teeth: the cap rule may never drop one.
   *
   * heat 2 is the scorer saying this stretch is densely interesting, and it is
   * the only signal we have about it. A missing heat counts as 1, not 0 —
   * absent evidence is not evidence of dullness, and treating it as 0 would
   * mean every clip made before the column was populated is droppable first.
   */
  if ((m.heat ?? 1) >= 2) tags.push("strong");

  /* Everything that is not housekeeping and not hedging is somebody working
     something out. The complement, so the keep rule fails OPEN. */
  if (!tags.includes("housekeeping") && !tags.includes("hedge")) tags.push("core");

  return tags;
}


/* Words that appear in every sentence and mean nothing about the footage. */
export const NOISE = new Set(
  ("a an and are as at be but by for from how i in is it its me my of on or " +
   "our so that the their them then there these they this to too was we were " +
   "what when where which who why will with you your about into over just " +
   "some any all thing things bit bits part parts video clip clips make made").split(" "),
);

/**
 * The words in a piece of text that say something about the footage.
 *
 * Lives here rather than in assemble.ts because both the rule engine and the
 * assembly path need it, and having it in assemble.ts made src/rules.ts import
 * from the module that imports IT — a cycle that ESM tolerates and nobody
 * should rely on.
 */
export const contentWords = (s: string): string[] => [
  ...new Set(
    s.toLowerCase().split(/[^a-z0-9']+/).filter((t) => t.length > 2 && !NOISE.has(t)),
  ),
];
