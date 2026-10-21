/**
 * THE `room` RULE, AND THE TRAP IT WAS BORN INTO.
 *
 * The rule says every `max_tokens` in src/ reaches something that reads the
 * budget back out and reports when it was spent. It exists because a budget
 * sized for the answer cuts a reasoning model off mid-thought, the thinking
 * is discarded, and what arrives is an empty parse that reads as "the model
 * had nothing to say" — three times in this repo, each found by a different
 * accident.
 *
 * AND THE FIRST DRAFT OF THE RULE PASSED WITH ITS MATCHER DISABLED. Made to
 * examine no files at all, it printed the same green line as a clean run:
 * the exact fault that let `reachable`'s route check never fire once, in a
 * rule written the day after that was fixed. So the rule counts what it
 * looked at, and this pins the count.
 *
 * `check-fidelity.cjs` is not typechecked. These are behavioural: the gate
 * is run, and only its own `room` line is read — the rest of the script
 * needs a dev server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..");

/** The gate's `room` line, run against a copy of the repo. */
function roomLine(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-room-"));
  try {
    /* Everything but node_modules and .git: the gate reads package.json,
       the prototype, the migrations and the tests, and a list of the
       directories it happens to read today is a list that goes stale. */
    cpSync(ROOT, dir, {
      recursive: true,
      filter: (src) => !/[/\\](node_modules|\.git)([/\\]|$)/.test(src),
    });
    mutate(dir);
    const out = spawnSync("node", [join(dir, "scripts", "check-fidelity.cjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    const all = `${out.stdout ?? ""}${out.stderr ?? ""}`;
    const lines = all.split("\n");
    const at = lines.findIndex((l) => /\broom\b/.test(l) && /^[✔✘]/.test(l.trim()));
    assert.ok(at >= 0, `the gate printed no room line:\n${all.slice(-2000)}`);
    return lines.slice(at, at + 3).join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ACCEPTANCE: a budget nothing watches fails the gate", () => {
  const line = roomLine((dir) => {
    writeFileSync(
      join(dir, "src", "gate-room-probe.ts"),
      "export const probe = () => ({ max_tokens: 100 });\n",
    );
  });
  assert.match(line, /^✘/, `a new budget with no reporter must fail:\n${line}`);
  assert.match(line, /gate-room-probe\.ts/);
});

test("ACCEPTANCE: the rule fails rather than passes when it examines nothing", () => {
  /*
   * THE ONE THAT MATTERS. A rule whose matcher has broken must not be
   * indistinguishable from a rule with nothing to report.
   */
  const line = roomLine((dir) => {
    const p = join(dir, "scripts", "check-fidelity.cjs");
    const s = readFileSync(p, "utf8");
    const needle = "if (!/\\bmax_?[Tt]okens\\s*:/.test(code)) continue;";
    assert.ok(s.includes(needle), "the room matcher has moved; this test is testing nothing");
    writeFileSync(p, s.replace(needle, "if (true) continue;"));
  });
  assert.match(line, /^✘/, `an empty haystack must fail, not pass:\n${line}`);
  assert.match(line, /matcher is broken/);
});

test("ACCEPTANCE: the real repo passes, and says how many it checked", () => {
  const line = roomLine(() => {});
  assert.match(line, /^✔/);
  /* The number is the point: a green line with no count is the green line
     the broken matcher printed. */
  assert.match(line, /\d+ token budgets/);
});
