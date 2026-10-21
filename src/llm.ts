/**
 * THE ONE PLACE A REASONING MODEL IS ACTUALLY CALLED.
 *
 * CLAUDE.md: "Every model call sits behind a typed capability contract
 * (Transcribe, Locate, Judge, Direct, …), is tagged with its model version,
 * and is gated by the eval set before a model swap." resolveModel() has
 * always returned the contract — provider, id, context, whether it does
 * structured output — and then every one of the eight call sites threw the
 * provider away and called `env.AI.run(model.id, …)` directly.
 *
 * WHICH MADE THE ANTHROPIC PATH A BUG WAITING ON A CONFIG CHANGE. Set
 * ANTHROPIC_API_KEY and resolveModel starts returning
 * { provider: "anthropic", id: "claude-sonnet-5" } — and judge(), classify()
 * and every upgrade-tier pass would hand that straight to Workers AI, which
 * has never heard of it. The upgrade tier this product offers in its own UI
 * could not be bought, and the day somebody set the key it would not have
 * started working; it would have started failing.
 *
 * So the provider is now impossible to ignore: a resolved model goes into
 * this function and an answer comes out, and nothing outside here knows how
 * either provider is spoken to.
 */

import type { Resolved } from "./models.ts";

/** What a reasoning call asks for. Deliberately small and provider-neutral. */
export interface ReasonCall {
  system: string;
  user: string;
  maxTokens: number;
  /**
   * The json_schema the caller already holds, passed straight through.
   *
   * Shaped as Workers AI wants it because that is what every call site
   * already has; the Anthropic path puts it in the system prompt instead,
   * since the two providers do not share a parameter for this.
   */
  schema?: Record<string, unknown>;
}

export interface ReasonResult {
  /** The raw provider response, parsed by the caller as it always was. */
  raw: unknown;
  model: string;
  provider: Resolved["provider"];
  /** True when the user's own key paid for this call. */
  onUserKey: boolean;
}

/* ── Whose fault was it ─────────────────────────────────────────────────── */

/**
 * Doc 10: "Blame attribution is a copy rule: the provider's overload, your
 * key's limit and our failure are three different sentences."
 *
 * Three, because they need three different things from the person reading
 * them. The provider being busy is "wait"; your key's limit is "go and look
 * at your account"; our failure is "we are on it". Collapsing them into "the
 * model is unavailable" sends somebody to the wrong place every time.
 */
export type Blame = "provider_busy" | "user_key_limit" | "user_key_bad" | "ours";

export interface Failure {
  blame: Blame;
  says: string;
  /** Whether trying the same call again could plausibly work. */
  retryable: boolean;
}

export function blameFor(status: number, body: string, onUserKey: boolean): Failure {
  /*
   * 429 ON THE USER'S KEY IS NOT THE PROVIDER BEING BUSY. It is their
   * account's limit, and it is the one case where the person can actually do
   * something — raise the limit, wait for the window, or let us bill it.
   * Phase 8 accepts on exactly this sentence.
   */
  if (status === 429) {
    return onUserKey
      ? {
          blame: "user_key_limit",
          says: "Your key hit its limit. Nothing was charged to us, and nothing has run. Wait for your provider's window to reset, or raise the limit on your account.",
          retryable: true,
        }
      : {
          blame: "provider_busy",
          says: "The model provider is rate-limiting us right now. Nothing has run; this will be retried.",
          retryable: true,
        };
  }

  if (status === 401 || status === 403) {
    return onUserKey
      ? {
          blame: "user_key_bad",
          says: "Your key was refused by the provider. Check it is still valid and has access to this model.",
          retryable: false,
        }
      : { blame: "ours", says: "Our model access was refused. This is ours to fix.", retryable: false };
  }

  /* 529 is Anthropic's overloaded; 5xx generally is the provider having a
     bad time rather than anything about the request. */
  if (status === 529 || status >= 500) {
    return {
      blame: "provider_busy",
      says: "The model provider is overloaded. Nothing has run; this will be retried.",
      retryable: true,
    };
  }

  /* A 400 is the request we built, whoever's key paid for it. */
  return {
    blame: "ours",
    says: `Something went wrong on our side${body ? `: ${body.slice(0, 140)}` : ""}.`,
    retryable: false,
  };
}

export class ModelCallFailed extends Error {
  readonly blame: Blame;
  readonly retryable: boolean;
  constructor(f: Failure) {
    super(f.says);
    this.name = "ModelCallFailed";
    this.blame = f.blame;
    this.retryable = f.retryable;
  }
}

/* ── Calling them ───────────────────────────────────────────────────────── */

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic's Messages API.
 *
 * Structured output is asked for in the prompt rather than through a
 * response_format parameter, because the two providers do not share one —
 * and the callers already parse defensively, since a model that returns
 * something unparseable is a case this product has always had to handle.
 */
async function callAnthropic(key: string, model: string, call: ReasonCall, onUserKey: boolean): Promise<unknown> {
  const system = call.schema
    ? `${call.system}\n\nReply with JSON only, matching this schema exactly:\n${JSON.stringify(call.schema)}`
    : call.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      /* The key goes in a header and nowhere else. It is never put in a url,
         never logged, and never included in an error — see redact(). */
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: call.maxTokens,
      system,
      messages: [{ role: "user", content: call.user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ModelCallFailed(blameFor(res.status, redact(body, key), onUserKey));
  }
  return res.json();
}

/**
 * A key must never survive into anything that gets stored or printed.
 *
 * Providers do echo request details back in error bodies, and an error body
 * goes into a job row that a person reads. One replace, at the only boundary
 * where a body and a key are in the same function.
 */
export function redact(text: string, key: string): string {
  if (!key || key.length < 8) return text;
  return text.split(key).join("[key]");
}

export interface CallOptions {
  /** The user's own key, where they have one. */
  userKey?: string | null;
  /**
   * Whether a failing user key may be retried on the platform's key.
   *
   * doc 10: "A failing key NEVER falls back to our bill without opt-in."
   * False by default and never inferred — a fallback nobody asked for is a
   * bill nobody agreed to, arriving in the one situation where the person
   * believed they were paying for it themselves.
   */
  billUsIfMyKeyFails?: boolean;
}

/**
 * Runs a resolved model, whoever is paying.
 *
 * The user's key wins over the platform's when the resolved provider is one
 * their key can speak to. A Workers AI model is ours by definition — there is
 * no user key for it — so a BYOK user still has the default tier on our bill,
 * which is what the $29 platform fee in doc 10 is for.
 */
export async function callReason(
  env: { AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> }; ANTHROPIC_API_KEY?: string },
  model: Resolved,
  call: ReasonCall,
  opts: CallOptions = {},
): Promise<ReasonResult> {
  if (model.provider === "anthropic") {
    const userKey = opts.userKey?.trim() || null;
    const platformKey = env.ANTHROPIC_API_KEY?.trim() || null;
    const key = userKey ?? platformKey;
    if (!key) {
      /* resolveModel only returns anthropic when a key exists, so this is a
         key that vanished between the two calls rather than a normal path. */
      throw new ModelCallFailed({
        blame: "ours",
        says: "There is no key for that model any more.",
        retryable: false,
      });
    }

    try {
      return { raw: await callAnthropic(key, model.id, call, key === userKey), model: model.id, provider: "anthropic", onUserKey: key === userKey };
    } catch (err) {
      const failed = err instanceof ModelCallFailed ? err : null;
      const canFallBack =
        failed !== null &&
        key === userKey &&
        platformKey !== null &&
        opts.billUsIfMyKeyFails === true &&
        failed.blame !== "ours";
      if (!canFallBack) throw err;
      return { raw: await callAnthropic(platformKey, model.id, call, false), model: model.id, provider: "anthropic", onUserKey: false };
    }
  }

  /* Workers AI. The id is ours, the bill is ours, and there is no key to
     carry — a user's Anthropic key cannot pay for a @cf/ model. */
  const raw = await env.AI.run(model.id, {
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
    ...(call.schema ? { response_format: { type: "json_schema", json_schema: call.schema } } : {}),
    max_tokens: call.maxTokens,
  });
  return { raw, model: model.id, provider: "workers-ai", onUserKey: false };
}
