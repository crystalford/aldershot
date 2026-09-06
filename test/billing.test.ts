/**
 * The webhook signature.
 *
 * This check IS the authentication on /webhooks/stripe — Stripe has no session
 * to present, so a bug here means anyone on the internet can POST themselves a
 * paid subscription. It is the one piece of this codebase where "it looked
 * right" is not good enough, so every way it can be attacked is exercised.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhook } from "../src/billing.ts";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1" } } });

/** Signs a payload the way Stripe does: HMAC-SHA256 over "<t>.<raw body>". */
async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOW = 1_800_000_000_000;
const T = Math.floor(NOW / 1000);

test("accepts a signature Stripe would actually send", async () => {
  const header = `t=${T},v1=${await sign(SECRET, T, BODY)}`;
  assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), true);
});

test("rejects a signature made with the wrong secret", async () => {
  const header = `t=${T},v1=${await sign("whsec_not_ours", T, BODY)}`;
  assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), false);
});

test("rejects a body that was altered after signing", async () => {
  const header = `t=${T},v1=${await sign(SECRET, T, BODY)}`;
  const tampered = BODY.replace("cs_1", "cs_2");
  assert.equal(await verifyWebhook(SECRET, tampered, header, NOW), false);
});

test("rejects a replay of a genuinely-signed old event", async () => {
  /* Without a timestamp check, a valid downgrade event could be replayed for
     ever and an account could never stay upgraded. */
  const old = T - 3600;
  const header = `t=${old},v1=${await sign(SECRET, old, BODY)}`;
  assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), false);
});

test("rejects a signature reused under a fresher timestamp", async () => {
  const header = `t=${T},v1=${await sign(SECRET, T - 3600, BODY)}`;
  assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), false);
});

test("accepts when one of several v1 signatures matches", async () => {
  /* Stripe sends more than one v1 during a secret rotation. Checking only the
     first would fail every event for the length of the rollover. */
  const header = `t=${T},v1=${await sign("whsec_old", T, BODY)},v1=${await sign(SECRET, T, BODY)}`;
  assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), true);
});

test("rejects a missing, empty or malformed header", async () => {
  for (const header of [null, "", "garbage", `t=${T}`, "v1=abc", `t=,v1=`, `t=nonsense,v1=abc`]) {
    assert.equal(await verifyWebhook(SECRET, BODY, header, NOW), false, `accepted ${JSON.stringify(header)}`);
  }
});

test("rejects a signature of the right length but wrong bytes", async () => {
  const real = await sign(SECRET, T, BODY);
  const forged = real.slice(0, -1) + (real.endsWith("0") ? "1" : "0");
  assert.equal(await verifyWebhook(SECRET, BODY, `t=${T},v1=${forged}`, NOW), false);
});
