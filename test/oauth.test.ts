import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clearStateCookie,
  googleConfigured,
  redirectUri,
  startGoogle,
  stateCookie,
  stateFrom,
  stateMatches,
} from "../src/oauth.ts";

const env = { GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret" };

test("Google is only offered when both halves are configured", () => {
  assert.equal(googleConfigured(env), true);
  assert.equal(googleConfigured({ GOOGLE_CLIENT_ID: "cid" }), false);
  assert.equal(googleConfigured({ GOOGLE_CLIENT_SECRET: "s" }), false);
  assert.equal(googleConfigured({}), false);
});

test("the redirect URI is derived from the origin, not hardcoded", () => {
  assert.equal(redirectUri("https://aldershot.io"), "https://aldershot.io/auth/google/callback");
  assert.equal(redirectUri("http://localhost:8787"), "http://localhost:8787/auth/google/callback");
});

test("we ask for identity only, never anyone's Google data", () => {
  const { url } = startGoogle(env, "https://aldershot.io");
  const scope = new URL(url).searchParams.get("scope");
  assert.equal(scope, "openid email");
});

test("the authorize URL carries what Google needs and nothing secret", () => {
  const { url, state } = startGoogle(env, "https://aldershot.io");
  const q = new URL(url).searchParams;
  assert.equal(q.get("client_id"), env.GOOGLE_CLIENT_ID);
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("redirect_uri"), "https://aldershot.io/auth/google/callback");
  assert.equal(q.get("state"), state);
  // The client secret is exchanged server-to-server; it must never ride in a
  // URL the browser sees.
  assert.equal(url.includes(env.GOOGLE_CLIENT_SECRET), false);
});

test("a shared machine is asked which account, not assumed", () => {
  const { url } = startGoogle(env, "https://aldershot.io");
  assert.equal(new URL(url).searchParams.get("prompt"), "select_account");
});

test("every start gets a fresh state", () => {
  const a = startGoogle(env, "https://aldershot.io").state;
  const b = startGoogle(env, "https://aldershot.io").state;
  assert.notEqual(a, b);
  assert.ok(a.length >= 20, "state is too short to be unguessable");
});

/*
 * State is the CSRF defence. Without it an attacker can complete a sign-in in
 * someone else's browser and silently leave them inside the attacker's
 * account, where everything they upload is visible to the attacker.
 */
test("a callback with no state, or a mismatched one, is refused", () => {
  assert.equal(stateMatches("abc", "abc"), true);
  assert.equal(stateMatches("abc", "abd"), false);
  assert.equal(stateMatches("abc", undefined), false);
  assert.equal(stateMatches(undefined, "abc"), false);
  assert.equal(stateMatches(undefined, undefined), false);
  assert.equal(stateMatches("", ""), false);
});

test("the state cookie is HttpOnly, short-lived, and Secure over https", () => {
  const c = stateCookie("xyz", true);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=600/);
  assert.match(c, /; Secure/);
  assert.doesNotMatch(stateCookie("xyz", false), /; Secure/);
});

test("clearing the state cookie expires it immediately", () => {
  assert.match(clearStateCookie(true), /Max-Age=0/);
});

test("the state is read out of a header carrying other cookies", () => {
  assert.equal(stateFrom("a=1; as_oauth_state=xyz; as_session=q"), "xyz");
  assert.equal(stateFrom("as_session=q"), undefined);
  assert.equal(stateFrom(undefined), undefined);
});
