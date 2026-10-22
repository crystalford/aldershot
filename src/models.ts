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
/* ── The Anthropic models, newest family ────────────────────────────────── */

/**
 * The most capable model available, for the work the product rests on.
 *
 * `claude-sonnet-5` was named here and is a family behind. That mattered less
 * when nothing could call it — src/llm.ts is the first thing in this codebase
 * that actually can.
 */
export const ANTHROPIC_BEST = "claude-opus-5-5";

/*
 * THERE IS NO MIDDLE ANTHROPIC TIER HERE, and one was written and deleted.
 *
 * Sonnet 5.5 would be the obvious "good enough for the less critical calls"
 * option, and nothing in this file wants it: load-bearing work takes the best
 * there is, long-context work stays on the 1M-window model for reasons that
 * are about the window rather than the power, and the one latency-sensitive
 * call wants the fastest thing available. A third constant with no caller is
 * a decision nobody has made yet, sitting where it looks like one somebody
 * did.
 */

/** Kept as the name the rest of the code used before capabilities existed. */
export const ANTHROPIC_REASON = ANTHROPIC_BEST;

/* ── What a call is FOR, which is what decides the model ─────────────────── */

/**
 * CAPABILITIES, NOT TIERS.
 *
 * There was one reasoning role and a binary tier, so every reasoning call in
 * the product shared one model and the only question was "better or not".
 * That was the right shape when the product cut blocks and asked a model to
 * score them. It is the wrong shape now: the reasoning layer IS the editing,
 * and the calls in it do not resemble each other.
 *
 * Deciding whether a clip backs a claim is invariant 4 — a wrong answer is a
 * receipt that lies, on a page published to strangers. Naming a project is a
 * title. Treating those as one decision means either overpaying for titles or
 * underpowering the thing the product's honesty rests on, and for a long time
 * it was the second.
 *
 * `loadBearing` is the word that decides. It does not mean important; it
 * means an invariant depends on the answer being right.
 */
export type Capability = "judge" | "classify" | "direct" | "read" | "name" | "arrange";

/**
 * HOW HARD THE MODEL THINKS, which is a second axis and was not being used.
 *
 * `output_config.effort` is a per-request setting on Claude, GA and needing
 * no beta header, and the Anthropic branch of callReason was not sending it
 * at all. That is not a neutral omission: Opus 5.5 defaults to `medium`,
 * one level BELOW the `high` its predecessor defaulted to, so every
 * load-bearing call in this product — the judge that IS invariant 4, the
 * classifier invariant 8 rests on, the director that decides what the video
 * says — has been running the frontier model at middling depth because
 * nobody named a level.
 *
 * AND IT IS THE CHEAPER AXIS TO ROUTE ON. A second model means a second
 * prompt cache: caches are model-scoped, so a cascade across two models
 * forfeits every cached prefix the other one built. Effort moves the depth
 * without moving the namespace. Anthropic's own guidance is to measure the
 * best model at lower effort BEFORE building a multi-model cascade, and this
 * is what makes that measurable here.
 *
 * Anthropic only — Workers AI has no equivalent, so a resolved Workers AI
 * model carries no effort and the field is absent rather than defaulted.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface CapabilitySpec {
  /** Why this one gets what it gets. Read by nothing; read by people. */
  why: string;
  /** An invariant depends on this answer being right. */
  loadBearing: boolean;
  /**
   * Needs the whole transcript in one window.
   *
   * A QUALITY argument, not a cost one. A 1M-token window reads a two-hour
   * transcript in one piece; a 200k window reads it in chunks and cannot see
   * across the joins. For "which moments carry this subject", the model that
   * sees all of it at once is doing the better job even when it is the
   * smaller model.
   */
  longContext: boolean;
  /**
   * The depth this capability is worth, from the published ladder: a minimum
   * of `high` for intelligence-sensitive work, `max` only where correctness
   * matters more than cost AND measurement shows headroom at the level
   * below, `low` for simple or latency-bound calls.
   *
   * NOT MEASURED YET, and the honest reason is that the only capability with
   * an eval set is `judge`, whose set is currently saturated — it cannot
   * tell two efforts apart any more than it can tell two models apart. So
   * these come from the ladder and the invariant each capability carries,
   * they are recorded here rather than buried in a call site, and
   * `npm run eval:model -- --effort` is what will turn them into numbers.
   */
  effort: Effort;
  /**
   * HOW MUCH THE ANSWER MAY WANDER, and nothing here was setting it.
   *
   * Every model call in this product ran at the provider's default sampling
   * temperature, which is not zero. So the judge was nondeterministic, and
   * the adversarial set caught it: the SAME model over the SAME 40
   * judgements, twice in one evening, returned 0.0% false support and then
   * 11.1%. Not two models differing. One model disagreeing with itself by
   * more than any swap would need to show.
   *
   * That is two problems and the eval is the smaller one. A verdict that
   * flickers is a receipt that sits under a claim today and is gone
   * tomorrow — invariant 4 failing in the direction nobody checks, because
   * "every claim keeps its receipt" means it keeps the same one.
   *
   * A CAPABILITY WHOSE ANSWER IS A DECISION GETS ZERO. judge, classify and
   * arrange return a choice from a fixed set and there is no reading of
   * "creative" that applies to them. `direct` and `name` write prose, where
   * sampling is the point, and `read` has no eval set to justify a change.
   *
   * WORKERS AI ONLY, and null means "do not send it". Anthropic removed the
   * sampling parameters on the current models — Opus 5.5, Opus 5, Sonnet
   * 5.5 and the Fable line all 400 on `temperature` — so a Claude judge
   * cannot be pinned this way and its variance has to be handled by running
   * the set more than once instead. src/llm.ts refuses to put it on that
   * wire at all.
   */
  temperature: number | null;
}

export const CAPABILITIES: Record<Capability, CapabilitySpec> = {
  judge: {
    why: "Decides whether a clip backs a claim. Invariant 4 — a wrong answer is a receipt that lies.",
    loadBearing: true,
    longContext: false,
    /* The deepest setting any capability gets. A receipt that lies is the
       worst thing this product can do, and the near-miss separation it is
       asked for is the hardest reading in it. */
    effort: "xhigh",
    /* A receipt that changes its mind between two runs is worse than no
       receipt, and this answer IS invariant 4. */
    temperature: 0,
  },
  classify: {
    why: "Decides what job a line's picture has, which decides whether a generated picture may sit over a claim. Invariant 8.",
    loadBearing: true,
    longContext: false,
    /* Load-bearing, but it is a small question over a fixed set of answers
       rather than a reading. `high` is the floor for anything an invariant
       rests on; the depth above that buys nothing on a choice this narrow. */
    effort: "high",
    /* Five fixed kinds, and invariant 8 turns on which one comes back. */
    temperature: 0,
  },
  direct: {
    why: "Decides what the video says: the claim, the beats, the order. Wrong here and the cut argues something nobody meant.",
    loadBearing: true,
    longContext: false,
    /* Open-ended and consequential: there is no schema that catches a claim
       nobody meant, only a person reading it afterwards. */
    effort: "xhigh",
    /* Prose, and the one capability where a second opinion is worth having:
       a claim and its beats are a draft a person then edits. */
    temperature: null,
  },
  read: {
    why: "Reads a whole transcript and says which moments carry the subject. Wants the whole thing in one window more than it wants raw power.",
    loadBearing: false,
    longContext: true,
    /* Never reaches Anthropic — longContext pins it to the 1M-window Workers
       AI model — so this is the value it WOULD take, recorded rather than
       left to look like an oversight. Reading a transcript for subject is
       breadth, not depth. */
    effort: "medium",
    /* Which moments carry the subject is a judgement over a long transcript
       rather than a fixed choice. Left at the provider's default until
       something measures it — there is no eval set for `read`. */
    temperature: null,
  },
  arrange: {
    why: "Puts kept moments in an order. A deterministic solver places; this only suggests.",
    loadBearing: false,
    longContext: false,
    /* Invariant 2: it suggests and a solver places, and permutationOf
       repairs whatever comes back. Depth here is paid for an answer that is
       then validated anyway. */
    effort: "low",
    /* An order is a decision. permutationOf repairs it either way, but a cut
       that arranges itself differently on two identical runs is a cut nobody
       can reason about — invariant 1 says it is re-produced from rules. */
    temperature: 0,
  },
  name: {
    why: "Titles and short labels, with somebody waiting on the result. Latency is the quality that matters here.",
    loadBearing: false,
    longContext: false,
    /* Effort costs time, and a better title two seconds later is a worse
       product. The one place where the lowest setting is the RIGHT one
       rather than the cheap one. */
    effort: "low",
    /* A title is prose, written once and then stored. */
    temperature: null,
  },
};

/**
 * The model for a capability.
 *
 * Load-bearing work gets the best model there is, and falls back to the best
 * available WITHOUT a key rather than to the cheap default — the point of the
 * fallback is to stay as close to the intended quality as the configuration
 * allows, not to quietly become something else.
 *
 * Long-context work stays on the 1M-window model on purpose, which is the one
 * place in here where the biggest model is not the best choice. See
 * `longContext` above.
 */
export function resolveFor(cap: Capability, env: { ANTHROPIC_API_KEY?: string }): Resolved {
  const spec = CAPABILITIES[cap];

  if (spec.longContext) {
    return { provider: "workers-ai", id: REASON_UPGRADE.id, context: REASON_UPGRADE.context, jsonSchema: true, diarizes: false, ...temp(spec) };
  }

  if (spec.loadBearing) {
    if (env.ANTHROPIC_API_KEY) {
      /*
       * NO TEMPERATURE ON THIS BRANCH, however much the capability wants
       * one. Opus 5.5, Opus 5, Sonnet 5.5 and the Fable line all return a
       * 400 for `temperature`, so pinning a Claude judge is not available
       * and its run-to-run variance has to be measured rather than removed.
       * See eval/README.md.
       */
      return {
        provider: "anthropic",
        id: ANTHROPIC_BEST,
        context: 200_000,
        jsonSchema: true,
        diarizes: false,
        effort: spec.effort,
      };
    }
    return { provider: "workers-ai", id: REASON_UPGRADE.id, context: REASON_UPGRADE.context, jsonSchema: true, diarizes: false, ...temp(spec) };
  }

  if (cap === "name") {
    /* Fast on purpose. Somebody is watching a box where a title should
       appear, and a better title two seconds later is a worse product.

       NOT REVISITED, AND IT SHOULD BE. This stays on Workers AI even when a
       key exists, which was the right call when the Anthropic branch meant
       the frontier tier. Haiku 5.5 is $0.10/$0.50 per million with a 1M
       window — cheaper per token than most of the Workers AI catalog and
       built for exactly this — so the latency argument above is now the
       only thing holding the choice, and nobody has timed the two. There is
       no eval set for `name`, which is why this is a comment and not a
       change: the one lesson of the judge is that an unmeasured swap is a
       guess with a changelog entry. */
    return { provider: "workers-ai", id: REASON.id, context: REASON.context, jsonSchema: true, diarizes: false, ...temp(spec) };
  }

  return { provider: "workers-ai", id: REASON_UPGRADE.id, context: REASON_UPGRADE.context, jsonSchema: true, diarizes: false, ...temp(spec) };
}

/** The capability's temperature, or nothing at all when it has none. */
const temp = (spec: CapabilitySpec) => (spec.temperature === null ? {} : { temperature: spec.temperature });

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
  /**
   * How hard to think, where the provider has a setting for it.
   *
   * ABSENT ON WORKERS AI, not defaulted: there is no equivalent parameter
   * there, and a field carrying "medium" into a provider that cannot read it
   * would be a setting nobody applies that everybody can see.
   */
  effort?: Effort;
  /**
   * Sampling temperature, where the provider accepts one.
   *
   * ABSENT RATHER THAN DEFAULTED, and absent for two different reasons:
   * a capability that writes prose does not want it pinned, and Anthropic
   * rejects the parameter outright on every current model. Either way the
   * field is missing and src/llm.ts sends nothing.
   */
  temperature?: number;
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
