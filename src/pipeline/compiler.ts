/**
 * Aldershot — Generative media backbone (text -> image -> video -> voice).
 *
 * Deliberately NOT parameterized by exposed cinematic axes (lens/angle/
 * lighting/etc as separate user-facing fields) — an earlier version of this
 * file was, and that's exactly the shape the design brief rejected ("felt
 * like a form"). Whatever register/look a scene needs is derived upstream
 * (see reason.ts's draftSceneShots) into a single plain prompt string;
 * this file only knows how to turn a prompt into media and store it in R2.
 *
 * NOTE: exact Workers AI request/response shapes for FLUX.2's reference-image
 * field and the Veo partner model are unconfirmed against the live catalog
 * (network access to developers.cloudflare.com is blocked in this sandbox) —
 * written to the most likely documented shape, output validated at each call
 * site so a wrong guess fails loudly instead of silently misbehaving.
 */

import type { Env } from "../env";
import { MODELS } from "../models";

const runAI = (env: Env) =>
  env.AI.run.bind(env.AI) as (model: string, inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

async function readImageB64(env: Env, r2Key: string): Promise<string> {
  const obj = await env.MEDIA.get(r2Key);
  if (!obj) throw new Error(`Reference image not found in R2: ${r2Key}`);
  return toBase64(await obj.arrayBuffer());
}

/** Step 1 — generate a still from a prompt. `referenceImageKeys` (up to 4,
 *  R2 keys of earlier stills in the same scene) are passed along so FLUX.2
 *  can hold the same look — this is the actual consistency mechanism behind
 *  "one scene, multiple cuts," not a second model call. Returns the R2 key. */
export async function generateStill(
  env: Env,
  shotId: string,
  prompt: string,
  referenceImageKeys: string[] = [],
): Promise<string> {
  const referenceImages = await Promise.all(referenceImageKeys.slice(0, 4).map((k) => readImageB64(env, k)));
  const input: Record<string, unknown> = { prompt };
  if (referenceImages.length) input.image = referenceImages;
  const result = (await runAI(env)(MODELS.stills, input)) as { image?: string };
  if (!result.image) throw new Error("FLUX.2 returned no image");
  const bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  const key = `generative/${shotId}/still.png`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  return key;
}

/** Step 2 — animate a locked still into a clip via the Veo partner model
 *  (see src/models.ts — no native/Neuron-billed video model exists today).
 *  Returns the R2 key of the rendered clip. */
export async function animate(
  env: Env,
  shotId: string,
  stillKey: string,
  motionPrompt: string,
  durationSeconds: number,
  aspectRatio: "16:9" | "9:16" | "1:1",
): Promise<string> {
  const image = await readImageB64(env, stillKey);
  const result = (await runAI(env)(MODELS.animate, {
    image,
    prompt: motionPrompt,
    duration: durationSeconds,
    aspect_ratio: aspectRatio,
  })) as { video?: ReadableStream | ArrayBuffer };
  if (!result.video) throw new Error("Veo returned no video");
  const key = `generative/${shotId}/clip.mp4`;
  await env.MEDIA.put(key, result.video as ReadableStream, { httpMetadata: { contentType: "video/mp4" } });
  return key;
}

/** Voiceover for a beat/line — native, Neuron-billed. Not wired into the
 *  Generative UI yet (no route calls this today); kept for the essay
 *  voiceover-recording fast-follow this was originally built toward. */
export async function narrate(env: Env, beatId: string, text: string): Promise<string> {
  const result = (await runAI(env)(MODELS.voice, { text })) as { audio?: ReadableStream };
  if (!result.audio) throw new Error("Aura returned no audio");
  const key = `beats/${beatId}/vo.mp3`;
  await env.MEDIA.put(key, result.audio, { httpMetadata: { contentType: "audio/mpeg" } });
  return key;
}
