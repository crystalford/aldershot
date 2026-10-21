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
import { execFileSync } from "node:child_process";
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
    /const haystack = asksForThings\(client\)[\s\S]{0,120}asksForThings\(callers\);/,
    "the haystack must be built from `callers`, not from `server`",
  );
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

test("the known-dead list holds only what was found, and says when", () => {
  /*
   * A list that grew without anybody noticing would be the rule switched off
   * by instalments, so the exact contents are pinned here and changing them
   * takes an argument in a commit message.
   *
   * `shorts-from-line` came off it the day the Shorts tab wired it, which is
   * the list doing what it is for. `reactions` went on the day comments
   * stopped counting as callers: React mode's planner, written ahead of its
   * phase, never reachable, and until then never reportable either.
   */
  const list = GATE.match(/const KNOWN_DEAD = \[([\s\S]*?)\];/)?.[1] ?? "";
  /* Route-shaped only: the comments in the list contain apostrophes, and
     "React mode's planner" is not a route. */
  const routes = [...list.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes, ["/api/projects/:id/outline", "/api/projects/:id/reactions"]);
  assert.match(GATE, /18 Oct 2026/, "the list says when it was written");
  assert.match(GATE, /21 Oct 2026/, "and when it was added to");
  assert.match(GATE, /Wire them or take them out/);
});

test("ACCEPTANCE: the rule passes on this repo, and says what it is still carrying", () => {
  /*
   * The only assertion here that is not a regex over the gate's own source.
   * Everything above describes the fix; this runs it. A rule that cannot be
   * run from a test is a rule whose next edit is unverified.
   */
  const out = execFileSync("node", [join(import.meta.dirname, "..", "scripts", "check-fidelity.cjs")], {
    encoding: "utf8",
  });
  assert.match(out, /✔ reachable/, "the rule passes on the repo as it stands");
  assert.match(
    out,
    /2 route\(s\) still unreachable and known: \/api\/projects\/:id\/reactions, \/api\/projects\/:id\/outline/,
    "and names both of them, every run",
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
