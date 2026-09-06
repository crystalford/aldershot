/**
 * Per-role model router. Every AI call site reads a model from here by role,
 * never inline, so swapping one is a one-line change.
 *
 * ── Provider policy (set by the owner) ────────────────────────────────────
 * Workers AI is the DEFAULT for every role: one bill, no external dependency,
 * and the product must work with no extra keys configured. Anthropic is an
 * OPTIONAL upgrade for the reasoning-heavy roles — when ANTHROPIC_API_KEY is
 * present those roles route to Claude; when it is absent they stay on Workers
 * AI and nothing breaks.
 *
 * ── Context windows are the binding constraint ────────────────────────────
 * The score pass feeds a whole 90-minute transcript (~120k tokens in, ~20k
 * out) — see 04-API-AND-JOBS.md §2. That is the number that disqualifies most
 * of the catalog, and it disqualified our previous pick:
 *
 *   `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — 24,000 tokens.
 *
 * Cloudflare serves that model truncated to 24k, not the 128k the base model
 * advertises. The v1 build used it for every text role, so any call with a
 * long transcript was being silently truncated. Verified 2026-08 against
 * https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
 *
 * Also note: models whose window is 131k (glm-4.7-flash, llama-4-scout) do NOT
 * fit either — 120k in + 20k out = 140k total. Check the sum, not the input.
 */

export type Role = "reason" | "transcribe" | "embed";

/**
 * Quality tiers. Every role has a Workers AI default that always works with no
 * extra configuration; "upgrade" opts into a better, more expensive option the
 * user has explicitly chosen. Never silently upgrade — the cost difference is
 * large enough that it has to be a decision.
 */
export type Tier = "default" | "upgrade";

/** What each Workers AI model can actually do, so call sites can assert. */
export interface ModelSpec {
  id: string;
  /** Total window in tokens (input + output share it). */
  context: number;
  /** Supports `response_format: { type: "json_schema" }`. */
  jsonSchema: boolean;
  /** Native Cloudflare-hosted (`@cf/`) vs partner pass-through. */
  native: boolean;
}

/**
 * Long-transcript reasoning: score passes, extra passes, intent fallback,
 * reaction placement, essay outlines.
 *
 * Chosen: glm-5.3-flash — 1,048,576-token window, native, json_schema.
 * Re-checked against the Workers AI catalog on 2026-09-06 and still the right
 * default: it is the flash variant of the CURRENT GLM-5 series, not an old
 * model left behind. Per million tokens it is $0.15 in / $0.50 out, against
 * $1.40 / $4.40 for full glm-5.3 and $1.32 / $3.96 for deepseek-v4-pro —
 * roughly a ninth of the price for the work a scoring pass actually does.
 *
 * Cheaper still, if the output ever proves good enough:
 * `@cf/google/gemma-4-26b-a4b-it` at $0.10 / $0.30, 256k window. Context size
 * stopped mattering when scorePass started reading in windows, so this is now
 * a pure quality question and needs real output to judge.
 */
export const REASON: ModelSpec = {
  id: "@cf/zai-org/glm-5.3-flash",
  context: 1_048_576,
  jsonSchema: true,
  native: true,
};

/**
 * Speech-to-text — DEFAULT tier.
 *
 * Confirmed against Cloudflare's own output schema: this model returns
 * `segments[].words[] {word,start,end}` — word-level timestamps, which the
 * design requires for Script-mode striking. There is no input flag to request
 * them; they are part of the documented response shape.
 *
 * It does NOT do diarization. See TRANSCRIBE_DIARIZED for the upgrade tier.
 *
 * CAVEAT for Phase 1: Cloudflare's own guidance is to chunk audio at ~1MB, and
 * each chunk's word timestamps restart at zero. For a 45–180 minute source that
 * is 100+ round-trips plus offset bookkeeping, and byte-slicing compressed audio
 * splits mid-frame. The container path is very likely correct — see
 * docs/decisions/transcription.md.
 */
export const TRANSCRIBE: ModelSpec = {
  id: "@cf/openai/whisper-large-v3-turbo",
  context: 0,
  jsonSchema: false,
  native: true,
};

/**
 * Speech-to-text — UPGRADE tier, opt-in per the owner's tiering policy (same
 * shape as the reasoning tier: a good default, a better paid option the user
 * chooses).
 *
 * Deepgram Nova-3 is the ONLY model in the Workers AI catalog that offers
 * diarization. Its `diarize` input param is documented as "Recognize speaker
 * changes. Each word in the transcript will be assigned a speaker number
 * starting at 0."
 *
 * Two things to know before relying on it:
 *  1. It is a PARTNER pass-through (Deepgram's infrastructure, Deepgram's ToS),
 *     not Cloudflare-hosted, and costs ~10x Whisper: 472.73 neurons/audio-min
 *     vs 46.63 — roughly $0.47 vs $0.046 for a 90-minute video.
 *  2. Cloudflare's documented OUTPUT schema does not list the `speaker` field,
 *     even though the input param promises it. Deepgram's own API does return
 *     it, so this reads as a docs gap — but it is UNVERIFIED. Phase 5 must
 *     confirm empirically before any UI depends on speaker labels, and degrade
 *     to un-diarized segments rather than inventing speakers if it is missing.
 */
export const TRANSCRIBE_DIARIZED: ModelSpec = {
  id: "@cf/deepgram/nova-3",
  context: 0,
  jsonSchema: false,
  native: false,
};

/**
 * Clip embeddings for meaning search and thread formation.
 *
 * `bge-large-en-v1.5` is the ONLY Workers AI model that documents 1024-dim
 * output, which is what the design's Vectorize index is specified at
 * (03-DATA-MODEL.md `clips-1024`) — and a Vectorize index's dimension count
 * cannot be changed after creation, so this choice is load-bearing.
 *
 * Its input cap is 512 tokens. Clip quotes are short, so that fits; if longer
 * text ever needs embedding, it must be windowed, not truncated.
 *
 * Pooling: `mean` (the default). Embeddings made with `cls` pooling are NOT
 * compatible with mean-pooled ones — changing this later means a full re-embed.
 */
/**
 * Text-to-speech — the DEFAULT tier.
 *
 * The design specifies ElevenLabs with the user's own key, which is a fine
 * upgrade and a bad default: it makes a core control ("Generate it" on a beat
 * that wants your voice) dead until the user has gone and got a third-party
 * account. That control shipped visible and doing nothing, which is worse than
 * not shipping it.
 *
 * MeloTTS is the Workers AI text-to-speech model. It is not a cloned voice and
 * is not pretending to be one — it fills a beat so the cut can be watched end
 * to end, and the UI still offers recording as the real answer. Same shape as
 * every other role here: a good default, a better paid option the user opts
 * into.
 */
export const TTS: ModelSpec = {
  id: "@cf/myshell-ai/melotts",
  context: 0,
  jsonSchema: false,
  native: true,
};

export const EMBED: ModelSpec = {
  id: "@cf/baai/bge-large-en-v1.5",
  context: 512,
  jsonSchema: false,
  native: true,
  
};
export const EMBED_DIMS = 1024;
export const EMBED_POOLING = "mean" as const;

/** Anthropic model used for the upgraded path. */
export const ANTHROPIC_REASON = "claude-sonnet-5";

/**
 * The reasoning upgrade WITHOUT an external account.
 *
 * "Better reasoning" was Claude or nothing, and nothing is what it was: it
 * needs ANTHROPIC_API_KEY, which is not set, so the upgrade this product
 * offers in its own UI could not be bought. Full glm-5.3 is the same family
 * as the default rather than a different one — same 1M window, same
 * structured output, no second bill and no second key — and it is a real step
 * up from the flash variant on long or subtle material.
 *
 * Claude still wins when a key IS configured; this is the floor, not a
 * replacement.
 */
export const REASON_UPGRADE: ModelSpec = {
  id: "@cf/zai-org/glm-5.3",
  context: 1_048_576,
  jsonSchema: true,
  native: true,
};

export interface Resolved {
  provider: "workers-ai" | "anthropic";
  id: string;
  context: number;
  jsonSchema: boolean;
  /** Whether this choice returns speaker labels. Only the upgrade tier does. */
  diarizes: boolean;
}

/**
 * Resolves a role to a concrete provider + model. Pass the env so the decision
 * is made per-request from the actual bindings, never from a module-level
 * singleton (Workers are stateless per request).
 */
export function resolveModel(
  role: Role,
  env: { ANTHROPIC_API_KEY?: string },
  tier: Tier = "default",
): Resolved {
  // Reasoning upgrades to Claude when a key is configured, and to full
  // glm-5.3 when it is not — so the upgrade always buys something rather than
  // silently handing back the default model at the default quality.
  if (role === "reason" && tier === "upgrade") {
    if (env.ANTHROPIC_API_KEY) {
      return { provider: "anthropic", id: ANTHROPIC_REASON, context: 200_000, jsonSchema: true, diarizes: false };
    }
    const up = REASON_UPGRADE;
    return { provider: "workers-ai", id: up.id, context: up.context, jsonSchema: up.jsonSchema, diarizes: false };
  }
  // Transcription upgrades to Deepgram Nova-3, the only diarizing option.
  if (role === "transcribe" && tier === "upgrade") {
    const s = TRANSCRIBE_DIARIZED;
    return { provider: "workers-ai", id: s.id, context: s.context, jsonSchema: s.jsonSchema, diarizes: true };
  }
  const spec = role === "reason" ? REASON : role === "transcribe" ? TRANSCRIBE : EMBED;
  return { provider: "workers-ai", id: spec.id, context: spec.context, jsonSchema: spec.jsonSchema, diarizes: false };
}

/**
 * What each upgrade actually buys, for the UI that offers it. Prices are per
 * the 2026-08 Workers AI catalog; treat them as indicative and reconcile
 * against usage_events, which records the real numbers.
 */
export const UPGRADES = {
  reason: {
    label: "Better reasoning",
    detail: "A stronger model reads the transcript instead of the quick one. Slower, noticeably better on long or subtle material.",
    /* No key required any more — see REASON_UPGRADE. It was gated on
       ANTHROPIC_API_KEY, so the one upgrade this product sells could not be
       bought on an account that had not gone and got a second AI subscription. */
    requiresKey: null,
  },
  transcribe: {
    label: "Tell speakers apart",
    detail: "Labels who is talking. Worth it for interviews and podcasts; unnecessary for a single-voice recording.",
    approxCostPer90Min: 0.47,
    defaultCostPer90Min: 0.046,
    requiresKey: null,
  },
} as const;
