/**
 * THE SCAN PHASE, which has never run.
 *
 * `scout-job.ts` has carried this comment since Scout was built: "THE PHASES
 * THAT NEED WHAT V0 HAS NOT GOT... scan needs a readable transcript, which
 * only the podcast adapter currently produces... Each is built and tested;
 * none is reachable until a source arrives with words in it."
 *
 * A source with words in it did arrive — the podcast adapter reads
 * `podcast:transcript` and marks those episodes `native`. What was missing
 * was not the words and not the scanner: it was an ADDRESS. scout_sources
 * recorded that a transcript existed and never recorded where, so the run
 * knew an episode was readable and had no way to reach it. One column, and
 * then this file, which is glue over five things that were already built and
 * tested: vttToWords, planWindows, scanWindow, parseScan and writeLedger.
 *
 * NOTHING HERE DOWNLOADS AUDIOVISUAL CONTENT. Invariant 9, and it is worth
 * saying at the one place that fetches anything from a third party: a
 * published transcript is TEXT that a feed offers for reading, which is the
 * whole reason the podcast adapter exists ("the feed exists to be read,
 * which is not true of any other adapter's media"). The audio beside it is
 * not fetched here and must not be.
 */

import type { Env } from "./env.ts";
import { vttToWords } from "./vtt.ts";
import { planWindows, scanWindow, type Window } from "./scout-scan.ts";
import { markScanned, writeLedger, type LedgerIn, type Scannable } from "./scout-store.ts";
import type { StoredBeat } from "./scout-store.ts";

/**
 * How many model calls one invocation of the phase may make.
 *
 * The phase returns and the run re-dispatches, so a source too long to read
 * in one go is read across several rounds rather than in one call that times
 * out. Bounded here rather than by the budget because the budget is about
 * money and this is about a worker's wall clock.
 */
export const CALLS_PER_PHASE = 24;

/** A transcript that is not VTT is not readable here, whatever it claims. */
const looksLikeVtt = (text: string): boolean => /^﻿?WEBVTT/.test(text.trimStart());

export interface ScanOutcome {
  sourceId: string;
  /** Windows actually read. */
  scanned: number;
  /** Rows written: a quote the model says is there. */
  found: number;
  /** Said rather than thrown, so the run can carry on past one bad feed. */
  skipped?: string;
}

/**
 * Reads one source against the run's beats.
 *
 * ONE NARROW QUESTION PER WINDOW PER BEAT, which is doc 18's shape. A window
 * is read once for each thing the run is looking for, because "does this
 * passage contain the admission" and "does it contain the denial" are
 * different questions with different answers over the same words.
 *
 * The rows go in UNVERIFIED. Verification is the next phase and it is
 * deterministic — a quote is checked against the transcript word for word —
 * so writing anything else here would be the model's claim recorded as a
 * finding. `verify: "rejected"` is the honest default: nothing has checked it.
 */
export async function scanSource(
  env: Env,
  opts: { runId: string; source: Scannable; beats: StoredBeat[]; budget?: number },
): Promise<ScanOutcome> {
  const budget = opts.budget ?? CALLS_PER_PHASE;
  const beats = opts.beats.filter((b) => b.behaviour?.trim());
  if (!beats.length) return { sourceId: opts.source.id, scanned: 0, found: 0, skipped: "no beats to ask about" };

  let text: string;
  try {
    const res = await fetch(opts.source.transcriptUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return { sourceId: opts.source.id, scanned: 0, found: 0, skipped: `transcript fetch said ${res.status}` };
    }
    text = await res.text();
  } catch (err) {
    return {
      sourceId: opts.source.id,
      scanned: 0,
      found: 0,
      skipped: `could not fetch the transcript: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  if (!looksLikeVtt(text)) {
    /* The feed said text/vtt and sent something else. Marked scanned so the
       run stops offering it, with the reason returned rather than a retry
       loop over a file that will not change. */
    await markScanned(env.DB, opts.source.id, 0);
    return { sourceId: opts.source.id, scanned: 0, found: 0, skipped: "the transcript is not VTT" };
  }

  const words = vttToWords(text);
  const windows = planWindows(words);
  if (!windows.length) {
    await markScanned(env.DB, opts.source.id, 0);
    return { sourceId: opts.source.id, scanned: 0, found: 0, skipped: "the transcript has no words in it" };
  }

  const rows: LedgerIn[] = [];
  let calls = 0;
  for (const w of windows) {
    for (const beat of beats) {
      if (calls >= budget) break;
      calls += 1;
      const out = await scanWindow(env, w, beat.behaviour);
      if (out.answer !== "QUOTE" || !out.quote.trim()) continue;
      rows.push(rowFor(opts.runId, opts.source.id, beat, w, out));
    }
    if (calls >= budget) break;
  }

  if (rows.length) await writeLedger(env.DB, rows);

  /* Only when the whole source has been read. A source marked scanned
     halfway through is a source the run will never come back to, and the
     windows it never read are the ones nobody will ever know about. */
  const finished = calls >= windows.length * beats.length;
  if (finished) await markScanned(env.DB, opts.source.id, rows.length);

  return { sourceId: opts.source.id, scanned: calls, found: rows.length };
}

function rowFor(
  runId: string,
  sourceId: string,
  beat: StoredBeat,
  w: Window,
  out: { quote: string; hintWordIndex: number | null; model: string; promptVersion: string },
): LedgerIn {
  return {
    runId,
    beatId: beat.id,
    role: beat.role,
    sourceId,
    quoteExact: out.quote.trim(),
    quoteNorm: out.quote.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
    /*
     * THE WINDOW'S SPAN, NOT THE MODEL'S HINT.
     *
     * Invariant 2: the model never outputs a timestamp. It said which words
     * it thinks the quote starts at and that is a hint for the verifier to
     * narrow its search; the span recorded here is the window that was read,
     * which is a fact about what was looked at. The verifier replaces both
     * with the span it actually matched.
     */
    wordSpan: { startWord: w.startWord, endWord: w.endWord },
    tStartS: w.tStartS,
    tEndS: w.tEndS,
    /* Nothing has checked this yet, and the next phase is what checks it. */
    verify: "rejected",
    matchScore: 0,
    crowdSignals: w.weight,
    modelVersion: `${out.model}/${out.promptVersion}`,
  };
}
