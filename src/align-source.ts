/**
 * RUNNING THE ALIGNER OVER A SOURCE, AND WRITING THE RESULT BACK.
 *
 * `src/align.ts` is the contract and the arithmetic — what a timing is worth,
 * how a source is cut into windows, how the windows are joined. This is the
 * part that touches a container and a database: it reads the words the
 * recogniser found, asks where they actually are, and puts the answer back
 * in the same column.
 *
 * NOTHING NEW IS SAID. Forced alignment searches for the best path through
 * the audio that produces a GIVEN sequence of words, so the words that come
 * out are the words that went in. It cannot invent one, drop one or change
 * the order. Only the numbers move — which is why this can rewrite a stored
 * transcript at all, and why `start_word`/`end_word` on a moment survive it
 * while `start_ms`/`end_ms` would not.
 *
 * WHEN IT RUNS. Doc 17 says "lazily, the first time a source is used in a
 * cut". That is the right instinct and the wrong moment: a person who has
 * written a brief and pressed the button is the worst possible audience for
 * a ten-minute wait. It runs when a source is ATTACHED instead — the first
 * honest signal that this footage is going to be cut — and the work is
 * usually finished before the sentence is. It is idempotent and recorded, so
 * attaching the same video to four projects aligns it once.
 */

import {
  indexWords,
  monotonic,
  planAlignWindows,
  stitchAlignment,
  timingFor,
  timingOf,
  type AlignWindow,
  type Aligned,
  type Timing,
  type WindowTiming,
} from "./align.ts";
import { parseWords, type StoredWord } from "./cuts.ts";
import { audioKeyFor } from "./audio.ts";
import { scopeOf } from "./projects.ts";
import { presignGet } from "./r2sign.ts";
import type { Env } from "./env.ts";

/**
 * How many windows go in one request.
 *
 * Each is about thirty seconds of audio, so this is roughly an hour of
 * source per call. Small enough that a request finishes well inside its
 * deadline, large enough that the decode — which the container keeps between
 * calls — is amortised over real work.
 */
export const BATCH = 120;

/** A source whose alignment is this old is not retried on an attach. */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export interface AlignOutcome {
  /** Words whose timing moved. */
  aligned: number;
  /** Words the aligner could not place, which keep what they had. */
  kept: number;
  /** Windows that returned nothing at all. */
  failedWindows: number;
  /** How many words had to be pulled back into order. See `monotonic`. */
  repaired: number;
}

interface SourceRow {
  id: string;
  r2_key: string;
  timing_source: string | null;
  aligned_at: number | null;
}

/**
 * Whether there is anything to do.
 *
 * Separated so the attach path can ask without doing any work: attaching is
 * a link press and happens often, and a job queued for a source that is
 * already aligned is a job somebody has to watch finish.
 */
export function needsAlignment(row: SourceRow, now = Date.now()): boolean {
  if (row.timing_source === "forced") return false;
  /* A failed attempt leaves timing_source null and aligned_at set. Retrying
     it on every attach would hammer a source that cannot be aligned — a
     video with no speech in it, for one — so it waits. */
  if (row.aligned_at && now - row.aligned_at < RETRY_AFTER_MS) return false;
  return true;
}

interface ContainerResult {
  ok: boolean;
  timings?: WindowTiming[];
  error?: string;
}

/**
 * Ask the container about one batch of windows.
 *
 * Bounded, like every other call into a container in this codebase: a hung
 * request is not a slow request, it is a machine that never sleeps, and
 * @cloudflare/containers refuses to sleep while a request is outstanding.
 * Twenty minutes for an hour of audio is generous and finite.
 */
async function alignBatch(
  env: Env,
  sourceKey: string,
  url: string,
  windows: AlignWindow[],
): Promise<ContainerResult[]> {
  const ns = env.RENDER;
  if (!ns) throw new Error("the aligner isn't running");
  const container = ns.get(ns.idFromName(`align-${sourceKey}`)) as unknown as {
    fetch(u: string, init?: RequestInit): Promise<Response>;
    sleepNow?(): Promise<void>;
  };

  const res = await container.fetch("http://container/align", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      windows: windows.map((w) => ({ startMs: w.startMs, endMs: w.endMs, words: w.words })),
    }),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail.slice(0, 200) || `the aligner failed (${res.status})`);
  }
  const body = (await res.json()) as { results?: ContainerResult[] };
  return Array.isArray(body.results) ? body.results : [];
}

/**
 * The stored words, with the aligned ones moved.
 *
 * Walks the segments in the same order `indexWords` does, because that order
 * IS the word id. Anything that walked them differently would write each
 * word's timing onto a different word, which is the one failure mode here
 * that would look like success.
 */
export function applyToSegments(
  segments: Array<{ idx: number; words: string | null }>,
  moved: Map<number, { startMs: number; endMs: number }>,
): Array<{ idx: number; words: string }> {
  const out: Array<{ idx: number; words: string }> = [];
  let index = 0;
  for (const seg of [...segments].sort((a, b) => a.idx - b.idx)) {
    const words = parseWords(seg.words);
    if (!words.length) continue;
    let touched = false;
    const next: StoredWord[] = words.map((w) => {
      const m = moved.get(index);
      index += 1;
      if (!m) return w;
      touched = true;
      /* SECONDS in storage, milliseconds everywhere else — the landmine
         documented in src/cuts.ts. This is the one place that converts back. */
      return { w: w.w, s: m.startMs / 1000, e: m.endMs / 1000 };
    });
    if (touched) out.push({ idx: seg.idx, words: JSON.stringify(next) });
  }
  return out;
}

/**
 * Align one source, end to end.
 *
 * Throws rather than returning an error object, so the job handler's own
 * failure path records it — invariant 7: a handler that swallowed this would
 * leave a source that says it was aligned and was not.
 */
export async function alignSource(
  env: Env,
  sourceId: string,
  onProgress?: (label: string, pct: number) => void,
): Promise<AlignOutcome> {
  const src = await env.DB.prepare(
    "SELECT id, r2_key, timing_source, aligned_at FROM sources WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(sourceId)
    .first<SourceRow>();
  if (!src) throw new Error("that video isn't here any more");

  const { results: segments } = await env.DB.prepare(
    "SELECT idx, words FROM segments WHERE source_id = ? ORDER BY idx",
  )
    .bind(sourceId)
    .all<{ idx: number; words: string | null }>();

  const words = indexWords(segments ?? [], parseWords);
  if (!words.length) throw new Error("that video has no word timings to align");

  /*
   * THE AUDIO, NOT THE VIDEO.
   *
   * extractAudio already put a 32kbps mono 16kHz MP3 in R2 for the
   * recogniser. Pointing the aligner at the original would make it decode
   * gigabytes of pixels to reach the same samples.
   */
  const audioKey = audioKeyFor(src.r2_key);
  const head = await env.MEDIA.head(audioKey);
  if (!head) throw new Error("that video's audio hasn't been separated yet");
  const url =
    (await presignGet(env, audioKey, 7200)) ??
    (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${audioKey}` : null);
  if (!url) throw new Error("couldn't give the aligner a way to read the audio");

  const plan = planAlignWindows(words);
  const results: ContainerResult[] = [];
  for (let at = 0; at < plan.length; at += BATCH) {
    const batch = plan.slice(at, at + BATCH);
    results.push(...(await alignBatch(env, src.r2_key, url, batch)));
    onProgress?.("lining up the words", Math.round(((at + batch.length) / plan.length) * 100));
  }

  const stitched = stitchAlignment(plan, results);
  const { words: fixed, repaired } = monotonic(stitched);
  const moved = new Map(fixed.map((w) => [w.index, { startMs: w.startMs, endMs: w.endMs }]));

  const writes = applyToSegments(segments ?? [], moved);
  const now = Date.now();
  await env.DB.batch([
    ...writes.map((w) =>
      env.DB.prepare("UPDATE segments SET words = ? WHERE source_id = ? AND idx = ?").bind(
        w.words,
        sourceId,
        w.idx,
      ),
    ),
    /*
     * `forced` ONLY IF SOMETHING ACTUALLY MOVED.
     *
     * A run where every window failed would otherwise mark the source as
     * frame-accurate while it still carries recogniser timings — and
     * `frameAccurate()` exists precisely so that a cut can refuse rather
     * than quietly do the wrong thing with numbers that were never that
     * precise. A lie here defeats the whole contract.
     */
    env.DB.prepare("UPDATE sources SET timing_source = ?, aligned_at = ? WHERE id = ?").bind(
      moved.size ? "forced" : null,
      now,
      sourceId,
    ),
  ]);

  return {
    aligned: moved.size,
    kept: words.length - moved.size,
    failedWindows: results.filter((r) => !r.ok).length,
    repaired,
  };
}

/**
 * Whether this source should be aligned now.
 *
 * The attach paths call this and then create and dispatch the job
 * themselves, two lines, the same way the Scout route does. An earlier
 * version took the job-maker and the dispatcher as parameters to keep the
 * work in one place, and the one place it kept it was a function with four
 * callbacks that nothing could read.
 */
export async function shouldAlign(env: Env, sourceId: string, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id, r2_key, timing_source, aligned_at FROM sources WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(sourceId)
    .first<SourceRow>();
  return !!row && needsAlignment(row, now);
}

/**
 * WHAT A WHOLE CUT'S TIMINGS ARE WORTH: the worst of its sources.
 *
 * A render draws on everything in its scope, so one source still on
 * recogniser timings makes the whole export soft — the cut is only as
 * accurate as the sloppiest boundary in it. The worst is the honest answer
 * and the cautious one.
 *
 * This exists because the typechecker found `timingFor({ id: projectId })`
 * in the render job: a project id handed to a function that takes a source,
 * which type-checked for as long as `timingFor` ignored its argument. It
 * logged a sentence about this cut's timings that was true of no source in
 * particular.
 */
export async function timingForProject(env: Env, projectId: string): Promise<Timing> {
  /*
   * ITS SCOPE, which is what the cut is built from — not a join through the
   * clips, because the clips ARE the cut and the cut is re-produced from
   * rules and moments rather than stored (invariant 1). A null scope means
   * the whole library, which is what "three minutes on whatever I have"
   * means and what every project made before the column existed has.
   */
  /*
   * ANY DOUBT AT ALL IS `recogniser`.
   *
   * This answers "what are these timings worth?", and the cautious answer is
   * the one that makes a cut land where it always did. A project that is not
   * there, a column that is not there, a database that will not answer — all
   * of them are doubt, and none of them is a reason to fail a render over a
   * hint. It is wrapped for that reason and not to hide a bug: the only
   * consequence of the fallback is a join on the phoneme instead of in the
   * pause, which is this product's behaviour everywhere alignment has not run.
   */
  let project: { user_id: string; scope: string | null } | null = null;
  try {
    project = await env.DB.prepare(
      "SELECT user_id, scope FROM v2_projects WHERE id = ? AND deleted_at IS NULL",
    )
      .bind(projectId)
      .first<{ user_id: string; scope: string | null }>();
  } catch {
    return timingOf("recogniser");
  }
  if (!project) return timingOf("recogniser");

  const scope = scopeOf(project);
  let results: Array<{ timing_source: string | null }> | undefined;
  try {
    ({ results } = scope
    ? await env.DB.prepare(
        `SELECT DISTINCT timing_source FROM sources
          WHERE deleted_at IS NULL AND id IN (${scope.map(() => "?").join(",")})`,
      )
        .bind(...scope)
        .all<{ timing_source: string | null }>()
    : await env.DB.prepare(
        "SELECT DISTINCT timing_source FROM sources WHERE user_id = ? AND deleted_at IS NULL",
      )
        .bind(project.user_id)
        .all<{ timing_source: string | null }>());
  } catch {
    return timingOf("recogniser");
  }

  const rows = results ?? [];
  /* No rows is not "perfect", it is "nothing to go on" — and a cut with no
     clips cannot be frame-accurate about anything. */
  if (!rows.length) return timingOf("recogniser");
  return rows
    .map((r) => timingFor(r))
    .reduce((worst, t) => (t.toleranceMs > worst.toleranceMs ? t : worst));
}

/* ── One short clip, against the words it should contain ────────────────── */

/**
 * ALIGN A RECORDED TAKE TO ITS LINE.
 *
 * The same aligner, asked a smaller question: one file, one window, the
 * words that were written. No window planning — a take is a sentence, well
 * inside the thirty seconds a window holds — and no stitching, because
 * there is nothing to stitch.
 *
 * The scores come back untouched. src/take.ts decides what they mean: a
 * forced aligner cannot refuse, so it will place a script over a recording
 * of something else and report times for every word, and the only honest
 * signal that happened is how badly each one matched.
 */
export async function alignTake(
  env: Env,
  key: string,
  words: string[],
): Promise<Aligned[]> {
  if (!words.length) return [];
  const head = await env.MEDIA.head(key);
  if (!head) throw new Error("that recording isn't here any more");

  const url =
    (await presignGet(env, key, 7200)) ??
    (env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE}/media/${key}` : null);
  if (!url) throw new Error("couldn't give the aligner a way to read the recording");

  /*
   * ONE WINDOW OVER THE WHOLE FILE. `endMs` is deliberately large rather
   * than the duration the browser claimed: the container clamps a window
   * to the audio it actually decoded, so asking for more than there is
   * returns all of it, and asking for what a client said there was would
   * trust the number this whole function exists to replace.
   */
  const [result] = await alignBatch(env, key, url, [
    { startMs: 0, endMs: 10 * 60 * 1000, first: 0, last: words.length - 1, words },
  ]);
  if (!result?.ok || !result.timings) {
    throw new Error(result?.error || "the aligner did not answer");
  }

  const out: Aligned[] = [];
  result.timings.forEach((t, i) => {
    if (!t) return;
    out.push({ index: i, startMs: Math.round(t[0] * 1000), endMs: Math.round(t[1] * 1000), score: t[2] });
  });
  return out;
}
