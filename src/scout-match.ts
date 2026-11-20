/**
 * MATCH-BACK: the upload that turns a ghost into footage you can cut.
 *
 * Scout finds and links; it never fetches (invariant 9). So a verified find
 * on a platform that forbids downloading arrives as a GHOST — a moment the
 * cut knows the words and the timing of, and has no file for — plus a
 * MISSION, which is the deep link and the in-point and a sentence about what
 * to grab.
 *
 * The person goes and gets it. Then what? Until now: nothing.
 * `matchByTranscript` has been complete and heavily tested since missions
 * were built, and NOTHING IN src/ HAS EVER CALLED IT. Fourteen call sites,
 * all of them in test/. The last step of the one flow that makes Scout
 * useful was written, proved, and left unreachable.
 *
 * This is that step. A read already has the words in hand, so when a source
 * finishes reading we ask the open missions whether this is the footage they
 * were waiting for.
 *
 * WHY AT READ TIME AND NOT BEHIND A BUTTON. A button means knowing which
 * mission an upload is for, which is a thing the person should not have to
 * tell us: the transcript says. It also makes the capture loop pay off where
 * the person can see it — you went and got the footage, and the product
 * noticed.
 *
 * A MISMATCH IS NOT A FAILURE. Uploading unrelated footage must not mark
 * missions failed, and every read sees every open mission, so most pairs do
 * not match and that is the normal case rather than an error. Only a
 * verified match writes anything. `fail_reason` stays for the explicit
 * attempt a person makes by hand, which is a different act with a different
 * meaning: "I think this is it" deserves an answer, and "I uploaded
 * something else today" does not.
 */

import { indexWords } from "./align.ts";
import { parseWords } from "./cuts.ts";
import { acceptable, matchByTranscript, type MatchResult } from "./scout-mission.ts";

/** A mission this upload turned out to answer. */
export interface Filled {
  missionId: string;
  projectId: string;
  ledgerId: string;
  quote: string;
  match: MatchResult;
}

interface OpenMission {
  id: string;
  project_id: string;
  ledger_id: string;
  quote: string;
  in_s: number;
}

/**
 * Every mission this upload answers, marked answered.
 *
 * Across all of the user's projects, because an upload does not know which
 * project it was for and the transcript is a better judge than a folder. A
 * clip grabbed for one cut that happens to carry a moment another cut was
 * also waiting on answers both, which is right: it is the same footage.
 */
export async function matchOpenMissions(
  db: D1Database,
  opts: { userId: string; sourceId: string },
): Promise<Filled[]> {
  const { results: open } = await db
    .prepare(
      `SELECT m.id, m.project_id, m.ledger_id, m.quote, m.in_s
         FROM scout_missions m
         JOIN v2_projects p ON p.id = m.project_id
        WHERE p.user_id = ? AND m.state = 'scouted'
        ORDER BY m.created_at`,
    )
    .bind(opts.userId)
    .all<OpenMission>();
  if (!(open ?? []).length) return [];

  const { results: segs } = await db
    .prepare(`SELECT idx, words FROM segments WHERE source_id=? ORDER BY idx`)
    .bind(opts.sourceId)
    .all<{ idx: number; words: string | null }>();
  const words = indexWords(segs ?? [], parseWords);
  /* No word timings, no match. matchByTranscript says so itself, but asking
     it once per open mission to hear the same answer is work for nothing. */
  if (!words.length) return [];

  const filled: Filled[] = [];
  for (const m of open) {
    const match = matchByTranscript(m.quote, words, Number(m.in_s));
    if (!acceptable(match)) continue;
    filled.push({
      missionId: m.id,
      projectId: m.project_id,
      ledgerId: m.ledger_id,
      quote: m.quote,
      match,
    });
  }
  if (!filled.length) return [];

  /*
   * The verdict and the measurements, not just the state. "Matched" with no
   * coverage is a claim with no receipt, and this is a claim about somebody
   * else's footage being in a cut — the kind the dispute file exists for.
   */
  const up = db.prepare(
    `UPDATE scout_missions SET state='matched', how=?, verdict=?, coverage=?, offset_s=?, fail_reason=NULL
      WHERE id=? AND state='scouted'`,
  );
  await db.batch(
    filled.map((f) =>
      up.bind(f.match.method, f.match.verdict, f.match.coverage, f.match.offsetS, f.missionId),
    ),
  );

  return filled;
}
