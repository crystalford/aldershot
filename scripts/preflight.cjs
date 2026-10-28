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
 * Ordered by what it stops. Sign-in first, because an account nobody can
 * create is the one failure that makes every other one moot.
 */
const WANTED = [
  {
    key: "sign_in_google",
    name: "Google sign-in",
    needs: "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET",
    without: "no Google button at all. Needs no domain, so it is the cheapest way in.",
  },
  {
    key: "sign_in_email",
    name: "Email sign-in",
    needs: "MAIL_FROM + a verified sending domain",
    without: 'sign-in links are refused with "email delivery isn\'t configured. Nothing was sent."',
  },
  {
    key: "session_secret",
    name: "Session signing",
    needs: "SESSION_SECRET",
    without: "sessions cannot be signed, so nobody stays signed in. The deploy generates one.",
  },
  {
    key: "app_origin",
    name: "The public address",
    needs: "APP_ORIGIN",
    without: "links in emails and OAuth redirects are built from whatever host the request arrived on.",
  },
  {
    key: "billing",
    name: "Payments",
    needs: "STRIPE_SECRET_KEY + STRIPE_PRICE_ID",
    without: "no upgrade control is rendered anywhere. Everyone stays on Free.",
  },
  {
    key: "billing_webhook",
    name: "The billing webhook",
    needs: "STRIPE_WEBHOOK_SECRET",
    without: "a payment takes the money and never grants the plan — the plan is granted by the webhook, not the redirect.",
  },
  {
    key: "storage_signing",
    name: "Direct upload to storage",
    needs: "R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID",
    without: "large uploads cannot be signed for the browser.",
  },
  {
    key: "frontier_model",
    name: "The upgrade model",
    needs: "ANTHROPIC_API_KEY",
    without: "every role falls back to its Workers AI default, which is the designed behaviour and not a failure.",
  },
];

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
    console.log("   Local: npx wrangler dev --port 8787 --enable-containers=false");
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
