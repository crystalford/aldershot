/**
 * THE ENDPOINT WHOSE NATURAL SHAPE IS THE DANGEROUS ONE.
 *
 * /api/preflight answers "what is configured". The obvious way to write that
 * is to return the config, and the obvious way is wrong: it would put every
 * secret this product holds into a JSON response, and then into whatever
 * log, proxy or terminal scrollback the response passed through.
 *
 * So it returns BOOLEANS, and this is the test that keeps it that way. It
 * reads the source rather than driving the route, because the claim is about
 * what the code can emit at all — a route that merely happens to send
 * booleans today is not the same guarantee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts"), "utf8");

/** The handler's own body, which is what the claims below are about. */
function preflight(): string {
  const at = SRC.indexOf('app.get("/api/preflight"');
  assert.ok(at > 0, "the route exists");
  const after = SRC.slice(at);
  return after.slice(0, after.indexOf("\n});") + 4);
}

test("every value it reports is a boolean, never the thing itself", () => {
  const body = preflight();
  /*
   * Each key is `has(...)` or a conjunction of them, and `has` returns
   * Boolean(). A line that put `c.env.SOMETHING` into the object directly
   * would not match this and would be the leak.
   */
  const pairs = [...body.matchAll(/^\s{4}(\w+):\s*([\s\S]*?),\n/gm)];
  assert.ok(pairs.length >= 8, `found ${pairs.length} reported keys`);
  for (const [, key, value] of pairs) {
    assert.ok(
      /^has\(/.test(value.trim()) || /^\s*has\(/m.test(value),
      `${key} is reported through has(), not as a value`,
    );
    assert.ok(!/c\.env\.\w+\s*[,}]/.test(value), `${key} does not hand back c.env directly`);
  }
});

test("has() returns a boolean and nothing wider", () => {
  const body = preflight();
  assert.match(body, /const has = \(v: unknown\) => Boolean\(/, "Boolean(), so a non-empty string cannot escape as itself");
  /* And it trims, because "   " is not a configured secret. */
  assert.match(body, /v\.trim\(\)/);
});

test("it is owner-only", () => {
  /* What a deployment has configured is not a customer's business, and the
     absence of a key is a small map of where to push. */
  assert.match(preflight(), /if \(!user\.is_owner\) return c\.json\(\{ error: "not found" \}, 404\)/);
});

test("the names it reports are names, not values", () => {
  /*
   * The script prints these keys beside a human sentence; if a key were ever
   * renamed to carry a value — "stripe_key: sk_live_…" — this is where it
   * would show. Every reported key is snake_case and says what it enables.
   */
  const keys = [...preflight().matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  for (const k of keys) {
    assert.match(k, /^[a-z][a-z0-9_]*$/, `${k} is a name`);
    assert.ok(!/key|secret|token|password/.test(k) || k.endsWith("_secret"), `${k} does not look like a value`);
  }
});
