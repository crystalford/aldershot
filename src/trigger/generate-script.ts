import { task } from "@trigger.dev/sdk/v3";
import { supabase, updateJobStatus } from "@/lib/supabase";
import { generateScript } from "@/lib/claude";
import type { GenerateScriptInput } from "@/types/studio";

export const generateScriptTask = task({
  id: "generate-script",
  maxDuration: 300,
  run: async (payload: { job_id: string; input: GenerateScriptInput }) => {
    const { job_id, input } = payload;

    await updateJobStatus(job_id, "running");

    try {
      const generated = await generateScript(input);

      // Insert the script into the database
      const { data: script, error: scriptError } = await supabase
        .from("scripts")
        .insert({
          project_id: input.project_id,
          content: generated.content,
          format: generated.format,
          ai_generated: true,
          version: 1,
        })
        .select()
        .single();

      if (scriptError) throw scriptError;

      // Advance project status to pre_production
      await supabase
        .from("projects")
        .update({ status: "pre_production", updated_at: new Date().toISOString() })
        .eq("id", input.project_id)
        .eq("status", "concept"); // only if still concept

      await updateJobStatus(job_id, "completed", {
        output: {
          script_id: script.id,
          scene_count: generated.scene_count,
          summary: generated.summary,
        },
      });

      return { script_id: script.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});
