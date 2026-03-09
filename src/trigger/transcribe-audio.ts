import { task } from "@trigger.dev/sdk/v3";
import { supabase, updateJobStatus } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/deepgram";

export const transcribeAudioTask = task({
  id: "transcribe-audio",
  maxDuration: 600,
  run: async (payload: { job_id: string; input: { project_id: string; audio_url: string } }) => {
    const { job_id, input } = payload;

    await updateJobStatus(job_id, "running");

    try {
      const { words, full_text, duration_seconds } = await transcribeAudio(input.audio_url);

      const { data: transcript, error: insertError } = await supabase
        .from("transcripts")
        .insert({
          project_id: input.project_id,
          audio_url: input.audio_url,
          duration_seconds,
          words,
          full_text,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Store duration on project
      await supabase
        .from("projects")
        .update({ duration_seconds: Math.ceil(duration_seconds), updated_at: new Date().toISOString() })
        .eq("id", input.project_id);

      await updateJobStatus(job_id, "completed", {
        output: {
          transcript_id: transcript.id,
          word_count: words.length,
          duration_seconds,
        },
      });

      return { transcript_id: transcript.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});
