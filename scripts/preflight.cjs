#!/usr/bin/env node
/**
 * WHAT IS CONFIGURED, AND WHAT EACH MISSING THING COSTS YOU.
 *
 *   node scripts/preflight.cjs                 → against localhost:8787
 *   BASE=https://your.site node scripts/preflight.cjs
 *
 * docs/LAUNCH.md is a list of things to set up. This is the other half: it
 * asks the running deployment what it actually has, so the answer comes from
 * the thing being launched rather than from a tick in a document.
 *
 * IT NEVER PRINTS A SECRET, and it cannot: the only thing it reads is
 * /api/preflight, which answers with a boolean per name. A script that
 * echoed a key to a terminal would be a script that put one in somebody's
 * shell history, and the question here is only ever "is it there".
 *
 * EVERY LINE SAYS WHAT THE ABSENCE DOES. "GOOGLE_CLIENT_ID: missing" is a
 * fact nobody can act on; "nobody can sign in with Google — the button is not
 * rendered at all" is the same fact and a decision. The product already
 * refuses honestly when these are absent, so the point is to know WHICH
 * refusal a stranger is going to meet.
 */
const BASE = process.env.BASE || "http://localhost:8787";

/*
 * THE LIST LIVES IN scripts/capabilities.cjs.
 *
 * It was declared here, and scripts/deploy-readout.mjs needed the same eight
 * names, the same prose and the same ordering. Two copies of a readiness list
 * drift, and then one of them is lying about what is switched on with nothing
 * to say which. The shared file carries the environment variable names too,
 * which this script does not need — it asks the running deployment instead of
 * reading its own environment, and that is the whole difference between them.
 */
const { CAPABILITIES: WANTED } = require("./capabilities.cjs");

(async () => {
  let got;
  try {
    const res = await fetch(BASE + "/api/preflight");
    if (!res.ok) {
      console.log(`✘ ${BASE}/api/preflight answered ${res.status}.`);
      console.log("   Owner-only: sign in as the owner account, or run it against a local dev server.");
      process.exit(1);
    }
    got = await res.json();
  } catch {
    console.log(`✘ nothing answered at ${BASE}.`);
    console.log("   Local: npx wrangler dev --local --port 8787 --enable-containers=false");
    process.exit(1);
  }

  console.log(`\n  ${BASE}\n`);
  const missing = [];
  for (const w of WANTED) {
    const on = Boolean(got[w.key]);
    if (!on) missing.push(w);
    console.log(`  ${on ? "✔" : "·"} ${w.name}`);
    console.log(`      ${w.needs}`);
    if (!on) console.log(`      without it: ${w.without}`);
  }

  console.log("");
  if (!missing.length) {
    console.log("  Everything this can check is configured.");
  } else {
    console.log(`  ${missing.length} not configured: ${missing.map((m) => m.name).join(", ")}`);
    console.log("  docs/LAUNCH.md has the steps, in the order they unblock each other.");
  }

  /*
   * EXIT 0 EITHER WAY, and deliberately.
   *
   * A deployment with no Stripe keys is a perfectly good deployment — it is
   * the free product, and the surfaces that would charge for something check
   * for the keys and render nothing. This reports; it does not judge. Only
   * being unable to ask is a failure, which is the branch above.
   */
  console.log("");
})();
