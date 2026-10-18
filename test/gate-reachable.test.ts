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
    /const haystack = client \+ '\\n' \+ pages \+ '\\n' \+ callers;/,
    "the haystack must be built from `callers`, not from `server`",
  );
  /* And `server` itself is never the haystack, which is the exact bug. */
  assert.ok(
    !/const haystack = client \+ '\\n' \+ pages \+ '\\n' \+ server;/.test(GATE),
    "the haystack must not include src/index.ts, where the routes are declared",
  );
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
  /* Two routes, found the day the rule could fire for the first time. A list
     that grew without anybody noticing would be the rule switched off by
     instalments. */
  const list = GATE.match(/const KNOWN_DEAD = \[([^\]]*)\]/)?.[1] ?? "";
  const routes = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes, ["/api/projects/:id/outline", "/api/projects/:id/shorts-from-line"]);
  assert.match(GATE, /18 Oct 2026/, "the list says when it was written");
  assert.match(GATE, /Wire them or take them out/);
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
