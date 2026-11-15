/**
 * HOW MUCH IT DECIDES — the composer's dial, and the mode that waits.
 *
 * src/ui/pages/home.ts has carried a comment since the room was built saying
 * the prototype's composer is "the text, the dial and the mic" and the build
 * had the text. Recommend is what it already did; Ask is the new behaviour,
 * and the thing that must be true about Ask is that NOTHING HAPPENS until
 * somebody presses Add.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_MODES,
  DEFAULT_MODE,
  MODE_DOES,
  MODE_LABEL,
  announces,
  applies,
  modeHint,
  modeOf,
  nextMode,
  readMode,
  resolvePress,
  writeMode,
} from "../src/decide.ts";

test("only Ask holds back; both the others act", () => {
  /*
   * The whole dial in one line. Recommend and Auto differ in whether they
   * draw attention, never in whether the rule went on — a dial where two of
   * three settings mean "sometimes" would be a dial nobody could trust.
   */
  assert.equal(applies("ask"), false);
  assert.equal(applies("rec"), true);
  assert.equal(applies("auto"), true);
  assert.equal(announces("rec"), true);
  assert.equal(announces("auto"), false);
  assert.equal(announces("ask"), false, "nothing was done, so there is nothing to announce");
});

test("the default is what this product already did", () => {
  /*
   * Every account predates this column. Recommend is the behaviour they have
   * had all along — the rule goes on and the turn carries Undo — so a null
   * column must not quietly change how somebody's editor works.
   */
  assert.equal(DEFAULT_MODE, "rec");
  assert.equal(modeOf(null), "rec");
  assert.equal(modeOf(undefined), "rec");
  for (const junk of ["", "Ask", "AUTO", "recommend", "yes"]) {
    assert.equal(modeOf(junk), "rec", `${JSON.stringify(junk)} is not a mode`);
  }
});

test("the cycle hands over more each press, and comes back round", () => {
  assert.equal(nextMode("ask"), "rec");
  assert.equal(nextMode("rec"), "auto");
  assert.equal(nextMode("auto"), "ask");
  assert.equal(nextMode(nextMode(nextMode("ask"))), "ask");
});

test("a press is told where it came FROM, never where to go", () => {
  /*
   * It matters more here than on the Scout pill: a client that could post
   * {mode:"auto"} could hand itself permission to stop asking.
   */
  assert.deepEqual(resolvePress("ask", "ask"), { mode: "rec", stale: false });
  assert.deepEqual(resolvePress("rec", undefined), { mode: "auto", stale: false });
  assert.deepEqual(resolvePress("ask", "auto"), { mode: "ask", stale: true });
});

test("every mode has a word and a sentence, and the hint says both", () => {
  for (const m of ASK_MODES) {
    assert.ok(MODE_LABEL[m], m);
    assert.ok(MODE_DOES[m].startsWith(MODE_LABEL[m] + ":"), MODE_DOES[m]);
    assert.ok(modeHint(m).includes(MODE_DOES[m]));
    assert.ok(modeHint(m).endsWith("click to change"));
  }
  /* The prototype's own words, which is what the strings gate checks the
     rendered label against. */
  assert.equal(MODE_LABEL.rec, "Recommend");
  assert.equal(MODE_DOES.ask, "Ask: it proposes each rule and waits for Add");
});

test("the mode round-trips, and an unreadable one is the default", async () => {
  let stored: string | null = null;
  const db = {
    prepare: (sql: string) => ({
      bind: (...b: unknown[]) => ({
        first: async () => ({ ask_mode: stored }),
        run: async () => {
          assert.match(sql, /^UPDATE v2_users SET ask_mode/);
          stored = b[0] as string;
        },
      }),
    }),
  } as unknown as D1Database;
  assert.equal(await readMode(db, "u1"), "rec");
  for (const m of ASK_MODES) {
    await writeMode(db, "u1", m);
    assert.equal(await readMode(db, "u1"), m);
  }
  const broken = {
    prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no"); } }) }),
  } as unknown as D1Database;
  assert.equal(await readMode(broken, "u1"), "rec");
});

test("Ask never reaches a function that writes", () => {
  /*
   * THE ONE THAT MATTERS. recomputeFromRules puts the beats; a proposal that
   * went through it would change the cut the person is still being asked
   * about, and the page would look right because the numbers would agree
   * with the beats it had just written.
   *
   * So the Ask branch calls previewFromRules, which has no write in it at
   * all. A `dryRun` boolean would have been one mistyped call away from the
   * same bug, which is why the split is a second function.
   */
  const assemble = readFileSync(join(import.meta.dirname, "..", "src", "assemble.ts"), "utf8");
  /* THE FUNCTION, not the rest of the file after it. Slicing to the end of
     assemble.ts picked up two later writes and failed for the wrong reason,
     which is the same mistake that would have made it pass for the wrong
     one. It ends at the first brace in column zero. */
  const from = assemble.indexOf("export async function previewFromRules");
  const preview = assemble.slice(from, assemble.indexOf("\n}\n", from));
  assert.ok(preview.includes("const pool"), "the slice must be the function");
  assert.ok(!/putBeats|saveRules|\.run\(\)/.test(preview), "previewFromRules must not write");

  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const branch = index.slice(index.indexOf("      if (!doIt) {"), index.indexOf("      const out = await recomputeFromRules"));
  assert.ok(branch.length > 100, "the Ask branch must exist");
  assert.ok(!/recomputeFromRules|saveRules|recordPass/.test(branch), "the Ask branch must change nothing");
  assert.match(branch, /previewFromRules/);
  /* And it returns, rather than falling through into the applying path. */
  assert.match(branch, /return c\.json\(\{\s*ok: true,\s*proposal:/);
});

test("pressing Add it is how a proposal is applied, not a way round the dial", () => {
  /* `apply` comes from the proposal row, which only exists because the dial
     was on Ask and the server said what it would do. A client sending it
     without that is sending the second half of a conversation it started. */
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(index, /const doIt = b\.apply === true \|\| applies\(mode\);/);
  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  /* The proposal carries the sentence back and Add it re-posts that same
     sentence — not a rule id, which would be a second way to say the same
     thing that could disagree with the first. */
  assert.match(client, /showProposal\(out\.proposal, \(apply\) => runPass\(instruction, btn, apply\)\)/);
  assert.match(client, /add\.onclick = \(\) => \{ close\(\); decide\(true\); \};/);
  assert.match(client, /bin\.onclick = close;/, "Leave it discards the proposal and runs nothing");
});

test("Ask says so when it cannot ask, rather than going quiet", () => {
  /*
   * A pass on a project with its own transcript is a READ: the model goes
   * through the whole thing before anything knows what it would do, so
   * there is no rule to propose in advance. The dial's promise has nothing
   * to offer there.
   *
   * The alternative — letting the setting quietly mean nothing on half the
   * projects — is how a control becomes one nobody trusts. It runs, because
   * Run it was pressed, and it says which of the two things it did.
   */
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  /*
   * ANCHORED ON THE LINE ITSELF. Two earlier attempts sliced from the
   * createJob call and from the first "});" after it, and both landed in a
   * different route's arguments — an assertion that fails for the wrong
   * reason is one keystroke from passing for the wrong reason.
   */
  assert.match(
    index,
    /note: doIt\s*\?\s*null\s*:\s*"This one reads the whole transcript before it knows what it would do, so it runs rather than proposes\. Undo is on the turn\.",/,
    "the job path must say which of the two things it did",
  );
  /* And it is the PASS route that says it — the only place a note rides
     back beside a jobId. */
  const at = index.indexOf("note: doIt");
  const around = index.slice(at - 900, at);
  assert.match(around, /return c\.json\(\{\s*\n\s*jobId: job\.id,/);

  /*
   * PARKED, NOT TOASTED. runPass reloads a tick after it answers, so a
   * toast posted there is said to a page about to be replaced — which is
   * how a line like this ends up written, shipped, and never once read.
   */
  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  assert.match(client, /if \(out\.note\) sessionStorage\.setItem\("pass-note:" \+ projectId, out\.note\);/);
  assert.match(client, /sessionStorage\.getItem\("pass-note:" \+ projectId\)/);
  assert.match(client, /sessionStorage\.removeItem\("pass-note:" \+ projectId\);/, "said once, not every load");
  /* And the park happens before the reload, not after it. */
  const run = client.slice(client.indexOf("const runPass = async"));
  assert.ok(
    run.indexOf('sessionStorage.setItem("pass-note:') < run.indexOf("location.reload()"),
    "parked before the reload, or it never happens",
  );
});
