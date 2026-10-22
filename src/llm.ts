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

import type { Effort, Resolved } from "./models.ts";
import { usageTokens } from "./grounding.ts";

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
  /** What the prompt cache did, where the provider reports it. */
  cache: { read: number; written: number };
}

/**
 * How long a cached prefix lives.
 *
 * "5m" for anything a person is sitting in front of — an editing session is a
 * run of calls minutes apart, and the cache refreshes free on every hit. "1h"
 * for a Scout run or an overnight queue, where the gap between calls is
 * longer than five minutes and the write is worth paying twice for.
 */
export type CacheTtl = "5m" | "1h";

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
async function callAnthropic(
  key: string,
  model: string,
  call: ReasonCall,
  onUserKey: boolean,
  ttl: CacheTtl,
  effort?: Effort,
): Promise<{ raw: unknown; cache: { read: number; written: number } }> {
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
      /*
       * THE CACHE BREAKPOINT GOES ON THE SYSTEM BLOCK, which is the last
       * thing that is identical across calls. Everything after it — the
       * claim, the candidates, the window of transcript — changes every
       * time.
       *
       * Putting it on the varying content is the documented mistake and the
       * expensive one: a prefix hash that never matches writes a fresh entry
       * on every request and reads none of them, so it costs 25% MORE than
       * not caching at all while looking like an optimisation.
       *
       * This is invariant 5 one layer down. "Footage is read and charged
       * once; editing is free" has been true of transcription and false of
       * every model call over the same footage: re-cutting re-read the same
       * transcript at full price. A cached prefix is what makes the second
       * read cost a fraction of the first.
       */
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl } }],
      messages: [{ role: "user", content: call.user }],
      /*
       * HOW HARD TO THINK, named rather than defaulted.
       *
       * This was not sent at all, and the omission was not neutral: Opus 5.5
       * defaults to `medium`, one level below what its predecessor defaulted
       * to, so the judge that IS invariant 4 was running the best model in
       * the product at middling depth because nobody said otherwise. The
       * level per capability is in CAPABILITIES, with the reason beside it.
       *
       * Inside `output_config`, not top-level — a common mistake and a
       * silent one, since an unknown top-level key is simply ignored and the
       * call succeeds at the default. GA; no beta header.
       *
       * Omitted entirely when the resolved model carries no effort, so a
       * provider without the setting is not sent an empty object.
       */
      ...(effort ? { output_config: { effort } } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ModelCallFailed(blameFor(res.status, redact(body, key), onUserKey));
  }
  const raw = (await res.json()) as { usage?: Record<string, unknown> };
  const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    raw,
    cache: {
      read: n(raw?.usage?.cache_read_input_tokens),
      written: n(raw?.usage?.cache_creation_input_tokens),
    },
  };
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
  /** How long a cached prefix should live. See CacheTtl. */
  cacheTtl?: CacheTtl;
}

/**
 * Runs a resolved model, whoever is paying.
 *
 * The user's key wins over the platform's when the resolved provider is one
 * their key can speak to. A Workers AI model is ours by definition — there is
 * no user key for it — so a BYOK user still has the default tier on our bill,
 * which is what the $29 platform fee in doc 10 is for.
 */
/**
 * WHETHER THE ANSWER WAS CUT OFF, AS A MEASUREMENT.
 *
 * Neither provider reports a stop reason through `usageTokens`, and asking a
 * model whether it finished is trusting the thing that did not. Spending
 * every token offered is what truncation looks like from outside.
 *
 * `>=` and not `===`: a provider that counts the stop token differently by
 * one would make an equality check silently never fire, which is how a guard
 * becomes decoration.
 */
export function wasTruncated(tokensOut: number, maxTokens: number): boolean {
  return maxTokens > 0 && tokensOut >= maxTokens;
}

/**
 * SAY SO WHEN IT HAPPENS, from wherever it happens.
 *
 * This repo has now sized a token budget for the ANSWER three times and been
 * wrong three times, because the reasoning tier spends tokens thinking first
 * and `assistantText` throws the thinking away. A budget that fits the answer
 * cuts the model off mid-thought and the answer never arrives at all:
 *
 *   src/naming.ts     32 → every call came back at exactly 32
 *   src/judge.ts    2000 → two claims of nineteen lost, read as caution
 *   src/judge.ts    5300 → the hardest claim spends 4355 and fails under load
 *
 * None of the three announced itself. The first was found by reading token
 * counts by hand, the second by an eval set that happened to have controls,
 * the third by probing one claim. This is the line that makes the fourth one
 * announce itself, and it belongs here because `llm.ts` is the seam every
 * model call either goes through or should.
 *
 * It returns the verdict so a caller that can do something about it — the
 * judge re-asks with more room — does not need its own copy of the test.
 */
export function reportRoom(where: string, tokensOut: number, maxTokens: number): boolean {
  const truncated = wasTruncated(tokensOut, maxTokens);
  if (truncated) {
    console.warn(
      `[${where}] cut off: spent all ${maxTokens} output token(s), so the answer is ` +
        `incomplete and anything parsed from it is a guess. Raise the budget.`,
    );
  }
  return truncated;
}

/**
 * `env.AI.run`, with the room checked on the way out.
 *
 * MOST MODEL CALLS IN THIS REPO DO NOT GO THROUGH `callReason`. They were
 * written before it existed, each with its own `max_tokens` literal and its
 * own reason for the number, and none of them could tell you whether the
 * answer it parsed was a whole one. That is how the same bug reached
 * production three times.
 *
 * The budget stays where it was — inside the input object the caller already
 * builds — so there is no second copy of the number to drift from the first.
 * This reads it back out and checks it. A call site that wants the token
 * counts still takes them from `usageTokens`; this does not change what is
 * returned.
 */
export async function runRead(
  env: { AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> } },
  where: string,
  model: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const raw = await env.AI.run(model, input);
  const { tokensOut } = usageTokens(raw);
  reportRoom(where, tokensOut, Number(input.max_tokens ?? 0));
  return raw;
}

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

    const ttl = opts.cacheTtl ?? "5m";
    /*
     * A TEMPERATURE MUST NOT REACH THIS WIRE. Anthropic removed the sampling
     * parameters on every current model — Opus 5.5, Opus 5, Sonnet 5.5 and
     * the Fable line all answer a 400 — so one leaking through would take
     * the whole capability dark rather than degrade it. resolveFor does not
     * put one on an Anthropic result; this is the assertion that it never
     * starts to, because the failure would be total and the cause remote.
     */
    if (model.temperature !== undefined) {
      throw new ModelCallFailed({
        blame: "ours",
        says: "That model does not take a temperature.",
        retryable: false,
      });
    }
    try {
      const out = await callAnthropic(key, model.id, call, key === userKey, ttl, model.effort);
      return { ...out, model: model.id, provider: "anthropic", onUserKey: key === userKey };
    } catch (err) {
      const failed = err instanceof ModelCallFailed ? err : null;
      const canFallBack =
        failed !== null &&
        key === userKey &&
        platformKey !== null &&
        opts.billUsIfMyKeyFails === true &&
        failed.blame !== "ours";
      if (!canFallBack) throw err;
      const out = await callAnthropic(platformKey, model.id, call, false, ttl, model.effort);
      return { ...out, model: model.id, provider: "anthropic", onUserKey: false };
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
    /*
     * PINNED WHERE THE ANSWER IS A DECISION, and absent otherwise.
     *
     * Nothing in this product set a temperature, so every call ran at the
     * provider's default. The adversarial set measured what that cost: the
     * same model over the same 40 judgements returned 0.0% false support and
     * then 11.1% on two runs an hour apart. A judge that disagrees with
     * itself by more than a model swap would is a receipt that appears under
     * a claim today and is gone tomorrow.
     *
     * The level per capability is in CAPABILITIES with the reason beside it.
     * Only this branch sends it: see callAnthropic, which cannot.
     */
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
  });
  reportRoom(`callReason ${model.id}`, usageTokens(raw).tokensOut, call.maxTokens);
  /* Workers AI has no prompt cache to report on. Zeroes rather than nulls:
     "nothing was cached" is the true answer, not "we could not tell". */
  return { raw, model: model.id, provider: "workers-ai", onUserKey: false, cache: { read: 0, written: 0 } };
}
