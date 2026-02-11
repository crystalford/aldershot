import type { TranscriptSegment } from "@/types/pipeline";

const SUPADATA_API_URL = "https://api.supadata.ai/v1";

/**
 * Fetch YouTube video transcript via Supadata API.
 * They handle proxy rotation and IP blocking on their end.
 */
export async function fetchTranscript(
  youtubeVideoId: string
): Promise<{ segments: TranscriptSegment[]; full_text: string }> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("Missing SUPADATA_API_KEY");

  const response = await fetch(
    `${SUPADATA_API_URL}/youtube/transcript?video_id=${youtubeVideoId}&text=true`,
    {
      headers: {
        "x-api-key": apiKey,
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Supadata transcript fetch failed (${response.status}): ${body}`
    );
  }

  const data = await response.json();

  // Supadata returns { content: [{ text, offset, duration }] }
  const segments: TranscriptSegment[] = (data.content || []).map(
    (seg: { text: string; offset: number; duration: number }) => ({
      text: seg.text,
      start: seg.offset / 1000, // Convert ms to seconds
      duration: seg.duration / 1000,
    })
  );

  const full_text = segments.map((s) => s.text).join(" ");

  return { segments, full_text };
}
