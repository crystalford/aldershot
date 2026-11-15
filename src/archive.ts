/**
 * WHAT'S IN YOUR ARCHIVE — the paragraph, written from counts.
 *
 * The prototype's card reads: "Three vlogs, one question — whether to leave
 * the city for the house. You circle it for two and a half hours across five
 * threads and answer it once, on Sunday at 44:02." The build has shown a
 * count where that paragraph goes since the room was built, and CLAUDE.md
 * names it by name as one of the three things a night of building from
 * documents got wrong.
 *
 * ── WHY THIS IS NOT THE PROTOTYPE'S SENTENCE ──────────────────────────────
 * Two of its clauses are not available to anybody honestly. "One question —
 * whether to leave the city for the house" is a reading nothing has made,
 * and "you answer it once, on Sunday at 44:02" is a claim about a specific
 * moment being the answer. A model could write both and they would often be
 * wrong, and a front door that opens with a confident wrong sentence about
 * somebody's own work is worse than one that opens with a count.
 *
 * So this says the part that IS known, in the shape the card wants: the
 * threads running through the footage, named with the person's own words
 * (invariant 10, and src/threads.ts takes the names from the quotes), and
 * which one they keep coming back to. Every number in it is counted.
 *
 * ── AND WHY IT IS NOT A MODEL CALL ────────────────────────────────────────
 * "Deterministic first: if it can be a regex, a lint or a measurement, it is
 * not a model call." This is a measurement. It is also the front door, read
 * on every page load by everyone — a model call here would be a bill that
 * scales with page views and a paragraph that changed when nothing had.
 */

export interface ArchiveFacts {
  sources: number;
  moments: number;
  /** Threads, biggest first, as `listThreads` returns them. */
  threads: Array<{ name: string; moments: number }>;
}

/** "a", "a and b", "a, b and c" — British, no Oxford comma. The copy voice. */
export function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The most threads to name before the sentence stops being a sentence.
 *
 * Five is the prototype's own number — it lists five strands — and it is
 * also about where a list in prose stops reading as prose.
 */
export const NAME_AT_MOST = 5;

/**
 * The threads worth naming.
 *
 * A row whose name is blank, or whose moments have all been deleted since
 * the sweep last ran, is a thread with nothing behind it. `clip_count` is a
 * stored column and goes stale between sweeps, so this is not hypothetical.
 *
 * ONE FILTER, USED BY BOTH, because the count in the title row and the list
 * in the paragraph have to be the same threads. Filtering in the sentence
 * and not in the count is how the title row ends up saying "2 threads" over
 * a paragraph that names none — "a count that disagrees with its list is a
 * bug this product has already had twice."
 */
export const realThreads = (f: ArchiveFacts): ArchiveFacts["threads"] =>
  f.threads.filter((t) => t.name && t.moments > 0);

/**
 * The count, which is what the card said before there was anything else and
 * is still the right answer for an archive with no topic running through it.
 */
export function countLine(f: ArchiveFacts): string {
  const bits = [plural(f.sources, "video") + " read", plural(f.moments, "moment")];
  const threads = realThreads(f);
  if (threads.length) bits.push(plural(threads.length, "thread"));
  return bits.join(" · ");
}

/**
 * The paragraph, or the count when there is no paragraph to write.
 *
 * DEGRADES ONE CLAUSE AT A TIME, which is the same rule `summaryLine` and
 * the clean-up chips follow: a number that cannot be computed honestly is
 * not shown, and the sentence around it goes with it.
 *
 *  - No footage at all: nothing. The card does not render.
 *  - Footage but no threads: the count, exactly as before. An archive can be
 *    genuinely about nothing in particular, and so can one the sweep has not
 *    reached yet.
 *  - Threads: name them, and say which one is returned to most — but only
 *    when one of them actually IS. A top thread tied with the second is not
 *    a thing anybody comes back to more, and saying so would be the first
 *    sentence of the product being a guess.
 */
export function archiveSentence(f: ArchiveFacts): string {
  if (!f.sources) return "";
  const threads = realThreads(f);
  if (!threads.length) return countLine(f);

  const named = threads.slice(0, NAME_AT_MOST).map((t) => t.name);
  const rest = threads.length - named.length;
  const list = rest > 0 ? `${joinWords(named)} and ${rest} more` : joinWords(named);

  const runs =
    threads.length === 1
      ? `One thread runs through ${plural(f.sources, "video")}: ${list}`
      : `${plural(threads.length, "thread")} run through ${plural(f.sources, "video")} — ${list}`;

  /* Strictly beats the second, or nobody comes back to it more. */
  const top = threads[0];
  const second = threads[1];
  if (!second || top.moments > second.moments) {
    return `${runs}. The one you come back to most is ${top.name}, in ${plural(top.moments, "moment")}.`;
  }
  return `${runs}.`;
}
