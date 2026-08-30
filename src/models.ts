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
 * Chosen: glm-5.3-flash — 1,048,576-token window, native, json_schema, and
 * ~$0.028 for a 120k-in/20k-out run. Requires a paid billing method on the
 * account (as do all the frontier-tier models); the account is already on
 * Workers Paid for Containers.
 *
 * Cheaper alternative worth A/B testing once there is real output to judge:
 * `@cf/google/gemma-4-26b-a4b-it` — 256k window, json_schema, ~$0.018/run.
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
  // Reasoning upgrades to Claude, and only when a key is actually configured.
  if (role === "reason" && tier === "upgrade" && env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", id: ANTHROPIC_REASON, context: 200_000, jsonSchema: true, diarizes: false };
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
    detail: "Claude reads the transcript instead of the built-in model. Slower, noticeably better on long or subtle material.",
    requiresKey: "ANTHROPIC_API_KEY" as const,
  },
  transcribe: {
    label: "Tell speakers apart",
    detail: "Labels who is talking. Worth it for interviews and podcasts; unnecessary for a single-voice recording.",
    approxCostPer90Min: 0.47,
    defaultCostPer90Min: 0.046,
    requiresKey: null,
  },
} as const;
