import { task, logger } from "@trigger.dev/sdk/v3";
import { fetchTranscript } from "@/lib/supadata";
import { analyzeTranscript } from "@/lib/analyze";
import { extractClip } from "@/lib/apify";
import { updateJobStatus } from "@/lib/supabase";

/**
 * Main video processing pipeline.
 * Triggered when a new YouTube video is detected from a monitored channel.
 *
 * Flow:
 * 1. Fetch transcript via Supadata (no YouTube download needed)
 * 2. Analyze with Claude (find best clip, generate article + X post)
 * 3. Extract clip via Apify (they handle YouTube proxies)
 * 4. Store results and notify
 */
export const processVideoTask = task({
  id: "process-video",
  // Allow up to 15 minutes for the full pipeline
  maxDuration: 900,

  run: async (payload: {
    jobId: string;
    videoId: string;
    videoUrl: string;
    videoTitle: string;
    channelId: string;
    channelName: string;
  }) => {
    const { jobId, videoId, videoUrl, videoTitle, channelId, channelName } =
      payload;

    try {
      // ── Step 1: Fetch transcript ──────────────────────────────────
      logger.info("Fetching transcript", { videoId });
      await updateJobStatus(jobId, "fetching_transcript");

      const { segments, full_text } = await fetchTranscript(videoId);

      if (!full_text || segments.length === 0) {
        throw new Error("No transcript available for this video");
      }

      logger.info("Transcript fetched", {
        segments: segments.length,
        chars: full_text.length,
      });

      await updateJobStatus(jobId, "fetching_transcript", {
        transcript: full_text,
      });

      // ── Step 2: Analyze with Claude ───────────────────────────────
      logger.info("Analyzing transcript with Claude", { videoTitle });
      await updateJobStatus(jobId, "analyzing");

      const analysis = await analyzeTranscript({
        transcript: full_text,
        segments,
        videoTitle,
        channelName,
      });

      logger.info("Analysis complete", {
        clipStart: analysis.best_moment.start_seconds,
        clipEnd: analysis.best_moment.end_seconds,
        headline: analysis.article_headline,
      });

      await updateJobStatus(jobId, "analyzing", {
        analysis: JSON.stringify(analysis),
      });

      // ── Step 3: Extract clip via Apify ────────────────────────────
      logger.info("Extracting clip via Apify", {
        start: analysis.best_moment.start_seconds,
        end: analysis.best_moment.end_seconds,
      });
      await updateJobStatus(jobId, "extracting_clip");

      const clipResult = await extractClip({
        videoUrl,
        startSeconds: analysis.best_moment.start_seconds,
        endSeconds: analysis.best_moment.end_seconds,
        resolution: "720p",
      });

      logger.info("Clip extracted", {
        clipUrl: clipResult.clip_url,
        resolution: clipResult.resolution,
      });

      await updateJobStatus(jobId, "extracting_clip", {
        clip_url: clipResult.clip_url,
      });

      // ── Step 4: Mark complete ─────────────────────────────────────
      // TODO: Add Remotion rendering step for subtitles/branding
      // TODO: Add Canopticon publish step
      // TODO: Add X posting step with native video upload

      await updateJobStatus(jobId, "completed", {
        clip_url: clipResult.clip_url,
        analysis: JSON.stringify(analysis),
        article: JSON.stringify({
          headline: analysis.article_headline,
          body: analysis.article_body,
          clip_embed_url: clipResult.clip_url,
        }),
        x_post: JSON.stringify({
          text: `${analysis.x_post_text}\n\n${analysis.hashtags.map((h) => `#${h}`).join(" ")}`,
        }),
      });

      logger.info("Pipeline complete!", { jobId, videoTitle });

      return {
        success: true,
        jobId,
        clip_url: clipResult.clip_url,
        article_headline: analysis.article_headline,
        x_post_text: analysis.x_post_text,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("Pipeline failed", { jobId, error: message });
      await updateJobStatus(jobId, "failed", { error: message });
      throw error;
    }
  },
});
