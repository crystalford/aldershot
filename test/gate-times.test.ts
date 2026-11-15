/**
 * THE `times` RULE'S OWN BLIND SPOTS, pinned.
 *
 * `scripts/check-fidelity.cjs` is not typechecked and the rules in it have
 * no other tests, so a rule that stops reading half its haystack goes on
 * printing a green tick — which is what `reachable` did for weeks. This rule
 * was deliberately broken five ways before it was trusted and two of those
 * breaks passed the first version of it:
 *
 *   1. A schema written on ONE LINE. The property regex was anchored to the
 *      start of a line, so `const SCHEMA = { properties: { at_ms: … } }` had
 *      no property the rule could see.
 *   2. A schema renamed. src/judge.ts and src/classify.ts hand their schema
 *      to callReason/callRouted rather than writing a `response_format`
 *      themselves, so the cross-check that every call site declares a
 *      readable schema did not know they were call sites. Renaming judge's
 *      const made the rule read twelve schemas instead of thirteen and say
 *      nothing about the one it had lost.
 *
 * Both fixes are one line from coming back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WHOLE = readFileSync(join(ROOT, "scripts", "check-fidelity.cjs"), "utf8");

/*
 * THE RULE, NOT THE FILE — and this test was broken once before it was
 * trusted because of it.
 *
 * Deleting the callReason clause from `times` left the assertion passing,
 * because an unrelated rule four hundred lines up — the one about token
 * budgets — already contains the identical regex. The haystack was the whole
 * 180 KB file, so every claim below was being satisfied by somebody else's
 * code. That is the same error one more time: a rule, or a test of a rule,
 * whose haystack is wider than its subject proves nothing about its subject.
 */
const from = WHOLE.indexOf("const TIME_WORDS = new Set([");
const to = WHOLE.indexOf("checkTemplate();");
if (from < 0 || to < 0 || to < from) throw new Error("the times rule has moved; this test cannot read it");
const GATE = WHOLE.slice(from, to);

test("the property regex is not anchored to the start of a line", () => {
  /* Break 1. `/^\s*(key)\s*:\s*\{/gm` is the version that passed a one-line
     schema; the fix is the same regex without the anchor. */
  assert.ok(
    !/matchAll\(\/\^\\s\*\(\[A-Za-z_\$\]/.test(GATE),
    "a line-anchored property regex cannot see a schema written on one line",
  );
  assert.match(GATE, /const keys = \[\.\.\.region\.matchAll\(/, "properties are read from the region, unanchored");
  assert.match(GATE, /required:\\s\*\\\[\(\[\^\\\]\]\*\)\\\]/, "and a name that appears only in `required` is read too");
});

test("a call site is not only a response_format", () => {
  /* Break 2. */
  assert.match(GATE, /\\bcall\(\?:Reason\|Routed\)/, "callReason and callRouted count as call sites");
  assert.match(GATE, /schema\$\/i\.test/, "and any const whose name ends in SCHEMA is a schema the rule reads");
});

test("the transport is exempt and named, not silently skipped", () => {
  assert.match(GATE, /const TRANSPORT = \['src\/llm\.ts', 'src\/breaker\.ts'\]/);
});

/*
 * AND THE RULE ACTUALLY FIRES. The assertions above read the source, which
 * says the fix is written; this one breaks a schema on disk, runs the gate,
 * and puts the file back. Reading the source is how a rule gets declared
 * into existence without ever running.
 */
test("ACCEPTANCE: a time field in a schema that is not grounded fails the gate", () => {
  const file = join(ROOT, "src", "plan.ts");
  const before = readFileSync(file, "utf8");
  const needle = '    claim: { type: "string" },';
  assert.ok(before.includes(needle), "the schema this test edits has moved");

  try {
    writeFileSync(file, before.replace(needle, needle + '\n    start_ms: { type: "number" },'));
    const r = spawnSync("node", ["scripts/check-fidelity.cjs"], { cwd: ROOT, encoding: "utf8" });
    const out = r.stdout + r.stderr;
    assert.match(out, /✘ times/, "the gate must fail");
    assert.match(out, /src\/plan\.ts: the model may answer with `start_ms`/);
    assert.match(out, /invariant 2/);
  } finally {
    writeFileSync(file, before);
  }

  /* And green again, so a failed restore is a failed test rather than a
     surprise in the next person's working tree. */
  assert.equal(readFileSync(file, "utf8"), before);
});
