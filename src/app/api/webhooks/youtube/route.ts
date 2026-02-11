import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tasks } from "@trigger.dev/sdk/v3";
import type { processVideoTask } from "@/trigger/video-pipeline";

/**
 * YouTube WebSub (PubSubHubbub) webhook endpoint.
 *
 * GET: Handles subscription verification (hub.challenge)
 * POST: Handles new video notifications from YouTube
 */

// YouTube sends a GET to verify the subscription
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const topic = searchParams.get("hub.topic");

  if (mode === "subscribe" && challenge) {
    console.log(`YouTube WebSub verified for topic: ${topic}`);
    // Return the challenge to confirm subscription
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
}

// YouTube sends a POST when a new video is published
export async function POST(request: NextRequest) {
  const body = await request.text();

  // Parse the Atom feed XML that YouTube sends
  const videoId = extractFromXml(body, "yt:videoId");
  const channelId = extractFromXml(body, "yt:channelId");
  const title = extractFromXml(body, "title");
  const published = extractFromXml(body, "published");

  if (!videoId || !channelId) {
    console.error("Missing videoId or channelId in webhook payload");
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  console.log(`New video detected: "${title}" (${videoId}) from ${channelId}`);

  // Check if this channel is being monitored
  const { data: channel } = await supabase
    .from("monitored_channels")
    .select("*")
    .eq("youtube_channel_id", channelId)
    .single();

  if (!channel) {
    console.log(`Channel ${channelId} not monitored, ignoring`);
    return NextResponse.json({ status: "ignored" });
  }

  // Check if we already processed this video (dedup)
  const { data: existingJob } = await supabase
    .from("video_jobs")
    .select("id")
    .eq("youtube_video_id", videoId)
    .single();

  if (existingJob) {
    console.log(`Video ${videoId} already processed, skipping`);
    return NextResponse.json({ status: "duplicate" });
  }

  // Create a new job record
  const { data: job, error } = await supabase
    .from("video_jobs")
    .insert({
      youtube_video_id: videoId,
      youtube_channel_id: channelId,
      channel_name: channel.channel_name,
      video_title: title || "Untitled",
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      status: "pending",
    })
    .select()
    .single();

  if (error || !job) {
    console.error("Failed to create job:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Trigger the processing pipeline
  await tasks.trigger<typeof processVideoTask>("process-video", {
    jobId: job.id,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoTitle: title || "Untitled",
    channelId,
    channelName: channel.channel_name,
  });

  console.log(`Pipeline triggered for video ${videoId}, job ${job.id}`);

  return NextResponse.json({ status: "processing", jobId: job.id });
}

/**
 * Simple XML tag content extractor.
 * YouTube webhooks send Atom XML, not JSON.
 */
function extractFromXml(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match ? match[1] : null;
}
