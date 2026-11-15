/**
 * THE DEPLOY SAYING WHAT IT SWITCHED ON.
 *
 * MAIL_FROM was empty for a month. Nobody could sign in to aldershot.io,
 * including the owner, and the only way to find out was reading the tail of a
 * failed deploy's log by hand — because /api/preflight, the readiness report,
 * is owner-only, so reading it needs a session and getting a session needs the
 * sign-in it reports on.
 *
 * Two things have to hold for the fix to be worth having: it must never print
 * a value, and it must not disagree with the other reader of the same list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* createRequire rather than an import: the shared list is CommonJS so the
   deploy's plain-node readout and this CJS script can both read it, and
   there is no .d.ts for it. */
const { CAPABILITIES } = createRequire(import.meta.url)("../scripts/capabilities.cjs") as {
  CAPABILITIES: Array<{ key: string }>;
};

/** The readout, with a controlled environment and nothing inherited. */
function readout(env: Record<string, string> = {}) {
  return execFileSync("node", [join(ROOT, "scripts", "deploy-readout.mjs")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

/*
 * THE ONE THAT MATTERS. A script that echoes a key puts it in somebody's shell
 * history and in a CI log that outlives the key.
 *
 * Values shaped like the real things, each distinctive enough that a substring
 * search cannot miss it.
 */
test("it cannot print a value, whatever it is handed", () => {
  const secrets: Record<string, string> = {
    GOOGLE_CLIENT_ID: "zzz-client-id-SHOULDNEVERAPPEAR-1.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "GOCSPX-SHOULDNEVERAPPEAR-2",
    MAIL_FROM: "SHOULDNEVERAPPEAR3@aldershot.io",
    STRIPE_SECRET_KEY: "sk_live_SHOULDNEVERAPPEAR4",
    STRIPE_PRICE_ID: "price_SHOULDNEVERAPPEAR5",
    STRIPE_WEBHOOK_SECRET: "whsec_SHOULDNEVERAPPEAR6",
    R2_ACCESS_KEY_ID: "SHOULDNEVERAPPEAR7",
    R2_SECRET_ACCESS_KEY: "SHOULDNEVERAPPEAR8",
    R2_ACCOUNT_ID: "SHOULDNEVERAPPEAR9",
    ANTHROPIC_API_KEY: "sk-ant-SHOULDNEVERAPPEAR10",
  };
  /*
   * BOTH BRANCHES, WITH REAL VALUES IN THE ENVIRONMENT EITHER WAY.
   *
   * The first version of this test set every secret, so nothing was OFF and
   * the OFF branch never ran — and that is the branch where a leak is most
   * likely, because it is the one that talks about what is missing. Breaking
   * the readout to interpolate the values into its OFF lines did not fail the
   * test at all, which is how the hole was found. So: once with everything
   * set, and once with half of them set so the OFF lines render while the
   * other values are sitting right there in the environment.
   */
  const half = Object.fromEntries(Object.entries(secrets).filter((_, i) => i % 2 === 0));

  for (const [label, env] of [["all set", secrets], ["half set", half]] as const) {
    const out = readout(env);
    for (const [name, value] of Object.entries(secrets)) {
      assert.ok(!out.includes(value), `${label}: ${name}'s VALUE reached the output`);
    }
    /* And it printed something, so none of the above is vacuous. */
    assert.match(out, /What this deploy switched on/, `${label}: printed nothing`);
  }

  assert.match(readout(secrets), /All 8 are configured/);
  /* The half-set run must genuinely have taken the OFF path, or this whole
     test is still only checking the easy branch. */
  assert.match(readout(half), /^  OFF /m, "the half-set run produced no OFF line to leak into");
});

test("an absence is named, with what it costs", () => {
  const out = readout({});
  assert.match(out, /OFF Email sign-in — needs MAIL_FROM/);
  assert.match(out, /email delivery isn't configured/, "it named the gap without saying what it costs");
  assert.match(out, /OFF Google sign-in — needs GOOGLE_CLIENT_ID \+ GOOGLE_CLIENT_SECRET/);
  assert.match(out, /6 of 8 are off/);
});

/*
 * THE TWO THAT ARE NOT "OFF" JUST BECAUSE THE JOB CANNOT SEE THEM.
 *
 * SESSION_SECRET is written with `wrangler secret put` and is never in the
 * job's environment; APP_ORIGIN is committed in wrangler.jsonc's vars.
 * Reporting either as missing would be the readout being wrong about the one
 * subject it exists to be right about.
 */
test("what the job cannot see is not reported as missing", () => {
  const out = readout({});
  assert.match(out, /Session signing — the deploy sets this itself/);
  assert.match(out, /The public address — committed in wrangler\.jsonc/);
  assert.ok(!/OFF Session signing/.test(out), "it called a generated secret missing");
  assert.ok(!/OFF The public address/.test(out), "it called a committed var missing");
});

/*
 * THE TWO READERS AGREE, because they read one list — and the third place that
 * knows these names is src/index.ts's /api/preflight route, which checks
 * BINDINGS as well as variables and so cannot share the list. What it can do
 * is agree about the keys, which is what this pins: a capability added here
 * and not there would make preflight.cjs print a line the route never answers.
 */
test("every capability is a key the preflight route actually returns", () => {
  const route = readFileSync(join(ROOT, "src", "index.ts"), "utf8");
  const block = route.slice(route.indexOf("app_origin:") - 2000, route.indexOf("app_origin:") + 2000);
  for (const { key } of CAPABILITIES) {
    assert.ok(
      new RegExp(`\\b${key}\\s*:`).test(block),
      `${key} is in the shared list and /api/preflight never answers it`,
    );
  }
});

test("preflight.cjs reads the shared list rather than its own copy", () => {
  const src = readFileSync(join(ROOT, "scripts", "preflight.cjs"), "utf8");
  assert.match(src, /require\("\.\/capabilities\.cjs"\)/);
  assert.ok(!/key:\s*"sign_in_google"/.test(src), "preflight.cjs has its own copy of the list again");
});
