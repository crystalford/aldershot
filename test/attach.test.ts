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
  threadNames: [],
  mode: "meaning" as const,
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
  /* "Attach all" is the prototype's word — a video row attaches the whole
     video, and "Attach" alone read as attaching the row you were looking at.
     The old label was mine; this test was pinning it. */
  assert.equal((none.match(/>Attach all</g) ?? []).length, 2);
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
    /* Scoped — by whichever expression; the undo route restores a snapshot's
       scope rather than the project's current one, and demanding one exact
       form made this fail on the correct code. */
    assert.match(call, /\bscope\b/, `unscoped recompute: ${call.slice(0, 80)}`);
  }
});

test("adding to an open cut, and taking it back, restores the scope", () => {
  /*
   * THE BUG THIS TEST EXISTS FOR, found by driving it.
   *
   * The attach pass's undo snapshot carried the rules and not the scope — and
   * the rules are UNCHANGED by attaching, so undoing it restored nothing at
   * all. The cut stayed widened, the video stayed added, and the pass line
   * said it had been taken back.
   *
   * Read from the source because it is a property of what is stored, and the
   * storing is the half that was wrong.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  /*
   * Anchored on the pass this route records, rather than sliced. Two earlier
   * windows were wrong: cutting at the first `return c.json` stopped before
   * the snapshot (the route has four early returns in front of it), and
   * cutting at the next `app.` matched the route's OWN declaration.
   */
  assert.match(
    src,
    /instruction: `Added[\s\S]{0,900}?undo: \{[^}]*rules: JSON\.stringify\(rules\)[^}]*scope: JSON\.stringify\(scope\)/,
    "the snapshot has to carry both the rules and the scope",
  );

  /*
   * And the undo has to put it back, not merely parse it.
   *
   * Anchored, not sliced. THREE windows in this file were wrong before this
   * one: a slice to the first `return c.json` stops inside the catch, and a
   * slice to the next `app.` matches the route's own declaration. Reading
   * source in a test is fine; guessing where a route ends is not.
   */
  assert.match(
    src,
    /A pass that did not touch the scope[\s\S]{0,1200}UPDATE v2_projects SET scope=\?/,
    "the undo writes the scope back",
  );
  assert.match(
    src,
    /scope\?\.length \? JSON\.stringify\(scope\) : null/,
    "and an emptied scope becomes null, which is what the whole library means",
  );
});

test("a cut with no scope is not offered more footage", () => {
  /*
   * It already draws on everything, so "add this video" could not do
   * anything — and a control that cannot act is the thing the conventions
   * check exists to stop.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const block = src.slice(src.indexOf("The videos this cut is NOT drawing on"));
  assert.match(block.slice(0, 500), /const scope = scopeOf\(project\);\s*\n\s*const addable = scope/);

  const route = src.slice(src.indexOf("ADD A VIDEO TO AN OPEN CUT"));
  assert.match(
    route.slice(0, 1400),
    /if \(!scope\) return c\.json\(\{ error: "this cut already draws on everything you have" \}, 422\)/,
    "and the route says so rather than pretending to act",
  );
});
