/**
 * Aldershot — Cinematic Compiler (v0 spine)
 *
 * Turns an intentional, art-directed shot spec into media via the
 * text -> image -> video backbone (see docs/design/architecture.md):
 *   1. synthPrompt  — compile the cinematic axes into a model prompt
 *   2. generateStill — FLUX.2 (native, neuron-billed): lock the *look* cheaply
 *   3. animate       — Wan 2.7 I2V (partner): add motion to the locked frame
 *   4. narrate       — Aura-2 (native): voiceover
 * Every asset lands in R2. Assembly (ffmpeg in Containers) is the next layer.
 *
 * NOTE: exact Workers AI request/response shapes for the partner video model
 * still need confirming against the live catalog (flagged in feasibility doc §5).
 * Calls below are written to the documented shapes and marked where uncertain.
 */

export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  DB: D1Database;
}

/** The controlled axes of a single intentional shot — the anti-"stock" spec. */
export interface ShotSpec {
  subject: string; // who/what is in frame
  blocking: string; // where they are / how arranged
  lens: string; // e.g. "35mm", "85mm telephoto", "anamorphic wide"
  cameraAngle: string; // height + angle, e.g. "low angle, slightly canted"
  movement: string; // e.g. "slow push-in", "locked-off static"
  lighting: string; // setup + key direction, e.g. "low-key, hard key from window left"
  palette: string; // color story, e.g. "desaturated teal + amber practicals"
  texture: string; // film stock / grain, e.g. "70s 16mm grain, halation"
  mood: string; // emotional register
  intent: string; // what the shot *means* — its symbolic purpose
  motion?: string; // what should move in the I2V step
  durationSeconds?: number; // target clip length
}

/** Model IDs — see docs/research/feasibility.md for hosting/billing notes. */
export const MODELS = {
  still: "@cf/black-forest-labs/flux-2-dev", // native, neuron-billed
  animate: "alibaba/wan-2.7-i2v", // partner, pass-through (cheap I2V for B-roll)
  voice: "@cf/deepgram/aura-2-en", // native, neuron-billed
} as const;

/** Compile the cinematic axes into a single, intentional image prompt. */
export function synthPrompt(spec: ShotSpec): string {
  return [
    spec.subject,
    spec.blocking,
    `${spec.lens} lens`,
    spec.cameraAngle,
    `lighting: ${spec.lighting}`,
    `color: ${spec.palette}`,
    `texture: ${spec.texture}`,
    `mood: ${spec.mood}`,
  ].join(", ");
}

/** Step 2 — lock the look as a still. Returns the R2 key. */
export async function generateStill(
  env: Env,
  shotId: string,
  spec: ShotSpec,
): Promise<string> {
  const prompt = synthPrompt(spec);
  const result = (await env.AI.run(MODELS.still, { prompt })) as { image?: string };
  // FLUX returns a base64 image; decode and persist.
  if (!result.image) throw new Error("FLUX returned no image");
  const bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  const key = `shots/${shotId}/still.png`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  return key;
}

/** Step 3 — animate the locked frame. Returns the R2 key of the clip. */
export async function animate(
  env: Env,
  shotId: string,
  stillKey: string,
  spec: ShotSpec,
): Promise<string> {
  const still = await env.MEDIA.get(stillKey);
  if (!still) throw new Error(`Still not found: ${stillKey}`);
  const image = await still.arrayBuffer();
  // TODO: confirm partner I2V input schema (image encoding, motion/duration params).
  const result = (await env.AI.run(MODELS.animate, {
    image: [...new Uint8Array(image)],
    prompt: spec.motion ?? spec.intent,
    duration: spec.durationSeconds ?? 5,
  })) as { video?: ReadableStream };
  if (!result.video) throw new Error("I2V model returned no video");
  const key = `shots/${shotId}/clip.mp4`;
  await env.MEDIA.put(key, result.video, { httpMetadata: { contentType: "video/mp4" } });
  return key;
}

/** Narration — voiceover for a beat. Returns the R2 key of the audio. */
export async function narrate(env: Env, beatId: string, text: string): Promise<string> {
  const result = (await env.AI.run(MODELS.voice, { text })) as { audio?: ReadableStream };
  if (!result.audio) throw new Error("Aura returned no audio");
  const key = `beats/${beatId}/vo.mp3`;
  await env.MEDIA.put(key, result.audio, { httpMetadata: { contentType: "audio/mpeg" } });
  return key;
}

/** v0 spine: run one shot end-to-end (still -> clip). Proves the Studio works. */
export async function runShot(env: Env, shotId: string, spec: ShotSpec) {
  const stillKey = await generateStill(env, shotId, spec);
  const clipKey = await animate(env, shotId, stillKey, spec);
  return { stillKey, clipKey };
}
