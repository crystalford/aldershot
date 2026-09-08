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

/** How many moments one assembly may pull in. */
export const ASSEMBLE_MAX = 24;

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
  limit = ASSEMBLE_MAX,
): Promise<{ moments: Moment[]; how: "meaning" | "words" | "recent" }> {
  const q = brief.trim();
  if (!q) return { moments: await listMoments(env.DB, userId, limit), how: "recent" };

  const meant = await searchMeaning(env, userId, q, limit);
  if (meant && meant.length) return { moments: meant, how: "meaning" };

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
  const ranked = rankByWords(await listMoments(env.DB, userId, 200), q);
  if (ranked.length) return { moments: ranked.slice(0, limit), how: "words" };

  return { moments: [], how: "words" };
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
): Promise<{ projectId: string; used: number; how: string } | { error: string }> {
  const { moments, how } = await findMaterial(env, opts.userId, opts.brief);
  if (!moments.length) {
    return {
      error: "Nothing in your library matches that yet — read a few more videos in, or say it differently.",
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
  await recordPass(env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: opts.brief,
    result:
      `${moments.length} moment${moments.length === 1 ? "" : "s"} from ` +
      `${from} video${from === 1 ? "" : "s"}` +
      (how === "meaning" ? "" : how === "words" ? " · matched on words" : " · your most recent"),
    firstChange: `b:${beats[0].id}`,
  }).catch(() => {
    /* The edit exists and is usable; a missing opening line is not worth
       failing the whole assembly for. */
  });

  return { projectId: project.id, used: moments.length, how };
}
