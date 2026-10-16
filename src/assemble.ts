/**
 * MAKE SOMETHING OUT OF EVERYTHING YOU HAVE SHOT.
 *
 * Every edit in this product has belonged to exactly one video. You could pull
 * a clip from another one into a cut — the seam has done that since it was
 * built — but you could never START from the library and say "three minutes on
 * this, from whatever I have".
 *
 * That turns out to be the one thing nothing else in this market does. Reduct
 * sells cross-video assembly and it is manual: search, then drag text into a
 * reel. Descript's assistant is conversational and scoped to the open project.
 * Frame.io indexes a whole account and cannot assemble. Nobody has joined the
 * halves.
 *
 * And it is cheap here, because the render was built for it without meaning to
 * be: a Block carries its own mediaKey, an EdlCut carries its own sourceKey,
 * runRender signs each cut's key separately and the container downloads one
 * file per distinct url. The single-source assumption lived in the guards, not
 * in the machinery.
 *
 * WHAT THIS DOES NOT DO. It does not read a transcript. A clip pulled from
 * another video does not carry that video's words (src/blocks.ts), so an
 * assembled cut can be reordered, struck whole, narrated over and exported —
 * but not cut inside by word. That needs Cut to gain a source discriminator
 * and is deliberately not smuggled in here.
 */

import type { Env } from "./env.ts";
import { listMoments, searchMeaning, type Moment } from "./library.ts";
import { createProject, putBeats } from "./projects.ts";
import { recordPass } from "./passes.ts";
import { titleFromBrief } from "./projects.ts";
import { ulid } from "./id.ts";

/**
 * A COUNT CEILING, NOT THE THING THAT DECIDES.
 *
 * This used to be the only constraint on an assembly: take the first 24 by
 * retrieval rank and stop. Nothing in the product knew how LONG the result
 * was, which is the one number a person asking for "three minutes on this"
 * actually cares about — twenty-four moments at a minute each is a twenty-four
 * minute video, and it arrived with no warning that it was one.
 *
 * The budget below decides now. This stays as a guard: a generous budget full
 * of five-second moments is a hundred and forty blocks, and an editor with a
 * hundred and forty blocks in it is unusable however well-chosen they are.
 */
export const ASSEMBLE_MAX = 60;

/**
 * How much of the library to look at before choosing. Larger than the output,
 * because a budget that selects from exactly as many moments as it can fit is
 * not selecting.
 */
export const CANDIDATE_POOL = 60;

/**
 * What "say what you want" means when it does not say how long.
 *
 * Deliberately generous rather than tight, and this is the one place the
 * staged-reduction research changed a number. Professional practice reduces in
 * passes — a first assembly runs well over the final length and the editor
 * strikes down to it — so an assembly nobody gave a duration to should
 * over-deliver material and let the user cut, not guess short and silently
 * leave good moments in the library.
 *
 * A brief that names a duration overrides it; see targetFromBrief.
 */
export const DEFAULT_TARGET_MS = 12 * 60_000;

/**
 * The moments a brief asks for, best first.
 *
 * Meaning search when the index exists, exact words when it does not — the
 * fallback the library already makes everywhere else, so an account without a
 * Vectorize index gets a worse answer rather than an error.
 *
 * Deliberately NOT a model call. The model's job is deciding what to do with
 * material; finding the material is retrieval, and retrieval over our own
 * clips is exact — every one of these is a real range of a real file with a
 * real quote, so nothing here can invent a moment that was never said.
 */
export async function findMaterial(
  env: Env,
  userId: string,
  brief: string,
  limit = CANDIDATE_POOL,
): Promise<{ moments: Moment[]; how: "meaning" | "words" | "recent" }> {
  const q = brief.trim();
  if (!q) return { moments: await listMoments(env.DB, userId, limit), how: "recent" };

  const meant = await searchMeaning(env, userId, q, limit);
  if (meant && meant.length) return { moments: dedupe(meant), how: "meaning" };

  /*
   * A BRIEF IS NOT A SEARCH BOX QUERY.
   *
   * searchExact joins its terms with AND — right for "find every place I said
   * sponsor", wrong for a sentence. Asked for "the bits about food" against a
   * library holding exactly that, it returned nothing, because no single
   * moment contains all four words including "the" and "about".
   *
   * So the words fallback ranks instead of filters: how many of the brief's
   * content words a moment actually says. Deterministic, over our own
   * transcripts, and it degrades to "the most recent" rather than to nothing.
   */
  const recent = await listMoments(env.DB, userId, 200);
  const ranked = rankByWords(recent, q);
  if (ranked.length) return { moments: dedupe(ranked).slice(0, limit), how: "words" };

  /*
   * AND WHEN NO WORD MATCHES, THE MOST RECENT — which is what the paragraph
   * above has always claimed and what this function did not do.
   *
   * It returned an empty list, so every brief whose words appear nowhere in
   * the library was refused with "nothing matches that yet". "Eight minutes on
   * whatever you have" is an explicit request for ANYTHING and got turned
   * away; so did any brief phrased around what to make rather than what it is
   * about. Found by driving the real route rather than by reading this.
   *
   * The pass line says "your most recent" when this happens, so a person can
   * see the search missed and that they are looking at a starting point rather
   * than an answer.
   */
  if (recent.length) return { moments: dedupe(recent).slice(0, limit), how: "recent" };

  return { moments: [], how: "words" };
}

/**
 * One moment per piece of footage, not three overlapping ones.
 *
 * The clip library holds moments found by different passes over the same
 * video, and they overlap freely — two clips covering the same forty seconds
 * are both real rows. Assembling them produced a cut that said the same thing
 * twice in a row, which reads as a bug even though every row is honest.
 *
 * Best-ranked wins the ground it covers. Kept here rather than in the library:
 * overlap is fine in a list you are BROWSING and wrong in a sequence you are
 * about to watch.
 */
export function dedupe<T extends { source_id: string; start_ms: number; end_ms: number }>(
  moments: T[],
): T[] {
  const taken: T[] = [];
  for (const m of moments) {
    const clash = taken.some(
      (t) => t.source_id === m.source_id && m.start_ms < t.end_ms && m.end_ms > t.start_ms,
    );
    if (!clash) taken.push(m);
  }
  return taken;
}

/* Words that appear in every sentence and mean nothing about the footage. */
const NOISE = new Set(
  ("a an and are as at be but by for from how i in is it its me my of on or " +
   "our so that the their them then there these they this to too was we were " +
   "what when where which who why will with you your about into over just " +
   "some any all thing things bit bits part parts video clip clips make made").split(" "),
);

/**
 * The moments that actually say what the brief is about, best first.
 *
 * Exported because the ranking is the whole retrieval story when there is no
 * meaning index, and a rule this load-bearing should be testable on its own.
 */
export function rankByWords<T extends { quote: string; source_title?: string }>(
  moments: T[],
  brief: string,
): T[] {
  const terms = [
    ...new Set(
      brief
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((t) => t.length > 2 && !NOISE.has(t)),
    ),
  ];
  if (!terms.length) return [];

  return moments
    .map((m) => {
      const hay = (m.quote + " " + (m.source_title ?? "")).toLowerCase();
      return { m, hits: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((r) => r.m);
}

/* Written-out numbers people actually say to a video editor. */
const SPOKEN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};

/**
 * HOW LONG THEY ASKED FOR, when they said.
 *
 * "three minutes on the gym stuff", "a 90 second cut about filters", "make it
 * 2 mins". The brief is the only place this can come from: there is no
 * duration control anywhere in the product, and inventing one would be a
 * worse answer than reading the sentence somebody already typed.
 *
 * Returns `said: false` when it found nothing, so the caller can tell the
 * difference between "they asked for twelve minutes" and "nobody said" — those
 * mean different things about whether going under budget is a problem.
 */
export function targetFromBrief(brief: string): { ms: number; said: boolean } {
  const q = " " + brief.toLowerCase().replace(/[,]/g, " ") + " ";

  /*
   * Minutes before seconds, and "and a half" folded in, because "a minute and
   * a half" is a thing people say and 60_000 would be the wrong answer to it.
   */
  const unit = /(\d+(?:\.\d+)?|[a-z]+)\s*(?:-|\s)?\s*(minutes?|mins?|m|seconds?|secs?|s)\b/g;
  for (const m of q.matchAll(unit)) {
    const raw = m[1];
    const n = /^\d/.test(raw) ? Number(raw) : (SPOKEN[raw] ?? (raw === "a" || raw === "an" ? 1 : NaN));
    if (!Number.isFinite(n) || n <= 0) continue;

    const minutes = m[2].startsWith("m");
    /* "and a half" only ever follows the number it halves. */
    const half = q.slice((m.index ?? 0) + m[0].length).startsWith(" and a half") ? 0.5 : 0;
    const ms = Math.round((n + half) * (minutes ? 60_000 : 1_000));

    /*
     * A SANITY WINDOW, because a brief is prose and prose contains numbers.
     * "cut the 3 second gap" and "the 2 minute mark" both parse, and neither
     * is a runtime. Ten seconds to two hours is the range a cut can be; a
     * number outside it is somebody talking about something else.
     */
    if (ms >= 10_000 && ms <= 2 * 3_600_000) return { ms, said: true };
  }
  return { ms: DEFAULT_TARGET_MS, said: false };
}

const contentWords = (s: string): string[] => [
  ...new Set(
    s.toLowerCase().split(/[^a-z0-9']+/).filter((t) => t.length > 2 && !NOISE.has(t)),
  ),
];

/**
 * FILL THE TIME WITH AS MUCH DIFFERENT MATERIAL AS IT HOLDS.
 *
 * The old selection was "retrieval order, drop overlaps, stop at 24". That is
 * relevance with no notion of repetition and no notion of length, so a
 * rambling eighty-second telling beat a tight twenty-five-second one that said
 * the same thing, and six moments all making the same point filled the cut
 * because all six matched the brief.
 *
 * This is the cheapest honest version of what the research calls budgeted
 * submodular coverage: pick whatever adds the most NEW material per second of
 * runtime, then do it again, until nothing left fits. Greedy on gain-per-cost
 * is the standard algorithm for it, and the cost being seconds is the whole
 * point — a duration budget is a knapsack, and this is the knapsack greedy.
 *
 * COVERAGE IS COUNTED IN WORDS, AND THAT IS A PLACEHOLDER. The right ground
 * set is atomic claims, clustered across the library, so that two tellings of
 * one point compete and two points sharing vocabulary do not. Claims need a
 * model pass per moment and an evaluation to show they beat this, and we have
 * neither yet. Words are what we can count today for nothing, and they are
 * already strictly better than not counting: the gain function is the only
 * thing that has to change when claims exist.
 *
 * RELEVANCE BREAKS TIES, it does not score. The input arrives best-first from
 * retrieval, and mixing a rank into a word count means inventing an exchange
 * rate between two scales that have none. Order decides between equals, which
 * is all it can honestly do.
 */
export function selectForBudget<
  T extends { quote: string; start_ms: number; end_ms: number; source_id: string },
>(moments: T[], brief: string, budgetMs: number, maxCount = ASSEMBLE_MAX): T[] {
  const pool = dedupe(moments);
  const asked = new Set(contentWords(brief));
  const covered = new Set<string>();
  const chosen: T[] = [];
  const taken = new Set<number>();
  let used = 0;

  while (chosen.length < maxCount) {
    let best = -1;
    let bestRate = 0;

    for (let i = 0; i < pool.length; i++) {
      if (taken.has(i)) continue;
      const m = pool[i];
      const dur = Math.max(1, m.end_ms - m.start_ms);
      if (used + dur > budgetMs) continue;

      /* What this moment says that nothing chosen has said yet, with the
         brief's own words counting for more because they are the question. */
      let gain = 0;
      for (const w of contentWords(m.quote)) {
        if (covered.has(w)) continue;
        gain += asked.has(w) ? 3 : 1;
      }
      if (gain <= 0) continue;

      /* Per SECOND. A tight telling beats a rambling one that covers the
         same ground, which is the behaviour the old count cap could not have. */
      const rate = gain / (dur / 1000);
      if (rate > bestRate) {
        bestRate = rate;
        best = i;
      }
    }

    /*
     * NOTHING LEFT THAT BOTH FITS AND ADDS ANYTHING.
     *
     * Stopping here rather than padding to the ceiling is the diversity
     * reward doing its job: an assembly that has run out of new material
     * should end, not repeat itself to reach a number.
     */
    if (best < 0) break;

    const m = pool[best];
    taken.add(best);
    chosen.push(m);
    used += Math.max(1, m.end_ms - m.start_ms);
    for (const w of contentWords(m.quote)) covered.add(w);
  }

  /*
   * Back into the order retrieval gave them.
   *
   * Greedy picks densest-first, which is a selection order and a terrible
   * watching order. Ordering an assembly properly is its own problem — an
   * outline over sections, then precedence inside them — and until that exists
   * the honest starting order is the one the library ranked, not the one this
   * loop happened to visit.
   */
  const rank = new Map(pool.map((m, i) => [m, i]));
  return chosen.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/** The runtime of a set of moments, which is what a person asked about. */
export function runtimeMs(moments: Array<{ start_ms: number; end_ms: number }>): number {
  return moments.reduce((n, m) => n + Math.max(0, m.end_ms - m.start_ms), 0);
}

/** m:ss, for a line somebody reads rather than parses. */
export function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * One edit, made of clips from wherever they came from.
 *
 * The project gets NO source_id — that is the whole point, and everything
 * downstream now copes: blocksForProject asks for no segments, buildEdl reads
 * each block's own key, and the editor renders a cut with no player of its own
 * because each block plays its own file.
 *
 * The moments become clip beats in transcript order of nothing in particular —
 * the order they were found in, which for a meaning search is best-first. That
 * is a starting order, and reordering is the one instruction an assembled cut
 * can already take.
 */
export async function assembleFromLibrary(
  env: Env,
  opts: { userId: string; brief: string },
): Promise<
  { projectId: string; used: number; how: string; runtimeMs: number; targetMs: number } | { error: string }
> {
  const { moments: pool, how } = await findMaterial(env, opts.userId, opts.brief);
  if (!pool.length) {
    return {
      error: "Nothing in your library matches that yet — read a few more videos in, or say it differently.",
    };
  }

  /*
   * CHOSEN TO A RUNTIME, not to a count. See selectForBudget.
   *
   * The duration comes out of the brief when the brief says one, because
   * there is nowhere else for it to come from: the product has no duration
   * control, and reading the sentence somebody typed beats inventing one.
   */
  const target = targetFromBrief(opts.brief);
  const moments = selectForBudget(pool, opts.brief, target.ms);
  if (!moments.length) {
    return {
      error: "Everything that matched is longer than the cut you asked for — try a longer one.",
    };
  }

  const project = await createProject(env.DB, {
    user_id: opts.userId,
    title: titleFromBrief(opts.brief, "From your library"),
    kind: "cut",
    /* No video of its own. The one thing that makes this different. */
    source_id: null,
    brief: opts.brief,
  });

  const runtime = runtimeMs(moments);
  const beats = moments.map((m) => ({
    id: ulid(),
    kind: "clip" as const,
    act: null,
    struck: "0",
    text: m.quote,
    clip_id: m.id,
    dur_ms: Math.max(0, m.end_ms - m.start_ms),
    media_r2_key: null,
    recorded_at: null,
  }));

  await putBeats(env.DB, project.id, beats);

  /*
   * IT SAYS WHAT IT DID.
   *
   * Six blocks appearing from six places with no explanation is the exact
   * review gap this product is supposed to be better at than everyone else:
   * the question is not whether the model can do more, it is whether a person
   * can check what it chose faster than doing it by hand.
   *
   * So the assembly writes itself into the conversation as the first turn, the
   * same shape a pass does — what you asked, what it found, and a Show me that
   * jumps to the first thing it pulled. No undo snapshot: there is no earlier
   * state of this edit to go back to, and a button that offered one would lie.
   */
  const from = new Set(moments.map((m) => m.source_id)).size;

  /*
   * IT SAYS HOW LONG IT IS, AND WHY IT IS NOT LONGER.
   *
   * This line used to read "6 moments from 2 videos" and leave out the only
   * number somebody asking for three minutes wanted.
   *
   * The two reasons it can come up short are NOT the same fact and a single
   * sentence covering both would be a lie about one of them. Either the
   * library had more that matched and none of it was short enough to fit —
   * which is what trimming inside a pulled clip would fix, and nothing else
   * will — or that is simply everything that matched, and no amount of
   * cleverness here will find more. Caught driving the real route: a
   * two-minute ask returned 34 seconds and the first version of this said
   * "nothing shorter left that fits" when the truth was "that is all there is".
   */
  const gap = target.said && target.ms - runtime > 15_000;
  const exhausted = moments.length >= pool.length;
  const why = !gap
    ? ""
    : exhausted
      ? ` of ${clock(target.ms)} — that is everything ${how === "recent" ? "you have" : "that matched"}`
      : ` of ${clock(target.ms)} — nothing shorter left that fits`;
  await recordPass(env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: opts.brief,
    result:
      `${moments.length} moment${moments.length === 1 ? "" : "s"} from ` +
      `${from} video${from === 1 ? "" : "s"} · ${clock(runtime)}` + why +
      (how === "meaning" ? "" : how === "words" ? " · matched on words" : " · your most recent"),
    firstChange: `b:${beats[0].id}`,
  }).catch(() => {
    /* The edit exists and is usable; a missing opening line is not worth
       failing the whole assembly for. */
  });

  return {
    projectId: project.id,
    used: moments.length,
    how,
    runtimeMs: runtime,
    targetMs: target.ms,
  };
}
