import { fal } from "@fal-ai/client";

if (!process.env.FAL_KEY) {
  throw new Error("Missing FAL_KEY");
}

fal.config({ credentials: process.env.FAL_KEY });

// ─── FLUX Image Generation ────────────────────────────────────────────────────

export interface GenerateImageResult {
  url: string;
  width: number;
  height: number;
}

export async function generateImage(
  prompt: string,
  options: {
    aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:2";
    seed?: number;
  } = {}
): Promise<GenerateImageResult> {
  const { aspect_ratio = "16:9", seed } = options;

  const sizemap: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 1024, height: 1024 },
    "4:3": { width: 1024, height: 768 },
    "3:2": { width: 1024, height: 682 },
  };

  const size = sizemap[aspect_ratio] ?? sizemap["16:9"];

  const result = await fal.subscribe("fal-ai/flux/dev", {
    input: {
      prompt,
      image_size: size,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
      ...(seed !== undefined && { seed }),
    },
    logs: false,
  });

  const image = (result.data as { images?: { url: string; width: number; height: number }[] })
    .images?.[0];
  if (!image?.url) throw new Error("No image returned from fal.ai");

  return { url: image.url, width: image.width, height: image.height };
}

// ─── Kling Video Animation ────────────────────────────────────────────────────

export interface AnimateImageResult {
  url: string;
  duration_seconds: number;
}

export async function animateImage(
  imageUrl: string,
  prompt: string,
  options: {
    duration?: 5 | 10;
    cfg_scale?: number;
  } = {}
): Promise<AnimateImageResult> {
  const { duration = 5, cfg_scale = 0.5 } = options;

  const result = await fal.subscribe("fal-ai/kling-video/v1.6/standard/image-to-video", {
    input: {
      image_url: imageUrl,
      prompt,
      duration: duration === 5 ? "5" : "10",
      cfg_scale,
    },
    logs: false,
  });

  const video = (result.data as { video?: { url: string } }).video;
  if (!video?.url) throw new Error("No video returned from fal.ai");

  return { url: video.url, duration_seconds: duration };
}
