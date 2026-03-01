import { task } from "@trigger.dev/sdk/v3";
import { supabase, updateJobStatus } from "@/lib/supabase";
import { generateStoryboard } from "@/lib/claude";
import type { GenerateStoryboardInput } from "@/types/studio";

export const generateStoryboardTask = task({
  id: "generate-storyboard",
  maxDuration: 300,
  run: async (payload: {
    job_id: string;
    input: GenerateStoryboardInput & {
      project_type: string;
      project_style?: string;
    };
  }) => {
    const { job_id, input } = payload;

    await updateJobStatus(job_id, "running");

    try {
      // Fetch the script content
      const { data: script, error: scriptError } = await supabase
        .from("scripts")
        .select("content")
        .eq("id", input.script_id)
        .single();

      if (scriptError || !script) throw new Error("Script not found");

      const scenes = await generateStoryboard({
        ...input,
        script_content: script.content,
      });

      // Insert all scenes
      const { data: inserted, error: insertError } = await supabase
        .from("scenes")
        .insert(
          scenes.map((s) => ({
            project_id: input.project_id,
            script_id: input.script_id,
            scene_number: s.scene_number,
            title: s.title,
            description: s.description,
            location: s.location,
            time_of_day: s.time_of_day,
            mood: s.mood,
            color_palette: s.color_palette,
            duration_seconds: s.duration_seconds,
            order_index: s.order_index,
          }))
        )
        .select("id");

      if (insertError) throw insertError;

      // Advance project to production
      await supabase
        .from("projects")
        .update({ status: "production", updated_at: new Date().toISOString() })
        .eq("id", input.project_id)
        .eq("status", "pre_production");

      await updateJobStatus(job_id, "completed", {
        output: {
          scene_ids: inserted?.map((r) => r.id) ?? [],
          scene_count: scenes.length,
        },
      });

      return { scene_count: scenes.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});
