import { task } from "@trigger.dev/sdk/v3";
import { supabase, updateJobStatus } from "@/lib/supabase";
import { generateShots } from "@/lib/claude";
import type { GenerateShotsInput } from "@/types/studio";

export const generateShotsTask = task({
  id: "generate-shots",
  maxDuration: 300,
  run: async (payload: { job_id: string; input: GenerateShotsInput }) => {
    const { job_id, input } = payload;

    await updateJobStatus(job_id, "running");

    try {
      // Fetch scene details
      const { data: scene, error: sceneError } = await supabase
        .from("scenes")
        .select("title, description, mood, location")
        .eq("id", input.scene_id)
        .single();

      if (sceneError || !scene) throw new Error("Scene not found");

      if (!scene.description) throw new Error("Scene has no description to generate shots from");

      const shots = await generateShots({
        ...input,
        scene_title: scene.title ?? undefined,
        scene_description: scene.description,
        scene_mood: scene.mood ?? undefined,
        scene_location: scene.location ?? undefined,
      });

      const { data: inserted, error: insertError } = await supabase
        .from("shots")
        .insert(
          shots.map((s) => ({
            scene_id: input.scene_id,
            shot_number: s.shot_number,
            shot_type: s.shot_type,
            camera_angle: s.camera_angle,
            camera_movement: s.camera_movement,
            description: s.description,
            prompt: s.prompt,
            duration_seconds: s.duration_seconds,
            order_index: s.order_index,
            status: "draft",
          }))
        )
        .select("id");

      if (insertError) throw insertError;

      await updateJobStatus(job_id, "completed", {
        output: {
          shot_ids: inserted?.map((r) => r.id) ?? [],
          shot_count: shots.length,
        },
      });

      return { shot_count: shots.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});
