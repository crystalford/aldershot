import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";
import type { processVideoTask } from "@/trigger/video-pipeline";

/**
 * Manual trigger endpoint.
 * POST a YouTube URL to kick off the pipeline manually.
 *
 * Body: { url: "https://www.youtube.com/watch?v=VIDEO_ID" }
 */
export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  // Extract video ID from various YouTube URL formats
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "Invalid YouTube URL" },
      { status: 400 }
    );
  }

  // Check for duplicate
  const { data: existingJob } = await supabase
    .from("video_jobs")
    .select("id, status")
    .eq("youtube_video_id", videoId)
    .single();

  if (existingJob) {
    return NextResponse.json(
      {
        error: "Video already processed",
        jobId: existingJob.id,
        status: existingJob.status,
      },
      { status: 409 }
    );
  }

  // Create job
  const { data: job, error } = await supabase
    .from("video_jobs")
    .insert({
      youtube_video_id: videoId,
      youtube_channel_id: "manual",
      channel_name: "Manual",
      video_title: "Processing...",
      video_url: url,
      status: "pending",
    })
    .select()
    .single();

  if (error || !job) {
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }

  // Trigger pipeline
  await tasks.trigger<typeof processVideoTask>("process-video", {
    jobId: job.id,
    videoId,
    videoUrl: url,
    videoTitle: "Processing...",
    channelId: "manual",
    channelName: "Manual",
  });

  return NextResponse.json({ jobId: job.id, status: "processing" });
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
