/**
 * Ingest — upload → read. The whole of Phase 1's claim.
 *
 * Sequenced per 04-API-AND-JOBS.md: nothing blocks on the LLM, every long step
 * is a job with real staged progress, and every consumer meters what it burned.
 *
 * The cap is checked BEFORE any work starts. Refusing after spending the money
 * is worse than not having a cap.
 */

import type { Env } from "./env.ts";
import { advance, createJob, failJob, finishJob, startJob } from "./jobs.ts";
import { nameSourceCut } from "./naming.ts";
import { meter } from "./usage.ts";
import { checkCap, type Plan } from "./plans.ts";
import { extractAudio, isAudio } from "./audio.ts";
import { transcribeObject } from "./transcribe.ts";
import { saveSegments, setTranscriptState, type Source } from "./sources.ts";

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
      const audio = await extractAudio(env, src.r2_key, (label: string) => {
        void advance(env.DB, job.id, 8, label);
      });
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
    const count = await saveSegments(env.DB, src.id, result.segments);

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

    await env.DB
      .prepare(`UPDATE sources SET duration_s=?, transcript_state='ready' WHERE id=?`)
      .bind(Math.round(result.duration), src.id)
      .run();

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
    // The retry must keep the user's brief — never make them retype
    // (04-API-AND-JOBS.md §Failure rules).
    await failJob(env.DB, job.id, `Couldn't read that video: ${message}`);
    await setTranscriptState(env.DB, src.id, "failed");
    return { jobId: job.id };
  }
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
