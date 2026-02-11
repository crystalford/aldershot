import type { ApifyClipResult } from "@/types/pipeline";

const APIFY_API_URL = "https://api.apify.com/v2";

/**
 * Extract a clip from a YouTube video using Apify's YouTube Video Clipper.
 * They handle residential proxies and fallback methods.
 *
 * Actor: topaz_shabu/youtube-video-clipper
 */
export async function extractClip(params: {
  videoUrl: string;
  startSeconds: number;
  endSeconds: number;
  resolution?: "360p" | "480p" | "720p" | "1080p";
}): Promise<ApifyClipResult> {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) throw new Error("Missing APIFY_API_TOKEN");

  const {
    videoUrl,
    startSeconds,
    endSeconds,
    resolution = "720p",
  } = params;

  // Start the actor run
  const runResponse = await fetch(
    `${APIFY_API_URL}/acts/topaz_shabu~youtube-video-clipper/runs?token=${apiToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: videoUrl,
        startTime: formatTimestamp(startSeconds),
        endTime: formatTimestamp(endSeconds),
        resolution,
      }),
    }
  );

  if (!runResponse.ok) {
    const body = await runResponse.text();
    throw new Error(`Apify run start failed (${runResponse.status}): ${body}`);
  }

  const run = await runResponse.json();
  const runId = run.data?.id;

  if (!runId) throw new Error("Apify did not return a run ID");

  // Poll for completion
  const result = await pollApifyRun(runId, apiToken);

  return result;
}

/**
 * Poll an Apify run until it completes or fails.
 */
async function pollApifyRun(
  runId: string,
  apiToken: string
): Promise<ApifyClipResult> {
  const maxAttempts = 60; // 10 minutes at 10s intervals
  const pollInterval = 10_000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const statusResponse = await fetch(
      `${APIFY_API_URL}/actor-runs/${runId}?token=${apiToken}`
    );

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    const status = statusData.data?.status;

    if (status === "SUCCEEDED") {
      // Fetch the dataset results
      const datasetId = statusData.data?.defaultDatasetId;
      const itemsResponse = await fetch(
        `${APIFY_API_URL}/datasets/${datasetId}/items?token=${apiToken}`
      );

      if (!itemsResponse.ok) {
        throw new Error("Failed to fetch Apify dataset items");
      }

      const items = await itemsResponse.json();
      const clip = items[0];

      if (!clip?.clipUrl) {
        throw new Error("Apify returned no clip URL");
      }

      return {
        clip_url: clip.clipUrl,
        resolution: clip.resolution || "720p",
        duration_seconds: clip.duration || 0,
        file_size_bytes: clip.fileSize,
      };
    }

    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}: ${statusData.data?.statusMessage}`);
    }

    // Still running, continue polling
  }

  throw new Error("Apify run timed out after 10 minutes");
}

/**
 * Format seconds to HH:MM:SS for Apify input
 */
function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
