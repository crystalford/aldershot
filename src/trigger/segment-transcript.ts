import { task } from "@trigger.dev/sdk/v3";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { supabase, updateJobStatus } from "@/lib/supabase";
import type { EssaySegment, EssayStyle } from "@/types/studio";

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = anthropic("claude-sonnet-4-6");

export const segmentTranscriptTask = task({
  id: "segment-transcript",
  maxDuration: 300,
  run: async (payload: {
    job_id: string;
    input: {
      project_id: string;
      transcript_id: string;
      style: EssayStyle;
      num_segments?: number;
    };
  }) => {
    const { job_id, input } = payload;

    await updateJobStatus(job_id, "running");

    try {
      // Fetch transcript
      const { data: transcript, error: fetchError } = await supabase
        .from("transcripts")
        .select("words, full_text, duration_seconds")
        .eq("id", input.transcript_id)
        .single();

      if (fetchError || !transcript) throw new Error("Transcript not found");

      const words = transcript.words as Array<{ word: string; punctuated_word: string; start: number; end: number }>;
      const numSegments = input.num_segments ?? Math.min(Math.max(Math.ceil(words.length / 80), 4), 16);

      const prompt = `You are a video essay director segmenting a transcript into visual scenes.

Style: ${input.style}
Total words: ${words.length}
Target segments: ${numSegments}

Full transcript (word index reference — words are 0-indexed):
${words.map((w, i) => `[${i}] ${w.punctuated_word}`).join(" ")}

Divide the transcript into exactly ${numSegments} contiguous segments. Each segment should represent a cohesive topic or narrative beat that can be paired with a single visual.

For each segment return:
- scene_number (1-based)
- title (short, 3-6 words)
- topic (the main idea being discussed, 1 sentence)
- visual_concept (detailed description for image generation, 2-3 sentences, cinematic)
- visual_type: one of "generated_image" | "text_card" | "user_resource"
  - use "text_card" only for very short transitions or title cards (< 5 words)
  - use "generated_image" as default
  - use "user_resource" only if the topic is a real-world event/person that would need archival footage
- mood (e.g. "contemplative", "urgent", "hopeful")
- color_direction (e.g. "cool blues and greys", "warm amber tones")
- start_word_index (inclusive, 0-based)
- end_word_index (inclusive, 0-based)
- order_index (0-based)

Segments must be contiguous (end_word_index of segment N + 1 = start_word_index of segment N+1).
First segment starts at 0, last ends at ${words.length - 1}.

Return a JSON array only, no extra text.`;

      const { text } = await generateText({ model, prompt, maxOutputTokens: 4000 });
      const segments = parseJSON(text) as EssaySegment[];

      if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error("Failed to parse segments from Claude response");
      }

      // Insert scenes for each segment
      const { data: inserted, error: insertError } = await supabase
        .from("scenes")
        .insert(
          segments.map((seg) => ({
            project_id: input.project_id,
            scene_number: seg.scene_number,
            title: seg.title,
            description: seg.topic,
            mood: seg.mood,
            order_index: seg.order_index,
            metadata: {
              visual_concept: seg.visual_concept,
              visual_type: seg.visual_type,
              color_direction: seg.color_direction,
              start_word_index: seg.start_word_index,
              end_word_index: seg.end_word_index,
              transcript_id: input.transcript_id,
            },
          }))
        )
        .select("id");

      if (insertError) throw insertError;

      // Update project status
      await supabase
        .from("projects")
        .update({ status: "pre_production", updated_at: new Date().toISOString() })
        .eq("id", input.project_id)
        .eq("status", "concept");

      await updateJobStatus(job_id, "completed", {
        output: {
          scene_ids: inserted?.map((r) => r.id) ?? [],
          segment_count: segments.length,
        },
      });

      return { segment_count: segments.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});

function parseJSON(text: string): unknown {
  const match =
    text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ??
    text.match(/(\[[\s\S]*\])/)?.[1] ??
    text;
  return JSON.parse(match.trim());
}
