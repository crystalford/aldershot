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
  CHARGE_MULTIPLE,
  DEFAULT_CAP_USD,
  DEFAULT_LIMIT_USD,
  LIMITED_JOBS,
  MAX_LIMIT_USD,
  WARN_AT,
  brakeFor,
  capFor,
  capOrDefault,
  capVerdict,
  chargedThisMonth,
  limitFor,
  limitVerdict,
  monthStart,
  nearingCap,
  setLimit,
  underLimit,
} from "../src/spend.ts";
import { renderSettings, LIMIT_CHOICES } from "../src/ui/pages/settings.ts";

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

/* ── The limit, and the brake that follows it (doc 22, row 4) ───────────── */

const users = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE v2_users(id TEXT PRIMARY KEY, spend_cap_usd REAL, gen_limit_usd REAL)");
  raw.exec(`CREATE TABLE usage_events(id TEXT, user_id TEXT, job_type TEXT, cost_usd REAL, created_at INTEGER)`);
  raw.prepare("INSERT INTO v2_users VALUES('u1', NULL, NULL)").run();
  return { raw, db: fakeD1(raw) as never };
};

test("an unset limit is the canvas's $50, and setLimit writes what limitFor reads", async () => {
  const { db } = users();
  assert.equal(await limitFor(db, "u1"), DEFAULT_LIMIT_USD);
  assert.equal(DEFAULT_LIMIT_USD, 50);
  assert.equal(await setLimit(db, "u1", 100), 100);
  assert.equal(await limitFor(db, "u1"), 100);
});

test("the limit is clamped, so a typo cannot become a policy; zero is allowed and means it", async () => {
  const { db } = users();
  assert.equal(await setLimit(db, "u1", -40), 0);
  assert.equal(await setLimit(db, "u1", 99_999_999), MAX_LIMIT_USD);
  assert.equal(await setLimit(db, "u1", Number.NaN), DEFAULT_LIMIT_USD);
  await setLimit(db, "u1", 0);
  const v = limitVerdict({ chargedUsd: 0, limitUsd: await limitFor(db, "u1") });
  assert.equal(v.allowed, false);
  assert.match(v.says, /set to nothing, so nothing will be generated/);
});

test("ACCEPTANCE: only generated work counts, at what the person is charged", async () => {
  /* The canvas's promise: "reading footage and editing are never counted
     against it". A transcription and a render cost money and move nothing;
     a generated voice moves it by three times its running cost. */
  const { raw, db } = users();
  const now = Date.UTC(2026, 10, 22);
  const ins = raw.prepare("INSERT INTO usage_events VALUES(?,?,?,?,?)");
  ins.run("e1", "u1", "transcribe", 9, now);
  ins.run("e2", "u1", "render", 4, now);
  ins.run("e3", "u1", "tts", 2, now);
  ins.run("e4", "u1", "tts", 5, Date.UTC(2026, 9, 30));
  ins.run("e5", "u2", "tts", 5, now);
  assert.deepEqual([...LIMITED_JOBS], ["tts"]);
  assert.equal(await chargedThisMonth(db, "u1", now), 2 * CHARGE_MULTIPLE);
  assert.equal(CHARGE_MULTIPLE, 3, "decision 38's three times");
});

test("ACCEPTANCE: at the limit, nothing more is generated, and the sentence says where to raise it", async () => {
  const { raw, db } = users();
  const now = Date.UTC(2026, 10, 22);
  raw.prepare("INSERT INTO usage_events VALUES(?,?,?,?,?)").run("e1", "u1", "tts", 50 / CHARGE_MULTIPLE, now);
  const v = await underLimit(db, "u1", now);
  assert.equal(v.allowed, false, "exactly at the limit is past it");
  assert.match(v.says, /Nothing more will be generated until you raise it in Settings/);
  assert.equal((await underLimit(db, "u1", Date.UTC(2026, 11, 1))).allowed, true, "and a new month starts clean");
});

test("the brake follows the limit, so the person it stops has something to do", async () => {
  const { db } = users();
  assert.equal(brakeFor(DEFAULT_LIMIT_USD), DEFAULT_CAP_USD + DEFAULT_LIMIT_USD / CHARGE_MULTIPLE);
  assert.equal(await capFor(db, "u1"), brakeFor(DEFAULT_LIMIT_USD));
  await setLimit(db, "u1", 3000);
  assert.equal(await capFor(db, "u1"), DEFAULT_CAP_USD + 1000,
    "a month of generating at the limit can't walk into the brake on that same work");
  await setLimit(db, "u1", 0);
  assert.equal(await capFor(db, "u1"), DEFAULT_CAP_USD, "and a zero limit never makes the brake a stop");
});

test("an old spend_cap_usd is no longer read, so a stored zero can't be a stop nobody lifts", async () => {
  const { raw, db } = users();
  raw.prepare("UPDATE v2_users SET spend_cap_usd = 0 WHERE id='u1'").run();
  assert.equal(await capFor(db, "u1"), brakeFor(DEFAULT_LIMIT_USD));
});

test("the refusals name a place that has the control", () => {
  /* Pinned together, sentence and surface, for the reason setCap was once
     written: a refusal that points somewhere, and nothing there. */
  assert.match(capVerdict({ spentUsd: 500, capUsd: 400 }).says, /as far as your monthly limit lets it go/);
  assert.match(capVerdict({ spentUsd: 500, capUsd: 400 }).says, /raise it in Settings/);
  assert.match(limitVerdict({ chargedUsd: 60, limitUsd: 50 }).says, /raise it in Settings/);

  const page = renderSettings({
    name: null, email: "a@b.c", plan: "free", isOwner: false, meters: [], billingReady: false, trash: [], cost: null,
    limit: { usd: 50, chargedUsd: 12 },
  });
  assert.match(page, /Your monthly limit/);
  for (const n of LIMIT_CHOICES) assert.match(page, new RegExp(`class="limit-chip" data-usd="${n}"`));
  assert.match(page, /\$38 left/, "what is left, from the same two numbers");
  assert.match(page, /reading footage and editing are never counted against it/);

  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  assert.match(client, /\/api\/spend-limit/, "and something posts it");
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(index, /app\.post\("\/api\/spend-limit"/, "to a route that exists");
});

test("the one thing generated today asks the limit first", () => {
  /* The TTS route runs its model in the request and never reaches the
     dispatcher, so the brake in queue.ts never saw it. */
  const index = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const route = index.slice(index.indexOf('app.post("/api/beats/:id/tts"'));
  const gate = route.indexOf("await underLimit(c.env.DB, user.id)");
  const model = route.indexOf("env.AI.run");
  assert.ok(gate > 0, "the route checks the limit");
  assert.ok(model < 0 || gate < model, "before it calls the model");
  assert.match(route.slice(gate, gate + 200), /if \(!limit\.allowed\) return c\.json\(\{ error: limit\.says \}, 402\)/);
});
