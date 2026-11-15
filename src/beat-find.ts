/**
 * WHAT A BEAT'S NEED FINDS, ranked by whether it backs the beat.
 *
 * Phase 4's last two retrieval items in one place: "→ rerank" and "coverage
 * per beat". They are one model call rather than two, because reading six
 * candidates against a beat's need to say which back it IS the reranking,
 * and its answer is the coverage. A separate reranker would ask the same
 * question twice and only one of the two answers could ever be checked
 * against anything — a reranker's scores have no ground truth, and a
 * verdict has the Phase 0 set.
 *
 * HERE AND NOT IN THE SEARCH BOX. This is the one stop: six candidates per
 * kept beat, and a wrong beat costs a reshoot. The room's search box is a
 * keystroke, and a model call per keystroke is a different product.
 *
 * It lives in its own file rather than inside the route because the
 * DEGRADATION is the part worth testing: a judge that throws must cost the
 * ordering and the coverage, never the beat.
 */

import type { Env } from "./env.ts";
import { findMaterial } from "./assemble.ts";
import { judge, rerank, type Judgement } from "./judge.ts";
import type { Candidate } from "./plan.ts";

/** How many moments a beat is allowed to consider. */
export const PER_BEAT = 6;

export async function candidatesFor(env: Env, userId: string, need: string): Promise<Candidate[]> {
  const out = await findMaterial(env, userId, need, PER_BEAT);
  /*
   * "Your most recent" is findMaterial answering a brief that matched
   * nothing. A beat's need is a search, not a brief, so that fallback is
   * the same lie here as it is in the room's search box: nothing found.
   *
   * And an empty list is never sent to the judge — a model call to sort
   * nothing is a model call for nothing.
   */
  if (out.how === "recent" || !out.moments.length) return [];

  let verdicts: Judgement[] = [];
  try {
    const asked = await judge(env, need, out.moments.map((m) => ({ id: m.id, quote: m.quote })));
    verdicts = asked.judgements;
  } catch {
    /* The ordering and the coverage are lost; the beat is not. `backs: null`
       is what findForBeats reads as "nobody checked", and it falls back to
       counting results — a beat marked thin because a model call failed
       would send somebody to reshoot footage they already have. */
  }

  /*
   * `answered`, NOT "is there a row". parseJudgements fills every gap with
   * `unrelated` so a short answer cannot shrink the set — which means a
   * judge that said nothing comes back as a full list of confident
   * `unrelated`s, and reading those as verdicts would mark a beat as
   * checked-and-empty when nothing checked it.
   *
   * Found by a test: a call that answered nothing reported every moment as
   * not backing the beat, which is a gap a person would act on.
   */
  const said = new Map(verdicts.filter((v) => v.answered).map((v) => [v.id, v.said]));
  return rerank(out.moments, verdicts).map((m) => ({
    id: m.id,
    backs: said.has(m.id) ? said.get(m.id) === "backs" : null,
  }));
}
