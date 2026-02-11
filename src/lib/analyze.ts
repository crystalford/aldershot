import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ClipAnalysis, TranscriptSegment } from "@/types/pipeline";

const clipAnalysisSchema = z.object({
  best_moment: z.object({
    start_seconds: z
      .number()
      .describe("Start time in seconds of the best clip"),
    end_seconds: z.number().describe("End time in seconds of the best clip"),
    duration_seconds: z.number().describe("Duration of the clip in seconds"),
    summary: z
      .string()
      .describe("Brief summary of what happens in this moment"),
    why_viral: z
      .string()
      .describe("Why this moment would perform well as a short-form clip"),
  }),
  article_headline: z
    .string()
    .describe("Compelling headline for an article about this video"),
  article_body: z
    .string()
    .describe(
      "Full article body (3-5 paragraphs) covering the key points from the video"
    ),
  x_post_text: z
    .string()
    .describe(
      "Engaging X/Twitter post text (under 280 chars) to accompany the clip"
    ),
  hashtags: z
    .array(z.string())
    .describe("Relevant hashtags for the X post"),
});

/**
 * Analyze a transcript to find the best clip moment and generate content.
 * Uses Claude to identify the most newsworthy/viral 30-60s segment.
 */
export async function analyzeTranscript(params: {
  transcript: string;
  segments: TranscriptSegment[];
  videoTitle: string;
  channelName: string;
}): Promise<ClipAnalysis> {
  const { transcript, segments, videoTitle, channelName } = params;

  // Build a timestamped version of the transcript for accurate clip selection
  const timestampedTranscript = segments
    .map((s) => `[${formatTime(s.start)}] ${s.text}`)
    .join("\n");

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-5-20250929"),
    schema: clipAnalysisSchema,
    prompt: `You are a political media analyst and content editor for a news commentary site.

VIDEO: "${videoTitle}" from ${channelName}
CHANNEL: This is CPAC (Conservative Political Action Conference) or similar political content.

TIMESTAMPED TRANSCRIPT:
${timestampedTranscript}

YOUR TASK:
1. Identify the single BEST 30-60 second moment from this video that would make the most compelling short-form clip. Look for:
   - A powerful quote or statement
   - A controversial or newsworthy claim
   - An emotional or passionate moment
   - Something that would generate discussion/engagement

2. Return the exact start and end timestamps (in seconds) for this clip. The clip MUST be between 30-60 seconds long.

3. Write a compelling news article (3-5 paragraphs) about the video's content. Write in a direct, editorial style.

4. Write an engaging X/Twitter post (under 280 characters) that would accompany the clip. Make it attention-grabbing but not clickbait.

5. Suggest relevant hashtags.

IMPORTANT: The timestamps must align with actual transcript segments. Do not hallucinate timestamps.`,
  });

  return object as ClipAnalysis;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
