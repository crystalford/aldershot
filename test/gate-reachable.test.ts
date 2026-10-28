/**
 * THE GATE'S OWN BLIND SPOT.
 *
 * `scripts/check-fidelity.cjs` has a rule that reports "an API route nothing
 * can reach". It never once fired, because the haystack it searched included
 * `src/index.ts` — which is where the routes are DECLARED. Every route
 * matched its own `app.get("…")` line. Three Scout routes were added with
 * nothing calling any of them and the gate said all checks passed.
 *
 * The fix is one line and it is one line away from coming back, in a file
 * that is not typechecked and has no other test. So it has this one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GATE = readFileSync(join(import.meta.dirname, "..", "scripts", "check-fidelity.cjs"), "utf8");

test("ACCEPTANCE: the route-reachability haystack excludes the declarations", () => {
  /*
   * The whole rule rests on this. With `server` passed straight in, the
   * declarations are in the haystack and every route is trivially reachable
   * — and the gate goes on printing a green tick for a check that cannot
   * fail.
   */
  assert.match(
    GATE,
    /const callers = server[\s\S]{0,200}filter\(\(line\) => !\/app\\\.\(\?:get\|post\|put\|delete\)/,
    "the callers haystack must filter out the route declaration lines",
  );
  assert.match(
    GATE,
    /const haystack =\s*\n?\s*asksForThings\(client\)[\s\S]{0,200}asksForThings\(callers\)/,
    "the haystack must be built from `callers`, not from `server`",
  );
  /* And from scripts/, because a route the owner reaches by running a runner
     is reached. See the comment at `runners`. */
  assert.match(GATE, /A SCRIPT IN THIS REPO IS A CALLER/);
  assert.match(GATE, /asksForThings\(runners\)/);
  /* And `server` itself is never the haystack, which is the exact bug. */
  assert.ok(
    !/const haystack = client \+ '\\n' \+ pages \+ '\\n' \+ server;/.test(GATE),
    "the haystack must not include src/index.ts, where the routes are declared",
  );
});

test("ACCEPTANCE: neither a comment nor an import counts as a caller", () => {
  /*
   * THE SECOND HALF OF THE SAME BUG, found 21 Oct 2026.
   *
   * Filtering the declaration lines out of `server` was not enough, because
   * `server` is every file under src/ — so the haystack still held the prose
   * and the import graph of the whole codebase. Two ways a route passed
   * without a caller:
   *
   *   from "./cuesheet.ts"      → contains "/cuesheet"
   *   "see src/reactions.ts"    → contains "/reactions"
   *
   * A route was therefore reachable if it was implemented in a module named
   * after it, or if anybody had ever written that module's name in a comment.
   * `/api/projects/:id/cuesheet` shipped green with nothing calling it, and
   * so had `/api/eval/export` and `/api/projects/:id/reactions` before it.
   */
  assert.match(GATE, /AN IMPORT PATH IS NOT A CALLER/, "the import case is named");
  assert.match(GATE, /NOR IS A COMMENT A CALLER/, "and the comment case");
  assert.match(GATE, /const MODULE_PATH = /, "module specifiers are stripped");
  assert.match(GATE, /const stripComments = /, "and so are comments");
  assert.match(
    GATE,
    /asksForThings = \(src\) =>\s*\n\s*stripComments\(src\)/,
    "and the haystack goes through both, in that order",
  );
  /* A URL in a real fetch must survive the line-comment strip, or the fix
     trades a false pass for a false failure. */
  assert.match(GATE, /\[\^:"'`/, "the line-comment strip spares '//' after a colon or quote");
});

test("every exemption carries a reason, and one of them still checks something", () => {
  /*
   * An exemption that can be earned by accident is the hole this rule just
   * spent its whole existence having. There are three kinds and each is a
   * named list rather than a pattern.
   */
  assert.match(GATE, /CALLED_FROM_OUTSIDE/, "routes reached by an uptime check or a browser");
  assert.match(GATE, /BUILT_BY_CONCATENATION/, "routes whose last segment the caller builds");
  assert.match(GATE, /KNOWN_DEAD/, "routes that shipped with no caller");

  /*
   * The concatenation exemption carries the literal that must be present, so
   * deleting the caller still fires. An exemption that checked nothing would
   * be a route permanently excused.
   */
  assert.match(GATE, /'\/api\/billing\/portal': '\/api\/billing\/'/);
  assert.match(GATE, /its caller built/, "and it says so when that literal goes");
});

test("ACCEPTANCE: the known-dead list is printed on every run", () => {
  /*
   * A list like this earns its keep only by getting shorter, and the way it
   * stops getting shorter is by going quiet. Nobody deletes what they cannot
   * see.
   */
  assert.match(GATE, /route\(s\) still unreachable and known/);
  assert.match(GATE, /console\.log\('  … ' \+ deadStill\.length/);
});

test("the known-dead list is empty, and the gate still explains itself", () => {
  /*
   * EMPTY, 28 Oct 2026, and that is the list finishing its job rather than
   * being switched off.
   *
   * It held /api/projects/:id/outline and /api/projects/:id/reactions, both
   * found when this rule stopped accepting a comment as a caller. The rule's
   * own instruction was "Wire them or take them out", and they were taken
   * out: each was a second door to work `begin()` already dispatches from the
   * composer, so the capabilities (src/essay.ts, src/reactions.ts) stayed and
   * the routes went. `shorts-from-line` came off the same list the day the
   * Shorts tab wired it, which is the other way an entry is meant to leave.
   *
   * STILL PINNED, in the other direction. This used to assert the exact two
   * entries so the list could not grow unnoticed — "the rule switched off by
   * instalments". The same argument now says it must stay at zero, so an
   * addition takes a reason in a commit message.
   */
  const list = GATE.match(/const KNOWN_DEAD = \[([\s\S]*?)\];/)?.[1] ?? "";
  const routes = [...list.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes, [], "a dead route is wired or deleted, not listed");
  assert.match(
    GATE,
    /earns its keep only by getting shorter/,
    "and the list still says what it is for, so the next reader knows the bar",
  );
});

test("ACCEPTANCE: the rule passes on this repo, and says what it is still carrying", () => {
  /*
   * The only assertion here that is not a regex over the gate's own source.
   * Everything above describes the fix; this runs it. A rule that cannot be
   * run from a test is a rule whose next edit is unverified.
   */
  /*
   * spawnSync, and the exit CODE is deliberately not asserted.
   *
   * The first version used execFileSync, which throws on a non-zero exit —
   * and that exit covers every rule in the file, including `strings`, which
   * only runs at all when a dev server happens to be up. So this test passed
   * or failed on whether something unrelated was listening on 8787, twice in
   * one afternoon. A test that fails for a reason it does not name is a test
   * somebody deletes. This one claims something about reachability, so it
   * reads the reachability lines and nothing else.
   */
  const run = spawnSync("node", [join(import.meta.dirname, "..", "scripts", "check-fidelity.cjs")], {
    encoding: "utf8",
  });
  const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  assert.match(out, /✔ reachable/, "the rule passes on the repo as it stands");
  assert.doesNotMatch(out, /nothing anywhere asks for it/, "and nothing is unwired");
  /*
   * AND NAMES NOTHING, because there is nothing left to name. The line is
   * printed only when the list has entries (`if (deadStill.length)`), so its
   * absence is the whole point: every route this rule knows about is asked
   * for by something. When an entry comes back, this assertion is what has to
   * change, and changing it is the argument.
   */
  assert.doesNotMatch(
    out,
    /route\(s\) still unreachable and known/,
    "no route is unreachable-and-tolerated any more",
  );
});

test("the rule the gate cannot see through, said out loud", () => {
  /*
   * A LIMIT WORTH WRITING DOWN. The haystack is file TEXT, so a path literal
   * sitting in a function nobody calls satisfies the rule. Deleting the Send
   * Scout button's call site while leaving `scoutPanel` in the file would
   * pass — the route's path is still in cut.ts.
   *
   * That is not fixable by this rule, which is a text search; it is the
   * `wired` rule's shape of problem and `wired` only sees exports. The honest
   * thing is to say so where somebody will read it rather than to imply a
   * guarantee the check does not make.
   */
  assert.match(GATE, /path literal\s*\n?\s*\*?\s*sitting in a function nobody calls/i);
});
