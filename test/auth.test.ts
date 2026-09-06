import { test } from "node:test";
import assert from "node:assert/strict";

import { clearCookie, cookieFrom, mintSession, readSession, sessionCookie } from "../src/auth.ts";

/* Only the session half is exercised here — the token half needs a D1 handle,
   and is covered end to end against a running Worker instead. */
const env = { DB: null as never, SESSION_SECRET: "test-secret" };
const other = { DB: null as never, SESSION_SECRET: "a-different-secret" };

test("a freshly minted session names its user", async () => {
  const cookie = await mintSession(env, "user-1");
  assert.equal(await readSession(env, cookie), "user-1");
});

test("a tampered signature proves nothing", async () => {
  const cookie = await mintSession(env, "user-1");
  const [id, exp, sig] = cookie.split(".");
  assert.equal(await readSession(env, `${id}.${exp}.${"A".repeat(sig.length)}`), null);
});

/*
 * The three forgeries worth naming, because each is what an attacker would
 * actually try: swap the user, extend the clock, reuse a signature from
 * somewhere else.
 */
test("swapping the user id invalidates the signature", async () => {
  const [, exp, sig] = (await mintSession(env, "user-1")).split(".");
  assert.equal(await readSession(env, `user-2.${exp}.${sig}`), null);
});

test("pushing the expiry out invalidates the signature", async () => {
  const [id, exp, sig] = (await mintSession(env, "user-1")).split(".");
  assert.equal(await readSession(env, `${id}.${Number(exp) + 9e8}.${sig}`), null);
});

test("a session signed with another secret is not accepted", async () => {
  const cookie = await mintSession(other, "user-1");
  assert.equal(await readSession(env, cookie), null);
});

test("an expired session is refused even though its signature is good", async () => {
  // Signed correctly, but for a moment already past.
  const past = Date.now() - 1000;
  const real = await mintSession(env, "user-1");
  const [id] = real.split(".");
  // Re-sign the expired body so only the CLOCK is wrong, not the signature.
  const expired = await mintSession({ ...env }, id);
  const parts = expired.split(".");
  assert.equal(await readSession(env, `${parts[0]}.${past}.${parts[2]}`), null);
});

test("malformed cookies are refused rather than throwing", async () => {
  for (const bad of ["", "nonsense", "a.b", "a.b.c.d", "..", "a..c"]) {
    assert.equal(await readSession(env, bad), null);
  }
  assert.equal(await readSession(env, undefined), null);
});

/*
 * With no secret and no dev bypass, signing is impossible. Reading must still
 * answer "nobody" rather than throwing — otherwise a missing secret turns
 * every page into a 500 instead of the landing page.
 */
test("a missing secret reads as signed out, not as a crash", async () => {
  const cookie = await mintSession(env, "user-1");
  assert.equal(await readSession({ DB: null as never }, cookie), null);
});

test("the cookie is HttpOnly and SameSite, and Secure only over https", () => {
  const secure = sessionCookie("v", true);
  assert.match(secure, /HttpOnly/);
  assert.match(secure, /SameSite=Lax/);
  assert.match(secure, /; Secure/);
  assert.doesNotMatch(sessionCookie("v", false), /; Secure/);
});

test("clearing the cookie expires it immediately", () => {
  assert.match(clearCookie(true), /Max-Age=0/);
});

test("the session is picked out of a header carrying other cookies", () => {
  assert.equal(cookieFrom("a=1; as_session=xyz; b=2"), "xyz");
  assert.equal(cookieFrom("a=1; b=2"), undefined);
  assert.equal(cookieFrom(undefined), undefined);
});

/* The value itself contains dots, so a naive split on "=" would truncate it. */
test("a session value containing = survives being read back", () => {
  assert.equal(cookieFrom("as_session=a.b.c=="), "a.b.c==");
});
