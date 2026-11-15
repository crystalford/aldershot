/**
 * RUNNING THE JUDGE OVER THE EVAL SET.
 *
 * src/judge.ts is the capability and the arithmetic around it; this is the
 * part that reads claims out of the database, asks, and writes the answers
 * down beside the people's.
 *
 * CLAIM BY CLAIM, because the judge's whole advantage is comparison: shown
 * eight moments against one claim it can see that the third is the one that
 * says it and the other seven are about the same evening. Shown them one at
 * a time it has nothing to be near-miss relative to.
 *
 * AND IT JUDGES EXACTLY WHAT THE PEOPLE JUDGED. Not what retrieval returns
 * today — retrieval changes, and then the two sets of answers would be
 * about different moments and every number comparing them would be a
 * comparison of two different questions. The human judgements ARE the
 * question list.
 */

import type { Env } from "./env.ts";
import { JUDGE_VERSION, judge, type Candidate } from "./judge.ts";

export interface JudgeRunResult {
  claims: number;
  judged: number;
  /** Claims with human judgements but no moments left to look at. */
  skipped: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

interface Pair {
  claim_id: string;
  claim: string;
  clip_id: string;
  quote: string;
}

export async function runJudge(
  env: Env,
  userId: string,
  opts: { version?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<JudgeRunResult> {
  const version = opts.version ?? JUDGE_VERSION;

  /*
   * EVERY PAIR A PERSON HAS ANSWERED, from both judgement tables — the same
   * union the eval page and the export read, so the judge is asked about
   * exactly the set the numbers are computed over.
   */
  const { results: pairs } = await env.DB.prepare(
    `SELECT c.id AS claim_id, c.text AS claim, p.clip_id AS clip_id, cl.quote AS quote
       FROM eval_claims c
       JOIN (
         SELECT claim_id, clip_id FROM eval_judgements
         UNION
         SELECT claim_id, clip_id FROM eval_labels
       ) p ON p.claim_id = c.id
       JOIN v2_clips cl ON cl.id = p.clip_id AND cl.deleted_at IS NULL
      WHERE c.user_id = ?
      ORDER BY c.created_at, p.clip_id`,
  )
    .bind(userId)
    .all<Pair>();

  const byClaim = new Map<string, { claim: string; candidates: Candidate[] }>();
  for (const p of pairs ?? []) {
    const entry = byClaim.get(p.claim_id) ?? { claim: p.claim, candidates: [] };
    entry.candidates.push({ id: p.clip_id, quote: p.quote });
    byClaim.set(p.claim_id, entry);
  }

  let judged = 0;
  let skipped = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let model = "";
  let done = 0;

  for (const [claimId, { claim, candidates }] of byClaim) {
    done += 1;
    opts.onProgress?.(done, byClaim.size);
    if (!candidates.length) {
      skipped += 1;
      continue;
    }

    const out = await judge(env, claim, candidates);
    tokensIn += out.tokensIn;
    tokensOut += out.tokensOut;
    model = out.model || model;

    /*
     * A CALL THE MODEL ANSWERED NOTHING FOR IS NOT WRITTEN AS ALL
     * `unrelated`.
     *
     * parseJudgements fills the gaps so a short answer cannot silently
     * shrink the set — but filling EVERY gap means the model said nothing,
     * and recording that silence would put a column of confident
     * `unrelated`s into the numbers. `answered` is what tells the two
     * apart; an earlier version guessed from the token count, which is
     * zero on any provider that does not report usage.
     */
    if (!out.judgements.some((j) => j.answered)) {
      skipped += 1;
      continue;
    }

    const now = Date.now();
    await env.DB.batch(
      out.judgements.map((j) =>
        env.DB.prepare(
          `INSERT INTO eval_machine
             (claim_id, clip_id, version, model, verdict, raw, downgraded, answered, line, why, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(claim_id, clip_id, version) DO UPDATE SET
             model=excluded.model, verdict=excluded.verdict, raw=excluded.raw,
             downgraded=excluded.downgraded, answered=excluded.answered,
             line=excluded.line, why=excluded.why,
             created_at=excluded.created_at`,
        ).bind(
          claimId,
          j.id,
          version,
          j.model,
          j.said,
          j.raw,
          j.downgraded ? 1 : 0,
          j.answered ? 1 : 0,
          j.line,
          j.why,
          now,
        ),
      ),
    );
    judged += out.judgements.length;
  }

  return { claims: byClaim.size, judged, skipped, tokensIn, tokensOut, model };
}
