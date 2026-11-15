/**
 * THE VERIFY PHASE: the scan's claims, checked against the recording.
 *
 * `scout-verify.ts` is the checker and it had nothing calling it. The scan
 * writes every find with `verify: 'rejected'` — honest, because nothing has
 * looked — and without this phase that was permanent: every quote Scout
 * found was stored as a rejection and nothing could ever reach the board.
 *
 * THE PLANNER WAS ASKING FOR IT AND GETTING ZERO. `snapshot`'s
 * `scansUnverified` counted sources with no ledger row, on the assumption
 * that the VERIFIER writes the row. The scan writes it, so the count was
 * always zero and the phase was never requested. Two halves built to
 * opposite contracts, and the scan's is the right one: a find that only
 * existed after verification would be lost by a worker that died between
 * the two, which is the silent partial failure invariant 7 calls a P1.
 *
 * ONE TRANSCRIPT PER SOURCE, NOT PER QUOTE. Rows arrive grouped by source
 * because that is what `rowsToVerify` orders by, and a source that yielded
 * eight quotes is one fetch of one VTT rather than eight. This is the whole
 * reason the phase works on rows in that order rather than taking a list.
 *
 * AND NO MODEL IS CALLED HERE. Spec 18 §3.6: the step that checks the model
 * cannot itself be a model call, because then nothing is underneath it.
 * Everything in this file is a fetch, a tokenise and a comparison.
 */

import type { Env } from "./env.ts";
import type { IndexedWord } from "./align.ts";
import { contextAround, verifyQuote } from "./scout-verify.ts";
import { rowsToVerify, setVerification, type Unverified } from "./scout-store.ts";
import { vttToWords } from "./vtt.ts";

/**
 * How many finds one delivery checks.
 *
 * Bounded for the same reason every other phase is: one message does one
 * phase and re-dispatches, so a long ledger is read across rounds rather
 * than in one invocation that outlives its worker. Higher than the scan's
 * budget because a check is a comparison rather than a model call — the
 * cost here is the transcript fetches, which the grouping already minimises.
 */
export const ROWS_PER_PHASE = 50;

const looksLikeVtt = (text: string): boolean => /^﻿?WEBVTT/.test(text.trimStart());

export interface VerifyOutcome {
  checked: number;
  verified: number;
  paraphrase: number;
  rejected: number;
  /** Sources whose transcript could not be read, so their rows are untouched. */
  unreadable: string[];
}

/**
 * Check this run's unverified finds.
 *
 * A SOURCE WHOSE TRANSCRIPT WILL NOT LOAD LEAVES ITS ROWS ALONE. They stay
 * `verified_at IS NULL` and the phase will be asked for again — because
 * "we could not look" and "it is not in there" are different answers, and
 * invariant 4's reachable "nothing backs this" has to mean the second one.
 * A fetch that 404s today because a VOD expired must not be recorded as
 * Scout having caught the model inventing a quote.
 */
export async function verifyRun(
  env: Env,
  opts: { runId: string; limit?: number },
): Promise<VerifyOutcome> {
  const rows = await rowsToVerify(env.DB, opts.runId, opts.limit ?? ROWS_PER_PHASE);
  const out: VerifyOutcome = { checked: 0, verified: 0, paraphrase: 0, rejected: 0, unreadable: [] };
  if (!rows.length) return out;

  let openSource: string | null = null;
  let words: IndexedWord[] | null = null;

  for (const row of rows) {
    if (row.sourceId !== openSource) {
      openSource = row.sourceId;
      words = await wordsFor(row);
      if (!words) out.unreadable.push(row.sourceId);
    }
    /* Not `continue` on a falsy check: an empty transcript is unreadable and
       zero words would verify nothing while marking everything checked. */
    if (!words) continue;

    const v = verifyQuote(row.quoteExact, words, row.hintWordIndex);
    const context = v.span ? contextAround(words, v.span) : null;

    await setVerification(env.DB, row.id, {
      verify: v.verify,
      matchScore: v.matchScore,
      span: v.span,
      tStartS: v.tStartS,
      tEndS: v.tEndS,
      ...(context ? { contextBefore: context.before, contextAfter: context.after } : {}),
    });

    out.checked += 1;
    out[v.verify] += 1;
  }

  return out;
}

/** The source's words, or null when the recording cannot be read today. */
async function wordsFor(row: Unverified): Promise<IndexedWord[] | null> {
  try {
    const res = await fetch(row.transcriptUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!looksLikeVtt(text)) return null;
    const words = vttToWords(text);
    return words.length ? words : null;
  } catch {
    /* A timeout or a dead host. Same answer as a 404: we could not look. */
    return null;
  }
}
