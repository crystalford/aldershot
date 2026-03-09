import { task } from "@trigger.dev/sdk/v3";
import { supabase, updateJobStatus } from "@/lib/supabase";
import { generateImage } from "@/lib/falai";

export const generateHeroImagesTask = task({
  id: "generate-hero-images",
  maxDuration: 900,
  run: async (payload: {
    job_id: string;
    input: {
      project_id: string;
      scene_ids: string[];
      aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:2";
    };
  }) => {
    const { job_id, input } = payload;
    const aspect_ratio = input.aspect_ratio ?? "16:9";

    await updateJobStatus(job_id, "running");

    const results: { scene_id: string; asset_id: string; url: string }[] = [];
    const errors: { scene_id: string; error: string }[] = [];

    try {
      // Fetch all scenes
      const { data: scenes, error: fetchError } = await supabase
        .from("scenes")
        .select("id, title, mood, metadata")
        .in("id", input.scene_ids);

      if (fetchError) throw fetchError;

      for (const scene of scenes ?? []) {
        const meta = scene.metadata as Record<string, unknown>;
        const visualConcept = (meta?.visual_concept as string) ?? scene.title ?? "cinematic scene";
        const mood = scene.mood ?? "cinematic";
        const colorDir = (meta?.color_direction as string) ?? "";
        const visualType = meta?.visual_type as string;

        // Skip text cards — no image needed
        if (visualType === "text_card") continue;

        const prompt = [
          visualConcept,
          `Mood: ${mood}.`,
          colorDir ? `Color palette: ${colorDir}.` : "",
          "Cinematic photography, film still, high quality, 4K.",
        ]
          .filter(Boolean)
          .join(" ");

        try {
          const { url } = await generateImage(prompt, { aspect_ratio });

          const { data: asset, error: assetError } = await supabase
            .from("assets")
            .insert({
              project_id: input.project_id,
              scene_id: scene.id,
              type: "image",
              url,
              generator: "fal-ai/flux/dev",
              prompt,
              metadata: { aspect_ratio, visual_concept: visualConcept },
              status: "ready",
              hero: true,
            })
            .select("id")
            .single();

          if (assetError) throw assetError;

          results.push({ scene_id: scene.id, asset_id: asset.id, url });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ scene_id: scene.id, error: message });
        }
      }

      const status = results.length > 0 ? "completed" : "failed";

      await updateJobStatus(job_id, status, {
        output: { generated: results, errors, count: results.length },
        ...(status === "failed" && { error: "All image generations failed" }),
      });

      return { generated: results.length, failed: errors.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJobStatus(job_id, "failed", { error: message });
      throw err;
    }
  },
});
