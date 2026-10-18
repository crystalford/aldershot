/**
 * BM25: the words retriever, ranking properly.
 *
 * Phase 4 asks for "BM25 ∥ dense → RRF → rerank", and the ∥ was already
 * right — `fuseByRank` in src/assemble.ts runs both retrievers as peers and
 * fuses their ranks, which is the thing CLAUDE.md warns about getting wrong.
 * What sat behind the words half was not BM25: it counted how many of the
 * brief's distinct terms appeared somewhere in a moment, and ranked by that
 * count.
 *
 * THREE THINGS WRONG WITH COUNTING HITS, in increasing order of how much
 * they cost:
 *
 *  1. No IDF. A moment matching "house" scored the same as one matching
 *     "turpentine", when the second is far more likely to be the one asked
 *     for. Every term the brief contains was worth the same, so the common
 *     words — which survive the stoplist, because a stoplist cannot know
 *     that THIS library is about houses — drowned the rare ones.
 *
 *  2. No length normalisation. A long quote has more chance of containing
 *     any given term, so long moments ranked above short ones for no reason
 *     connected to what the person asked.
 *
 *  3. SUBSTRING MATCHING. `quote.includes("rent")` is true of "different",
 *     "parent" and "current". That is not a ranking nicety, it is wrong
 *     results — and src/scout-expand.ts already carries a comment about the
 *     same trap ("rage must not be matched by outrageous") because it was
 *     found there first.
 *
 * BM25 fixes the first two by construction and this file fixes the third by
 * tokenising both sides instead of searching one inside the other.
 *
 * PURE AND DETERMINISTIC, which is the house rule: if it can be a
 * measurement it is not a model call.
 */

import { NOISE } from "./moment-tags.ts";

/**
 * Term frequency saturation.
 *
 * How much the second mention of a word is worth next to the first. At 1.2
 * — the usual value, and the one every BM25 implementation starts from — a
 * term said five times is worth about twice one said once, rather than five
 * times as much. A moment that says "house" six times is not six times more
 * about houses.
 */
export const K1 = 1.2;

/**
 * How much length is normalised away. 0 ignores length entirely, 1
 * normalises it completely; 0.75 is the standard compromise and the reason
 * is visible in this product's own data — a transcript line is a sentence,
 * so lengths vary by a factor of ten and a raw count would simply rank long
 * lines first.
 */
export const B = 0.75;

/**
 * The words in a string, as the retriever sees them.
 *
 * Apostrophes stay inside a word — "don't" is one token, and splitting it
 * makes "t" — and everything else splits. Short words and the stoplist go,
 * which is the same rule the old ranker used and the one place this is not
 * a change.
 */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 2 && !NOISE.has(t));
}

export interface Scored<T> {
  item: T;
  score: number;
  /** Which of the query's terms this one actually says. For a reason line. */
  matched: string[];
}

/**
 * Rank documents against a query, by BM25.
 *
 * THE CORPUS IS WHAT YOU PASS IN, and that matters: inverse document
 * frequency is a statement about how rare a word is HERE. Pass the whole
 * library and "house" is common; pass eight moments about houses and it is
 * common in a different way. The caller decides, and the caller is
 * src/assemble.ts, which passes everything the query could match.
 *
 * Documents that match nothing are dropped rather than returned with a
 * score of zero: this is a retriever, and a retriever that returns the
 * whole library in an arbitrary order has not retrieved anything.
 */
export function bm25<T>(docs: T[], query: string, text: (doc: T) => string): Array<Scored<T>> {
  const terms = [...new Set(tokens(query))];
  if (!terms.length || !docs.length) return [];

  const bags = docs.map((d) => tokens(text(d)));
  const avg = bags.reduce((n, b) => n + b.length, 0) / bags.length || 1;

  /* How many documents contain each term, which is the whole of IDF. */
  const df = new Map<string, number>();
  for (const term of terms) {
    df.set(term, bags.filter((b) => b.includes(term)).length);
  }

  const out: Array<Scored<T>> = [];
  docs.forEach((doc, i) => {
    const bag = bags[i];
    if (!bag.length) return;
    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const f = bag.filter((w) => w === term).length;
      if (!f) continue;
      matched.push(term);
      const n = df.get(term) ?? 0;
      /*
       * The usual smoothed IDF, and the +1 on the outside is why: without
       * it a term present in more than half the corpus scores NEGATIVE, so
       * a moment saying a common word would rank below one saying nothing
       * at all. On a library about one subject that is most of the useful
       * words.
       */
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * bag.length) / avg)));
    }
    if (matched.length) out.push({ item: doc, score, matched });
  });

  /* Ties broken by the input order, which is the caller's — newest first
     out of the database. A sort that reordered ties would make the same
     query answer differently on two runs over the same rows. */
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
    .map((x) => x.s);
}
