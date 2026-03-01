import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateShotsInput,
  GeneratedScript,
  GeneratedScene,
  GeneratedShot,
} from "@/types/studio";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const model = anthropic("claude-sonnet-4-6");

// ─── Script Generation ────────────────────────────────────────────────────────

export async function generateScript(input: GenerateScriptInput): Promise<GeneratedScript> {
  const isMusicVideo = input.type === "music_video";

  const prompt = `You are an expert screenwriter and film director. Generate a ${input.type.replace("_", " ")} script.

Title: ${input.title}
${input.description ? `Concept: ${input.description}` : ""}
${input.genre ? `Genre: ${input.genre}` : ""}
${input.style ? `Visual Style: ${input.style}` : ""}
${input.duration_seconds ? `Target Duration: ${Math.round(input.duration_seconds / 60)} minutes` : ""}
${isMusicVideo && input.lyrics ? `Lyrics:\n${input.lyrics}` : ""}

${
  isMusicVideo
    ? `Write a music video treatment/script with scene-by-scene visual directions that sync to the lyrics and music energy. Each scene should describe:
- The visual action and imagery
- Camera movements and angles
- Lighting and color mood
- Key moments that align with the music`
    : `Write a properly formatted screenplay in plain text (similar to Fountain format) with:
- Scene headings (INT./EXT.)
- Action lines
- Character names and dialogue
- Scene transitions`
}

Return valid JSON with this exact shape:
{
  "content": "<the full script text>",
  "format": "${isMusicVideo ? "plain" : "fountain"}",
  "scene_count": <number>,
  "summary": "<one paragraph synopsis>"
}`;

  const { text } = await generateText({ model, prompt, maxTokens: 4096 });
  const json = extractJSON(text);
  return json as GeneratedScript;
}

// ─── Storyboard / Scene Generation ───────────────────────────────────────────

export async function generateStoryboard(
  input: GenerateStoryboardInput & {
    script_content: string;
    project_type: string;
    project_style?: string;
  }
): Promise<GeneratedScene[]> {
  const prompt = `You are a film director breaking down a script into a storyboard.

Project type: ${input.project_type.replace("_", " ")}
${input.project_style ? `Visual style: ${input.project_style}` : ""}
Target scene count: ${input.num_scenes ?? 6}

Script:
${input.script_content}

Break this script into ${input.num_scenes ?? 6} cinematic scenes. For each scene return:
- scene_number (1-based)
- title (short evocative name)
- description (what happens, 2-3 sentences)
- location (where it takes place)
- time_of_day: one of "day" | "night" | "dusk" | "dawn" | "interior"
- mood (e.g., "melancholic", "euphoric", "tense", "dreamy")
- color_palette (array of 3 hex color codes that define the scene's look)
- duration_seconds (estimated screen time)
- order_index (0-based)

Return a JSON array of scene objects. No extra text, only the JSON array.`;

  const { text } = await generateText({ model, prompt, maxTokens: 3000 });
  const json = extractJSON(text);
  return Array.isArray(json) ? (json as GeneratedScene[]) : [];
}

// ─── Shot List Generation ─────────────────────────────────────────────────────

export async function generateShots(
  input: GenerateShotsInput & {
    scene_title?: string;
    scene_description: string;
    scene_mood?: string;
    scene_location?: string;
  }
): Promise<GeneratedShot[]> {
  const prompt = `You are a cinematographer planning shots for a scene.

Scene: ${input.scene_title ?? "Scene"}
Location: ${input.scene_location ?? "unspecified"}
Mood: ${input.scene_mood ?? "cinematic"}
Description: ${input.scene_description}
Number of shots: ${input.num_shots ?? 5}

Plan ${input.num_shots ?? 5} shots for this scene. For each shot return:
- shot_number (1-based)
- shot_type: one of "extreme-wide" | "wide" | "medium-wide" | "medium" | "medium-close" | "close-up" | "extreme-close-up" | "insert" | "aerial" | "pov"
- camera_angle: one of "eye-level" | "low-angle" | "high-angle" | "dutch" | "birds-eye" | "worms-eye"
- camera_movement: one of "static" | "pan" | "tilt" | "dolly-in" | "dolly-out" | "tracking" | "crane" | "handheld" | "steadicam"
- description (what we see, 1-2 sentences)
- prompt (a detailed AI image generation prompt for this shot, ~50 words, cinematic, photographic)
- duration_seconds (shot length as a decimal number)
- order_index (0-based)

Return a JSON array of shot objects only. No extra text.`;

  const { text } = await generateText({ model, prompt, maxTokens: 2500 });
  const json = extractJSON(text);
  return Array.isArray(json) ? (json as GeneratedShot[]) : [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJSON(text: string): unknown {
  // Try to find JSON block in the text
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ??
    text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)?.[1] ??
    text;
  return JSON.parse(jsonMatch.trim());
}
