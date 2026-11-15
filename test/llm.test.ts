/**
 * THE ONE PLACE A REASONING MODEL IS ACTUALLY CALLED.
 *
 * resolveModel has always returned a provider and every call site threw it
 * away, calling env.AI.run(model.id, …) regardless. So the Anthropic path was
 * a bug waiting on a config change: set ANTHROPIC_API_KEY and the judge would
 * have asked Workers AI for "claude-sonnet-5".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelCallFailed, blameFor, callReason, redact } from "../src/llm.ts";
import type { Resolved } from "../src/models.ts";

const CF: Resolved = { provider: "workers-ai", id: "@cf/zai-org/glm-5.3-flash", context: 1_048_576, jsonSchema: true, diarizes: false };
const CLAUDE: Resolved = { provider: "anthropic", id: "claude-sonnet-5", context: 200_000, jsonSchema: true, diarizes: false };
const CALL = { system: "s", user: "u", maxTokens: 100 };

/** An env whose AI binding records what it was asked for. */
function fakeEnv(over: { ANTHROPIC_API_KEY?: string } = {}) {
  const asked: string[] = [];
  return {
    asked,
    env: {
      AI: {
        run: async (model: string) => {
          asked.push(model);
          return { ok: true };
        },
      },
      ...over,
    },
  };
}

/** Replaces global fetch for one call, recording what it saw. */
async function withFetch<T>(
  reply: { status: number; body?: unknown },
  fn: (seen: Array<{ url: string; headers: Record<string, string>; body: string }>) => Promise<T>,
): Promise<T> {
  const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    });
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => reply.body ?? {},
      text: async () => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {})),
    };
  }) as never;
  try {
    return await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}

test("ACCEPTANCE: an Anthropic model is never handed to Workers AI", () => {
  /* The bug this file exists for. */
  const { env, asked } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200, body: { content: [] } }, async (seen) => {
    const out = await callReason(env as never, CLAUDE, CALL);
    assert.equal(asked.length, 0, "Workers AI was asked for an Anthropic model");
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /api\.anthropic\.com/);
    assert.equal(out.provider, "anthropic");
  });
});

test("and a Workers AI model never goes over the wire to Anthropic", () => {
  const { env, asked } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200 }, async (seen) => {
    const out = await callReason(env as never, CF, CALL);
    assert.deepEqual(asked, ["@cf/zai-org/glm-5.3-flash"]);
    assert.equal(seen.length, 0);
    assert.equal(out.onUserKey, false, "a @cf/ model cannot be paid for with somebody's Anthropic key");
  });
});

test("the user's key is used in preference to ours, and is marked as theirs", () => {
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200, body: {} }, async (seen) => {
    const out = await callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb" });
    assert.equal(seen[0].headers["x-api-key"], "sk-theirs-bbbbbbbb");
    assert.equal(out.onUserKey, true);
  });
});

test("ACCEPTANCE: a key over its limit says so, and nothing falls to our bill", () => {
  /*
   * doc 10: "a failing key never falls back to our bill without opt-in", and
   * Phase 8 accepts on the sentence itself. The default is no fallback and it
   * is never inferred — a fallback nobody asked for is a bill nobody agreed
   * to, arriving in the one situation where the person believed they were
   * paying for it themselves.
   */
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 429, body: "rate_limit_error" }, async (seen) => {
    await assert.rejects(
      () => callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb" }),
      (err: ModelCallFailed) => {
        assert.equal(err.blame, "user_key_limit");
        assert.match(err.message, /Your key hit its limit/);
        assert.match(err.message, /Nothing was charged to us/);
        return true;
      },
    );
    assert.equal(seen.length, 1, "it retried on our key without being asked");
  });
});

test("it falls back only when the person opted in, and never for our own bug", () => {
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 429 }, async (seen) => {
    /* Opted in: tried theirs, then ours. */
    await callReason(env as never, CLAUDE, CALL, {
      userKey: "sk-theirs-bbbbbbbb",
      billUsIfMyKeyFails: true,
    }).catch(() => undefined);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["x-api-key"], "sk-theirs-bbbbbbbb");
    assert.equal(seen[1].headers["x-api-key"], "sk-platform-aaaaaaaa");
  }).then(() =>
    /* A 400 is the request WE built. Paying for our own bug on their
       behalf — or ours, twice — helps nobody. */
    withFetch({ status: 400, body: "bad_request" }, async (seen) => {
      await assert.rejects(() =>
        callReason(env as never, CLAUDE, CALL, {
          userKey: "sk-theirs-bbbbbbbb",
          billUsIfMyKeyFails: true,
        }),
      );
      assert.equal(seen.length, 1, "our own bad request was retried on our bill");
    }),
  );
});

test("the three sentences are three sentences", () => {
  /*
   * doc 10: "the provider's overload, your key's limit and our failure are
   * three different sentences." They need three different things from the
   * reader: wait, go and look at your account, we are on it.
   */
  const limit = blameFor(429, "", true);
  const busy = blameFor(429, "", false);
  const overloaded = blameFor(529, "", true);
  const ours = blameFor(400, "", true);

  assert.equal(limit.blame, "user_key_limit");
  assert.equal(busy.blame, "provider_busy");
  assert.equal(overloaded.blame, "provider_busy");
  assert.equal(ours.blame, "ours");
  assert.equal(new Set([limit.says, busy.says, ours.says]).size, 3);

  /* And a 429 on OUR key is the provider rate-limiting us, not somebody's
     account limit — sending them to look at an account they do not have. */
  assert.doesNotMatch(busy.says, /your key/i);
});

test("a refused key is the person's to fix; a refused platform key is ours", () => {
  assert.equal(blameFor(401, "", true).blame, "user_key_bad");
  assert.equal(blameFor(401, "", false).blame, "ours");
  assert.equal(blameFor(403, "", true).retryable, false, "retrying a refused key just refuses again");
});

test("ACCEPTANCE: a key never survives into anything anybody reads", () => {
  /*
   * Providers echo request details back in error bodies, and an error body
   * goes into a job row somebody reads. doc 10: "never logged, last four
   * characters shown."
   */
  const key = "sk-ant-secret-value-12345";
  assert.equal(redact(`oops ${key} oops`, key), "oops [key] oops");
  assert.equal(redact("nothing here", key), "nothing here");
  /* A short or empty key is not used as a search term, or every error body
     containing "a" would be shredded. */
  assert.equal(redact("aaa", ""), "aaa");
  assert.equal(redact("aaa", "a"), "aaa");
});

test("the key reaches the provider in a header and nowhere else", () => {
  const { env } = fakeEnv();
  return withFetch({ status: 200 }, async (seen) => {
    await callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb" });
    assert.equal(seen[0].headers["x-api-key"], "sk-theirs-bbbbbbbb");
    assert.doesNotMatch(seen[0].url, /sk-theirs/, "the key is in the url");
    assert.doesNotMatch(seen[0].body, /sk-theirs/, "the key is in the body");
  });
});

test("no key at all is our failure, not the provider's", () => {
  const { env } = fakeEnv();
  return assert.rejects(
    () => callReason(env as never, CLAUDE, CALL),
    (err: ModelCallFailed) => err.blame === "ours",
  );
});

/* ── The prompt cache ────────────────────────────────────────────────────── */

test("ACCEPTANCE: the breakpoint is on the system block, not on what varies", () => {
  /*
   * THE DOCUMENTED AND EXPENSIVE MISTAKE. A breakpoint on content that
   * changes every request produces a prefix hash that never matches: a fresh
   * cache entry is written every time and none is ever read, which costs 25%
   * MORE than not caching while looking like an optimisation.
   *
   * The system prompt is the last thing identical across calls. The claim,
   * the candidates and the window of transcript are not.
   */
  const { env } = fakeEnv();
  return withFetch({ status: 200, body: {} }, async (seen) => {
    await callReason(env as never, CLAUDE, { system: "stable", user: "varies", maxTokens: 100 }, {
      userKey: "sk-theirs-bbbbbbbb",
    });
    const body = JSON.parse(seen[0].body) as {
      system: Array<{ text: string; cache_control?: unknown }>;
      messages: Array<{ content: unknown; cache_control?: unknown }>;
    };
    assert.equal(body.system[0].text, "stable");
    assert.deepEqual(body.system[0].cache_control, { type: "ephemeral", ttl: "5m" });
    assert.equal(body.messages[0].cache_control, undefined, "the breakpoint is on the varying message");
  });
});

test("the schema is inside the cached prefix, because it never changes either", () => {
  /* A closed schema is a constant. Leaving it out of the cached block would
     re-send it on every call for no reason. */
  const { env } = fakeEnv();
  return withFetch({ status: 200, body: {} }, async (seen) => {
    await callReason(
      env as never,
      CLAUDE,
      { system: "stable", user: "varies", maxTokens: 100, schema: { type: "object" } },
      { userKey: "sk-theirs-bbbbbbbb" },
    );
    const body = JSON.parse(seen[0].body) as { system: Array<{ text: string; cache_control?: unknown }> };
    assert.match(body.system[0].text, /"type":"object"/);
    assert.ok(body.system[0].cache_control, "the schema landed outside the cached block");
  });
});

test("an hour is available for the runs that need it", () => {
  /* Five minutes suits an editing session, where calls are minutes apart and
     a hit refreshes the entry free. A Scout run is longer than that. */
  const { env } = fakeEnv();
  return withFetch({ status: 200, body: {} }, async (seen) => {
    await callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb", cacheTtl: "1h" });
    const body = JSON.parse(seen[0].body) as { system: Array<{ cache_control: { ttl: string } }> };
    assert.equal(body.system[0].cache_control.ttl, "1h");
  });
});

test("what the cache did comes back, so the ledger can know", () => {
  /*
   * A cached read costs a fraction of a fresh one. Metering that does not
   * know the difference overstates spend — and the spend cap built on that
   * ledger would stop somebody working over money they never spent.
   */
  const { env } = fakeEnv();
  return withFetch(
    { status: 200, body: { usage: { cache_read_input_tokens: 4096, cache_creation_input_tokens: 0 } } },
    async () => {
      const out = await callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb" });
      assert.deepEqual(out.cache, { read: 4096, written: 0 });
    },
  );
});

test("a provider that reports nothing reports zero, not nothing", () => {
  /* Workers AI has no prompt cache. "Nothing was cached" is the true answer;
     a null would make every caller handle a case that cannot happen. */
  const { env } = fakeEnv();
  return withFetch({ status: 200 }, async () => {
    const cf = await callReason(env as never, CF, CALL);
    assert.deepEqual(cf.cache, { read: 0, written: 0 });
  }).then(() =>
    withFetch({ status: 200, body: {} }, async () => {
      const none = await callReason(env as never, CLAUDE, CALL, { userKey: "sk-theirs-bbbbbbbb" });
      assert.deepEqual(none.cache, { read: 0, written: 0 }, "a missing usage block became NaN");
    }),
  );
});

/*
 * ── Effort ──────────────────────────────────────────────────────────────
 *
 * `output_config.effort` was not being sent at all, and the omission was
 * not neutral: Opus 5.5 defaults to `medium`, one level below what its
 * predecessor defaulted to, so the judge that IS invariant 4 ran the best
 * model in the product at middling depth because nobody named a level.
 */

test("ACCEPTANCE: effort goes INSIDE output_config, where it is read", () => {
  /*
   * THE WHOLE TEST. An unknown TOP-LEVEL key is ignored by the API and the
   * call succeeds at the default, so sending `effort` in the wrong place
   * looks exactly like sending it in the right one — a 200, a good answer,
   * and a setting nobody applied. Nothing but the request body can tell
   * those apart.
   */
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200, body: { content: [] } }, async (seen) => {
    await callReason(env as never, { ...CLAUDE, effort: "xhigh" }, CALL);
    const body = JSON.parse(seen[0].body) as Record<string, unknown>;
    assert.deepEqual(body.output_config, { effort: "xhigh" });
    assert.ok(!("effort" in body), "a top-level effort is silently ignored by the API");
  });
});

test("a model with no effort sends no output_config at all", () => {
  /* Workers AI has no such setting. An empty object would be a parameter
     nobody applies that everybody can see in the request. */
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200, body: { content: [] } }, async (seen) => {
    await callReason(env as never, CLAUDE, CALL);
    const body = JSON.parse(seen[0].body) as Record<string, unknown>;
    assert.ok(!("output_config" in body), `sent ${JSON.stringify(body.output_config)}`);
  });
});

test("the effort survives the fall back from a user's key to ours", () => {
  /*
   * The fallback re-sends the request on the platform key. Dropping the
   * effort there would mean a call that fell back was quietly shallower
   * than the same call that did not — the kind of difference that shows up
   * as "the judge is worse for some users" and has no visible cause.
   */
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 429, body: { error: "slow down" } }, async (seen) => {
    await callReason(
      env as never,
      { ...CLAUDE, effort: "max" },
      CALL,
      { userKey: "sk-user-bbbbbbbb", billUsIfMyKeyFails: true },
    ).catch(() => undefined);
    assert.equal(seen.length, 2, "the user's key failed and ours was not tried");
    for (const [i, call] of seen.entries()) {
      const body = JSON.parse(call.body) as Record<string, unknown>;
      assert.deepEqual(body.output_config, { effort: "max" }, `call ${i + 1} lost the effort`);
    }
  });
});

/*
 * ── Temperature ─────────────────────────────────────────────────────────
 *
 * Nothing in this product set one, so every call ran at the provider's
 * default. The adversarial set measured the cost: the same model over the
 * same 40 judgements returned 0.0% false support and then 11.1% on two runs
 * an hour apart. A judge that disagrees with itself by more than a model
 * swap would is a receipt that appears under a claim today and is gone
 * tomorrow — invariant 4 failing in the direction nobody checks.
 */

test("ACCEPTANCE: a pinned capability sends its temperature to Workers AI", () => {
  const { env, asked } = fakeEnv();
  const input: Array<Record<string, unknown>> = [];
  (env.AI as { run: unknown }).run = async (_m: string, i: Record<string, unknown>) => {
    input.push(i);
    return { response: "{}" };
  };
  return (async () => {
    await callReason(env as never, { ...CF, temperature: 0 }, CALL);
    assert.equal(input.length, 1);
    assert.equal(input[0].temperature, 0);
    void asked;
  })();
});

test("a capability with no temperature sends no temperature", () => {
  /* Absent, not zero. A prose capability pinned to zero by accident is a
     silent quality change, and `0` is a value the provider would honour. */
  const { env } = fakeEnv();
  const input: Array<Record<string, unknown>> = [];
  (env.AI as { run: unknown }).run = async (_m: string, i: Record<string, unknown>) => {
    input.push(i);
    return { response: "{}" };
  };
  return (async () => {
    await callReason(env as never, CF, CALL);
    assert.ok(!("temperature" in input[0]), `sent ${JSON.stringify(input[0].temperature)}`);
  })();
});

test("ACCEPTANCE: a temperature never reaches Anthropic, which 400s on it", () => {
  /*
   * Opus 5.5, Opus 5, Sonnet 5.5 and the Fable line all reject the sampling
   * parameters. A leak would not degrade the capability, it would take it
   * dark — so this fails loudly on our side rather than remotely.
   */
  const { env } = fakeEnv({ ANTHROPIC_API_KEY: "sk-platform-aaaaaaaa" });
  return withFetch({ status: 200, body: { content: [] } }, async (seen) => {
    await assert.rejects(
      () => callReason(env as never, { ...CLAUDE, temperature: 0 }, CALL),
      /does not take a temperature/,
    );
    assert.equal(seen.length, 0, "the request went out anyway");
  });
});
