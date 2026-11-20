/**
 * Ingest — upload → read. The whole of Phase 1's claim.
 *
 * Sequenced per 04-API-AND-JOBS.md: nothing blocks on the LLM, every long step
 * is a job with real staged progress, and every consumer meters what it burned.
 *
 * The cap is checked BEFORE any work starts. Refusing after spending the money
 * is worse than not having a cap.
 */

import { presignSource } from "./connections.ts";
import type { Env } from "./env.ts";
import { advance, createJob, failJob, finishJob, isTransient, startJob } from "./jobs.ts";
import { begin } from "./begin.ts";
import { nameSourceCut } from "./naming.ts";
import { meter } from "./usage.ts";
import { checkCap, type Plan } from "./plans.ts";
import { extractAudio, isAudio } from "./audio.ts";
import { transcribeObject } from "./transcribe.ts";
import { getSegments, saveSegments, setTranscriptState, type Source } from "./sources.ts";
import { momentSpans } from "./moments.ts";
import { matchOpenMissions } from "./scout-match.ts";
import { saveClips } from "./projects.ts";
import { dispatch } from "./queue.ts";

export interface IngestOpts {
  plan: Plan;
  /** Opt-in diarization upgrade. */
  diarize?: boolean;
  /** Duration in seconds if already known (from the client's probe). */
  knownDurationS?: number;
  /**
   * An already-created job to report against. The route creates it up front so
   * it can return the id immediately and let the client start polling; without
   * this the job would not exist until the work was already underway.
   */
  jobId?: string;
  /**
   * For starting the work the user asked for, once the transcript exists.
   *
   * The read runs inside a queue consumer or a waitUntil; begin() needs the
   * same handle to dispatch what the brief turned out to mean. Optional
   * because a caller with no context can still read a video — it just cannot
   * follow it with a pass.
   */
  ctx?: { waitUntil(p: Promise<unknown>): void };
}

/**
 * Reads a source: transcribe, persist segments, meter.
 *
 * Deliberately NOT doing probe/frames here — those need ffmpeg in a container
 * and are sequenced separately, so that a source becomes READABLE (the thing
 * the product is about) without waiting on thumbnails.
 */
export async function readSource(env: Env, src: Source, opts: IngestOpts): Promise<{ jobId: string }> {
  const job = opts.jobId
    ? { id: opts.jobId }
    : await createJob(env.DB, { user_id: src.user_id, type: "transcribe", ref_id: src.id });

  // Only the HEAD — a ten-hour source is far too large to pull into the Worker,
  // and the transcriber reads it from R2 in ranges instead.
  const head = await env.MEDIA.head(src.r2_key);
  if (!head) {
    await failJob(env.DB, job.id, "The upload didn't finish. Try adding the video again.");
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }

  // The cap is in source minutes, so we need a duration before spending. If
  // the client measured one, trust it; otherwise estimate from size, and
  // reconcile against the real duration the transcript reports afterwards.
  const estimatedMinutes = opts.knownDurationS
    ? opts.knownDurationS / 60
    : estimateMinutesFromBytes(head.size);

  const cap = await checkCap(env.DB, src.user_id, opts.plan, estimatedMinutes);
  if (!cap.ok) {
    await failJob(env.DB, job.id, cap.message!);
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }

  await startJob(env.DB, job.id, "reading it");
  await setTranscriptState(env.DB, src.id, "running");

  try {
    /*
     * Read the AUDIO, not the video.
     *
     * This was transcribing src.r2_key directly, which meant handing a 4K
     * drone clip to a speech model and asking the Worker to hold it in memory
     * — the "Memory limit would be exceeded before EOF" that killed this
     * upload. An hour of that footage is gigabytes; the same hour of speech is
     * about 14MB. It also makes the MP3 chunk splitter correct, since it is
     * now given actual MP3.
     */
    let readKey = src.r2_key;
    if (!isAudio(src.filename)) {
      /* Imported footage lives in the bucket it came from and is never
         copied here, so the extractor needs a URL signed with that
         connection's key. Null for an ordinary upload, which reads from our
         own bucket exactly as before. */
      const audio = await extractAudio(
        env,
        src.r2_key,
        (label: string) => {
          void advance(env.DB, job.id, 8, label);
        },
        await presignSource(env, src.user_id, src),
      );
      readKey = audio.key;
    }

    // One call under ~4 hours; chunked from R2 above that. See
    // docs/decisions/transcription.md for where the ceiling actually is.
    const result = await transcribeObject(env, env.MEDIA, readKey, {
      diarize: opts.diarize,
      // Long sources report real progress per chunk rather than sitting on one
      // stage for half an hour.
      onProgress: (fraction, done, total) => {
        void advance(env.DB, job.id, Math.round(fraction * 75), `reading it — part ${done} of ${total}`);
      },
    });

    await advance(env.DB, job.id, 80, "writing down what it heard");
    await saveSegments(env.DB, src.id, result.segments);

    /*
     * THE EXTRACTED AUDIO IS RUBBISH NOW. Throw it away.
     *
     * It exists for one reason — handing the speech model 14MB instead of a
     * multi-gigabyte 4K file — and once the transcript is written it has no
     * further use. Nothing deleted it: every video ever read left an MP3 in
     * R2 for the life of the source, roughly 14MB per hour of footage, and
     * storedBytes does not count it, so the storage the product reports was
     * short by exactly that much on every account.
     *
     * Purely derived: a re-read re-extracts it, at the cost of one container
     * pass, which is the right trade against keeping it for ever.
     *
     * Failure here must not fail the read. The transcript is saved; a stray
     * object is tidied up again when the source is deleted.
     */
    if (readKey !== src.r2_key) {
      await env.MEDIA.delete(readKey).catch(() => {});
    }

    /*
     * Name the cut now, while the transcript is in hand.
     *
     * Here rather than at read time because a name has to be stable: it is the
     * heading in the editor, the row in Projects, and the line in Home's feed,
     * and those cannot each generate their own. This is also the only moment
     * the words exist in memory already.
     *
     * The source keeps its filename — see src/naming.ts for why that split is
     * deliberate and not an oversight.
     */
    await advance(env.DB, job.id, 92, "naming it");
    await nameSourceCut(env, src, result.segments.map((s) => s.text).join(" "), job.id);

    /*
     * AND THE LIBRARY GETS THE MOMENTS, whether or not anybody asked for a cut.
     *
     * This is the line that makes a library a library. A moment used to exist
     * only where a brief had run a score pass, so uploading an hour and saying
     * nothing about it left a transcript and nothing to retrieve: the footage
     * was in the account and absent from every search that matters. The whole
     * accumulating-pool premise — that the product gets better the more you
     * put in it — was not true of the implementation.
     *
     * Reading is the paid step (invariant 5) and the moments are what it is
     * for, so they are written here, from the transcript, with no model call
     * and no score. src/moments.ts has the reasoning and the two numbers.
     *
     * Read from the rows rather than from `result.segments`, because
     * saveSegments drops what nobody said — a zero-length segment, empty text,
     * a backwards one (saidAloud, src/sources.ts) — and a moment built from a
     * hallucinated segment is a moment pointing at silence.
     *
     * Failure here must not fail the read, which has succeeded: the transcript
     * is saved, and a re-read lays the spans down then. Said out loud rather
     * than swallowed, because a library that quietly did not fill is exactly
     * the defect this replaces.
     */
    await fillLibrary(env.DB, src);

    /*
     * AND THE GHOSTS THIS UPLOAD MAY HAVE JUST FILLED.
     *
     * Scout finds and links; the person goes and grabs the footage; this is
     * where the product notices they did. src/scout-match.ts has the
     * reasoning — including why a mismatch writes nothing.
     *
     * Same swallow-and-say as the library above: the transcript is saved and
     * a missed match is recoverable, a failed read is not.
     */
    try {
      const filled = await matchOpenMissions(env.DB, { userId: src.user_id, sourceId: src.id });
      if (filled.length) {
        console.log(
          `[ingest] ${src.id} answered ${filled.length} mission(s): ` +
            filled.map((f) => `${f.ledgerId} at ${f.match.atS}s`).join(", "),
        );
      }
    } catch (err) {
      console.log(
        `[ingest] read ${src.id}: the missions were not checked — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    /*
     * NOW do what they asked for.
     *
     * Home is one sentence and a file, and the sentence was thrown away: the
     * composer cleared the field and never sent it, so "Begin →" began
     * nothing. It rides on the source instead (sources.brief), because this is
     * the first moment it can be acted on — there was no transcript to score,
     * react to or outline until this line.
     *
     * Cleared once used, so re-reading the footage later does not re-run a
     * request from last week. Failure here must not fail the READ, which
     * succeeded: the transcript is saved either way and the user can ask again.
     */
    if (src.brief?.trim() && opts.ctx) {
      try {
        await env.DB.prepare(`UPDATE sources SET brief=NULL WHERE id=?`).bind(src.id).run();
        await begin(env, {
          userId: src.user_id,
          sourceId: src.id,
          brief: src.brief.trim(),
          sourceTitle: src.title,
        }, opts.ctx);
      } catch (err) {
        console.log(`[ingest] couldn't start "${src.brief}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await env.DB
      .prepare(`UPDATE sources SET duration_s=?, transcript_state='ready' WHERE id=?`)
      .bind(Math.round(result.duration), src.id)
      .run();

    /*
     * AND THE EDITING COPY, behind the transcript rather than in front of it.
     *
     * The editor plays the original — 45 to 180 minutes of it, gigabytes,
     * scrubbed by clicking words. A 480p copy with a keyframe every two
     * seconds is what makes that feel like an editor instead of a download.
     *
     * Its own job, dispatched here, because making it is a full pass over the
     * video and the transcript must not wait behind it: the words are ready,
     * so the cut opens now and plays the original until the copy exists. See
     * src/proxy.ts.
     *
     * Failure is not fatal to anything, here or in the consumer.
     */
    if (opts.ctx && !src.r2_key.endsWith(".edit.mp4")) {
      try {
        const proxyJob = await createJob(env.DB, {
          user_id: src.user_id, type: "proxy", ref_id: src.id,
        });
        await dispatch(env, opts.ctx, {
          type: "proxy", jobId: proxyJob.id, userId: src.user_id, sourceId: src.id,
        });
      } catch (err) {
        console.log(`[ingest] couldn't queue the editing copy: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Meter with what was ACTUALLY billed — the response reports its own
    // neuron count, so this is not an estimate.
    await meter(env.DB, {
      user_id: src.user_id,
      job_id: job.id,
      job_type: "transcribe",
      source_minutes: result.duration / 60,
      bytes_stored: head.size,
      diarized: result.diarized,
    });

    await finishJob(env.DB, job.id);
    return { jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    /*
     * A BUSY MACHINE IS NOT A BROKEN VIDEO.
     *
     * Twenty videos uploaded at once failed six of them with "Maximum number
     * of running container instances exceeded. Try again later." — and this
     * catch turned that sentence into a permanently failed video with a Retry
     * button for a human to press. Cloudflare had asked us to try again.
     *
     * Rethrowing hands it back to the queue consumer, which already knows how
     * to retry three times and only fails the job when the attempts run out.
     * The job stays running and the transcript state is left alone, because
     * neither has actually gone wrong yet.
     */
    if (isTransient(err)) throw err;

    // The retry must keep the user's brief — never make them retype
    // (04-API-AND-JOBS.md §Failure rules).
    await failJob(env.DB, job.id, `Couldn't read that video: ${message}`);
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }
}

/**
 * Videos that failed because something was busy, put back in the queue.
 *
 * A bulk upload of twenty failed six of them on the container ceiling, and
 * each was left permanently failed behind a Retry button. The fix upstream —
 * rethrowing so the queue retries — helps the NEXT upload; it does nothing
 * for the six already sitting there. A rule is only worth having if it also
 * reaches the rows written before it.
 *
 * Only where the recorded reason is one we would retry today, and only where
 * the source and its file are still there. Bounded per sweep, and capped per
 * video: something that has failed this way four times is not being unlucky,
 * and going round for ever would hide a real problem behind a spinner.
 */
export async function requeueTransientReads(
  env: Env,
  /* Same shape dispatch takes. It is only used on the no-queue dev path, but
     a caller that cannot provide one has no business dispatching work. */
  ctx: { waitUntil(p: Promise<unknown>): void },
  limit = 10,
): Promise<number> {
  const { results } = await env.DB
    .prepare(
      /* The plan travels with the message because the cap is checked from it
         when the job runs, not when it is queued. */
      `SELECT s.id, s.user_id, s.r2_key, s.brief, s.duration_s, u.plan,
              (SELECT COUNT(*) FROM jobs j2
                WHERE j2.ref_id = s.id AND j2.type='transcribe' AND j2.state='failed') AS fails,
              (SELECT j3.error FROM jobs j3
                WHERE j3.ref_id = s.id AND j3.type='transcribe' AND j3.state='failed'
                ORDER BY j3.created_at DESC LIMIT 1) AS reason
         FROM sources s JOIN v2_users u ON u.id = s.user_id
        WHERE s.transcript_state='failed' AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string; user_id: string; r2_key: string; brief: string | null;
      duration_s: number | null; plan: string; fails: number; reason: string | null;
    }>();

  let put = 0;
  for (const row of results ?? []) {
    if (!row.reason || !isTransient(row.reason)) continue;
    /* Four goes is not bad luck any more. */
    if (row.fails >= 4) continue;
    /* No file, nothing to read — that is a different failure. */
    const head = await env.MEDIA.head(row.r2_key).catch(() => null);
    if (!head) continue;

    await setTranscriptState(env.DB, row.id, "pending");
    const job = await createJob(env.DB, { user_id: row.user_id, type: "transcribe", ref_id: row.id });
    await dispatch(env, ctx, {
      type: "transcribe",
      jobId: job.id,
      userId: row.user_id,
      sourceId: row.id,
      plan: (row.plan as Plan) ?? "free",
      /* Known from the first read, so the cap check does not fall back to
         estimating from file size a second time. */
      ...(row.duration_s ? { knownDurationS: row.duration_s } : {}),
    });
    put++;
  }
  return put;
}

/**
 * A duration estimate from file size, used only to check the cap before we
 * know the real length. Deliberately CONSERVATIVE (assumes a low bitrate, so
 * it over-estimates minutes) — erring toward refusing a borderline job is
 * better than erring toward spending money we then can't bill for.
 */
export function estimateMinutesFromBytes(bytes: number): number {
  const ASSUMED_BYTES_PER_MINUTE = 1.5 * 1024 * 1024;
  return bytes / ASSUMED_BYTES_PER_MINUTE;
}

/**
 * The moments a read produces, written to the library.
 *
 * Its own exported function because the read around it has no test — nothing
 * in test/ calls readSource, which needs a transcription model, a container
 * and R2 — so wiring this inline would have left the one new step in the
 * pipeline exercised by nothing. This takes a database and a source and can
 * be driven directly.
 *
 * READ FROM THE ROWS, not from the transcription result — and the reason is
 * NOT the one I first wrote here.
 *
 * I claimed it was hallucination filtering: saveSegments drops what nobody
 * said (saidAloud — empty text, or end <= start), so the rows are cleaner
 * than the result. Then I broke it by feeding a hallucinated segment straight
 * in, and nothing failed, because momentSpans rejects exactly those two
 * shapes itself. On that argument the two sources are interchangeable.
 *
 * The real reason is consistency with the span. saveClips numbers words from
 * `SELECT idx, words FROM segments` — the rows — and every moment's word-id
 * address comes out of that numbering. Building the ranges from one source
 * and addressing them from another is how a moment ends up with a span that
 * does not contain it. Same rows for both, and the question cannot arise.
 *
 * Failure must not fail the read, which has succeeded: the transcript is
 * saved, and a re-read lays the spans down then. Said out loud rather than
 * swallowed, because a library that quietly did not fill is exactly the
 * defect this exists to end.
 */
export async function fillLibrary(db: D1Database, src: Source): Promise<number> {
  try {
    const spans = momentSpans(await getSegments(db, src.id));
    if (!spans.length) return 0;
    const saved = await saveClips(
      db,
      { user_id: src.user_id, source_id: src.id, origin: "read", posterKey: src.poster_r2_key },
      spans,
    );
    return saved.length;
  } catch (err) {
    console.log(
      `[ingest] read ${src.id}: the transcript saved and the moments did not — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}
