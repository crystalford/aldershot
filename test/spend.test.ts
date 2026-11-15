/**
 * THE MONTHLY SPEND CAP.
 *
 * doc 10: "a monthly spend cap per account; nothing runs past it without the
 * user raising it." Metering was entirely retrospective — every job wrote
 * what it cost, nothing ever read those rows back to decide anything — so an
 * account could run up any bill at all and the first anybody would know was
 * the invoice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fakeD1 } from "./helpers/fake-d1.ts";
import {
  DEFAULT_CAP_USD,
  MAX_CAP_USD,
  WARN_AT,
  capFor,
  capOrDefault,
  capVerdict,
  monthStart,
  nearingCap,
  setCap,
} from "../src/spend.ts";

test("ACCEPTANCE: past the cap, nothing else runs", () => {
  const v = capVerdict({ spentUsd: 410, capUsd: 400 });
  assert.equal(v.allowed, false);
  assert.match(v.says, /\$410\.00/);
  assert.match(v.says, /\$400\.00/);
  assert.match(v.says, /raise it in Settings/, "a refusal that does not say what to do is a dead end");
});

test("exactly at the cap is past it", () => {
  /*
   * `>=`, not `>`. At exactly the cap the money is gone, and letting one
   * more job through because the sum landed on the round number is the kind
   * of off-by-one only ever noticed in an invoice.
   */
  assert.equal(capVerdict({ spentUsd: 400, capUsd: 400 }).allowed, false);
  assert.equal(capVerdict({ spentUsd: 399.99, capUsd: 400 }).allowed, true);
});

test("never having set a cap is not the same as having no cap", () => {
  /* A cap that only protects the people who went looking for it protects
     nobody. */
  assert.equal(capOrDefault(null), DEFAULT_CAP_USD);
  assert.equal(capOrDefault(undefined), DEFAULT_CAP_USD);
  assert.equal(capOrDefault(Number.NaN), DEFAULT_CAP_USD);
  assert.equal(capVerdict({ spentUsd: DEFAULT_CAP_USD, capUsd: null }).allowed, false);
});

test("a cap of zero is a real choice, and says so differently", () => {
  /* "Stop everything" is a thing somebody may want on purpose, and telling
     them they have spent $0.00 of $0.00 would read as a bug. */
  const v = capVerdict({ spentUsd: 0, capUsd: 0 });
  assert.equal(v.allowed, false);
  assert.match(v.says, /set to nothing/);
  assert.doesNotMatch(v.says, /\$0\.00 and your cap/);
});

test("a negative cap is clamped rather than inverted", () => {
  /* A cap below zero would otherwise read as "spent 0, cap -5" and allow
     nothing while saying something nonsensical. */
  assert.equal(capOrDefault(-5), 0);
  assert.match(capVerdict({ spentUsd: 0, capUsd: -5 }).says, /set to nothing/);
});

test("the default is above every plan's price, so it is a brake and not a tier", () => {
  /*
   * Studio is $249 a month in doc 10. Somebody using what they pay for must
   * never meet this; somebody whose Scout run has gone into a loop should
   * meet it the same day.
   */
  assert.ok(DEFAULT_CAP_USD > 249, "the cap would stop a paying Studio account working");
});

test("under the cap says where you are, without a warning nobody needs", () => {
  const v = capVerdict({ spentUsd: 12.5, capUsd: 400 });
  assert.equal(v.allowed, true);
  assert.equal(v.says, "$12.50 of $400.00 this month.");
  assert.equal(nearingCap(v), false);
});

test("nearing the cap is a warning, not a refusal", () => {
  /* The point of a cap is that nobody is surprised by it, and somebody who
     finds out at the moment work stops has been surprised by it. */
  const near = capVerdict({ spentUsd: 400 * WARN_AT, capUsd: 400 });
  assert.equal(near.allowed, true);
  assert.equal(nearingCap(near), true);

  const over = capVerdict({ spentUsd: 500, capUsd: 400 });
  assert.equal(nearingCap(over), false, "a refusal is not also a warning");
});

test("a cap of zero is never 'nearing', which would divide by it", () => {
  assert.equal(nearingCap(capVerdict({ spentUsd: 0, capUsd: 0 })), false);
});

test("spending is counted from the first of the month, in UTC", () => {
  assert.equal(monthStart(Date.UTC(2026, 9, 21, 9, 30)), Date.UTC(2026, 9, 1));
  assert.equal(monthStart(Date.UTC(2026, 9, 1, 0, 0, 0)), Date.UTC(2026, 9, 1));
  assert.equal(monthStart(Date.UTC(2026, 0, 31, 23, 59)), Date.UTC(2026, 0, 1));
});

test("ACCEPTANCE: and in UTC wherever the machine thinks it is", () => {
  /*
   * THE ASSERTIONS ABOVE DO NOT PIN THIS, which is why this exists.
   *
   * Swapping getUTCMonth() for getMonth() failed none of them — the test
   * machine runs in UTC, so the two agree and the test agreed with both. A
   * month boundary read in local time resets somebody's cap at a different
   * instant from the one the usage rows were written against, and the only
   * symptom is a few hours a month where the sum is wrong.
   *
   * So this runs it somewhere else. 02:00 UTC on 1 October is still
   * September in New York, which makes the two answers a month apart rather
   * than an hour.
   */
  const at = Date.UTC(2026, 9, 1, 2, 0, 0);
  const out = spawnSync(
    "npx",
    ["tsx", "-e", `import { monthStart } from "./src/spend.ts"; console.log(monthStart(${at}));`],
    { encoding: "utf8", env: { ...process.env, TZ: "America/New_York" }, cwd: join(import.meta.dirname, "..") },
  );
  assert.equal(out.status, 0, `could not run it: ${out.stderr}`);
  assert.equal(
    Number(out.stdout.trim()),
    Date.UTC(2026, 9, 1),
    "the month boundary moved with the machine's time zone",
  );
});

test("nonsense spending is treated as none, not as infinity", () => {
  /* SUM() over no rows is null, and a null arriving here must not lock an
     account out of a product it has not used. */
  assert.equal(capVerdict({ spentUsd: Number.NaN, capUsd: 400 }).allowed, true);
  assert.equal(capVerdict({ spentUsd: -3, capUsd: 400 }).spentUsd, 0);
});

/* ── Raising it, which the refusal has always told people to do ─────────── */

/**
 * THE HALF THAT WAS NOT BUILT.
 *
 * capVerdict's own refusal reads "Nothing else will run until you raise it in
 * Settings", and `spend_cap_usd` was READ by capFor and WRITTEN BY NOTHING —
 * no route, no control, no code path anywhere in src/. So every account sat
 * at DEFAULT_CAP_USD for ever, work stopped there, and the message named a
 * place where the thing it asked for could not be done.
 */
test("setCap writes the cap capFor reads", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE v2_users(id TEXT PRIMARY KEY, spend_cap_usd REAL)");
  raw.prepare("INSERT INTO v2_users VALUES('u1', NULL)").run();
  const db = fakeD1(raw) as never;

  assert.equal(await capFor(db, "u1"), DEFAULT_CAP_USD, "an unset cap is the default");
  assert.equal(await setCap(db, "u1", 250), 250);
  assert.equal(await capFor(db, "u1"), 250, "and the enforcer reads what was set");
});

test("the cap is clamped, so a typo cannot become a policy", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE v2_users(id TEXT PRIMARY KEY, spend_cap_usd REAL)");
  raw.prepare("INSERT INTO v2_users VALUES('u1', NULL)").run();
  const db = fakeD1(raw) as never;

  assert.equal(await setCap(db, "u1", -40), 0, "a negative cap is not a cap");
  assert.equal(await setCap(db, "u1", 99_999_999), MAX_CAP_USD, "and neither is an unbounded one");
  assert.equal(await setCap(db, "u1", Number.NaN), DEFAULT_CAP_USD, "not-a-number falls back rather than storing NaN");
});

test("zero is allowed, and means it", async () => {
  /* A legitimate thing to want on an account you are stepping away from, and
     capVerdict has a sentence for exactly this case. */
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE v2_users(id TEXT PRIMARY KEY, spend_cap_usd REAL)");
  raw.prepare("INSERT INTO v2_users VALUES('u1', NULL)").run();
  const db = fakeD1(raw) as never;

  await setCap(db, "u1", 0);
  assert.equal(await capFor(db, "u1"), 0);
  const v = capVerdict({ spentUsd: 0, capUsd: 0 });
  assert.equal(v.allowed, false);
  assert.match(v.says, /set to nothing/);
});

test("the refusal names a place that now has the control", () => {
  /*
   * The sentence and the surface, pinned together. Changing either without
   * the other is how this got broken in the first place: a refusal that
   * points somewhere, and nothing there.
   */
  const says = capVerdict({ spentUsd: 500, capUsd: 400 }).says;
  assert.match(says, /raise it in Settings/);

  const settings = readFileSync(join(import.meta.dirname, "..", "src", "ui", "pages", "settings.ts"), "utf8");
  assert.match(settings, /cap-form/, "Settings renders the form");
  assert.match(settings, /cap-usd/, "with the figure in it");

  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  assert.match(client, /\/api\/spend-cap/, "and something posts it");
});
