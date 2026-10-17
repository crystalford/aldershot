/**
 * Attaching: a cut that draws on what you pointed at.
 *
 * A library assembly used ALL of it, which is right for "three minutes on
 * whatever I have" and wrong for "tighten this" — the moment somebody points
 * at two videos, filling the cut with anything else is the product choosing
 * footage they did not choose.
 *
 * The failures here are quiet ones. A scope that is silently ignored makes
 * the cut too broad; a scope that is silently trusted makes it a filter that
 * accepts arbitrary ids; and a scope that is remembered at assembly but
 * forgotten on recompute makes the cut change the first time you switch a
 * rule off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inScope } from "../src/assemble.ts";
import { scopeOf } from "../src/projects.ts";
import { renderRoom, type RoomData } from "../src/ui/pages/room.ts";

const m = (id: string, source_id: string) => ({ id, source_id });

test("a scope keeps only what it names; no scope keeps everything", () => {
  const pool = [m("a", "srcA"), m("b", "srcB"), m("c", "srcA")];
  assert.deepEqual(inScope(pool, ["srcA"]).map((x) => x.id), ["a", "c"]);
  assert.deepEqual(inScope(pool, ["srcA", "srcB"]).map((x) => x.id), ["a", "b", "c"]);

  /* Null and empty both mean the whole library — which is what every project
     made before the column existed has, and they must not start returning
     nothing the day it was added. */
  assert.deepEqual(inScope(pool, null).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(inScope(pool, []).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(inScope(pool, undefined).map((x) => x.id), ["a", "b", "c"]);
});

test("a scope that cannot be read is no scope, not a crash", () => {
  /*
   * It is a TEXT column. A malformed value would otherwise throw on whichever
   * page read it next, which on this one is the editor — and an unreadable
   * scope meaning "the whole library" is the same answer as never having had
   * one, which is a state the product already handles.
   */
  assert.equal(scopeOf({ scope: null }), null);
  assert.equal(scopeOf({ scope: "" }), null);
  assert.equal(scopeOf({ scope: "not json" }), null);
  assert.equal(scopeOf({ scope: '"a string"' }), null);
  assert.equal(scopeOf({ scope: "[]" }), null, "an empty list is no scope");
  assert.deepEqual(scopeOf({ scope: '["srcA","srcB"]' }), ["srcA", "srcB"]);
  assert.deepEqual(scopeOf({ scope: '["srcA",null,42,""]' }), ["srcA"], "junk entries drop out");
});

test("the server never trusts the ids it is handed", () => {
  /*
   * A scope is a filter, and a filter taking arbitrary strings is a way to
   * ask about somebody else's library. Read from the source because it is a
   * property of the route rather than of what it returns.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const begin = src.slice(src.indexOf("ATTACHED FOOTAGE, WHEN THEY ATTACHED SOME"));
  const upto = begin.slice(0, begin.indexOf("assembleFromLibrary"));
  assert.match(upto, /listSources\(c\.env\.DB, user\.id/, "checked against the user's own sources");
  assert.match(upto, /mine\.has\(id\)/);
});

test("attaching toggles, and survives a page load in the URL", () => {
  /*
   * Server-rendered, so the selection cannot live in client state: a reload
   * would lose it and there would be two copies of the truth. The URL is the
   * one place that cannot get out of step with what is on screen.
   */
  const base: RoomData = {
    tab: "videos",
    attached: [],
    q: "",
    meaningUnavailable: false,
    working: [],
    sources: [
      { id: "srcA", title: "Tuesday", poster_r2_key: null, transcript_state: "ready", duration_s: null, clips: 4 },
      { id: "srcB", title: "Thursday", poster_r2_key: null, transcript_state: "ready", duration_s: null, clips: 5 },
    ],
    moments: [],
    projects: [],
    counts: { sources: 2, moments: 9, threads: 0 },
  };

  const none = renderRoom(base);
  /* &amp;, because the href is HTML-escaped — which is correct, and the thing
     a test written against the source rather than the output gets wrong. */
  assert.match(none, /href="\/\?tab=videos&amp;attach=srcA"/, "attaching adds it");
  assert.equal((none.match(/>Attach</g) ?? []).length, 2);
  assert.ok(!/>Attached</.test(none));
  assert.ok(!/name="sourceIds"/.test(none), "nothing attached, nothing carried");

  const one = renderRoom({ ...base, attached: ["srcA"] });
  assert.match(one, />Attached</, "it says so");
  /*
   * The DETACH link specifically. The first version asserted on
   * href="/?tab=videos" anywhere on the page — which the tab bar's own Videos
   * link satisfies, so it passed whether attaching toggled or not.
   */
  assert.match(
    one,
    /href="\/\?tab=videos"[^>]*>Attached</,
    "pressing an attached one takes it off",
  );
  assert.ok(!/attach=srcA,srcA/.test(one), "and never attaches the same video twice");
  assert.match(one, /href="\/\?tab=videos&amp;attach=srcA,srcB"/, "the other one adds to the list");
  assert.match(one, /name="sourceIds" value="srcA"/, "and the composer carries it");
});

test("every recompute is scoped, or a cut changes when you touch a rule", () => {
  /*
   * THE QUIET ONE. Remember the scope at assembly and forget it on recompute,
   * and the first rule you switch off pulls in footage you never attached —
   * with a perfectly reasonable explanation next to every moment.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const calls = [...src.matchAll(/recomputeFromRules\(c\.env, \{[^}]*\}/g)].map((x) => x[0]);
  assert.ok(calls.length >= 3, `expected several recomputes, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /scope: scopeOf\(project\)/, `unscoped recompute: ${call.slice(0, 80)}`);
  }
});
