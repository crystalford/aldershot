/**
 * THE JUDGE OVER THE SET: what it is asked about, and what gets written.
 *
 * src/judge.ts is tested without a model because its job is to survive one.
 * This is the other half — which pairs the question list is built from, and
 * the two ways a run can quietly produce nothing useful.
 *
 * Against the real DDL, with a stub standing in for the model: the point is
 * the SQL and the write rules, and a schema retyped into a test can be
 * retyped wrong in the same direction as the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { runJudge } from "../src/judge-run.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const TABLES = [
  "v2_users",
  "sources",
  "v2_clips",
  "eval_claims",
  "eval_labels",
  "eval_judgements",
  "eval_machine",
];

function db() {
  const d = new DatabaseSync(":memory:");
  for (const name of TABLES) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
  }
  d.prepare("INSERT INTO v2_users (id,email,created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare(
    "INSERT INTO sources (id,user_id,title,origin,r2_key,transcript_state,created_at) " +
      "VALUES ('s1','u1','Tuesday','upload','u1/s1.mp4','ready',1)",
  ).run();
  for (const [id, quote] of [
    ["c1", "The house has a room that gets sun until four."],
    ["c2", "Rent halves if I go."],
    ["c3", "Okay is this recording."],
  ]) {
    d.prepare(
      "INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,frame_r2_key,kept,created_at) " +
        "VALUES (?,'u1','s1',0,1000,?,'score','',1,1)",
    ).run(id, quote);
  }
  d.prepare("INSERT INTO eval_claims (id,user_id,text,created_at) VALUES ('cl1','u1','the house is the reason',1)").run();
  return d;
}

/** A model that answers with whatever rows it is handed. */
const env = (d: DatabaseSync, reply: (prompt: string) => unknown) =>
  ({
    DB: fakeD1(d),
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        const msgs = input.messages as Array<{ content: string }>;
        return reply(msgs[msgs.length - 1].content);
      },
    },
  }) as never;

test("the question list is what people judged, not what retrieval returns today", async () => {
  /*
   * Retrieval changes. If the judge were asked about today's results, the
   * two sets of answers would be about different moments and every number
   * comparing them would be comparing two different questions.
   */
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c2','ann','backs',1)").run();
  let asked = "";
  await runJudge(env(d, (p) => {
    asked = p;
    return { judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }] };
  }), "u1");
  assert.match(asked, /Rent halves if I go\./);
  assert.doesNotMatch(asked, /sun until four/, "c1 was never judged, so it is not a question");
});

test("both judgement tables are the question list, and a pair counts once", async () => {
  /* eval_labels predates labellers and is still read — see src/schema.ts.
     A pair in both must not be asked about twice. */
  const d = db();
  /* c1 in BOTH — the de-duplication case. */
  d.prepare("INSERT INTO eval_labels (claim_id,clip_id,verdict,created_at) VALUES ('cl1','c1','backs',1)").run();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','related',1)").run();
  /*
   * And c2 in the OLD TABLE ONLY. Without it the first version of this
   * test passed with eval_labels dropped from the union entirely — c1 was
   * reachable either way, so the join proved nothing about the half that
   * predates labellers.
   */
  d.prepare("INSERT INTO eval_labels (claim_id,clip_id,verdict,created_at) VALUES ('cl1','c2','related',1)").run();
  let asked = "";
  const out = await runJudge(env(d, (p) => {
    asked = p;
    return { judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }, { moment: "m2", verdict: "unrelated" }] };
  }), "u1");
  assert.equal((asked.match(/^m\d:$/gm) ?? []).length, 2, "two moments, not three");
  assert.match(asked, /sun until four/);
  assert.match(asked, /Rent halves/, "a pair only the old table knows about is still a question");
  assert.equal(out.judged, 2);
});

test("a call the model answered nothing for writes nothing", async () => {
  /*
   * parseJudgements fills every gap so a short answer cannot shrink the
   * set — which means a silent call comes back as a full column of
   * confident `unrelated`s. Writing those would put them in the numbers as
   * verdicts.
   */
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  const out = await runJudge(env(d, () => ({})), "u1");
  assert.equal(out.judged, 0);
  assert.equal(out.skipped, 1);
  assert.equal((d.prepare("SELECT COUNT(*) AS n FROM eval_machine").get() as { n: number }).n, 0);
});

test("what it said is written down, with what it said before the downgrade", async () => {
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  await runJudge(env(d, () => ({ judgements: [{ moment: "m1", verdict: "backs", why: "It does." }] })), "u1");
  const row = d.prepare("SELECT * FROM eval_machine").get() as Record<string, unknown>;
  assert.equal(row.verdict, "related", "backs with nothing to point at");
  assert.equal(row.raw, "backs");
  assert.equal(row.downgraded, 1);
  assert.equal(row.answered, 1);
  assert.equal(row.line, null);
});

test("asking twice replaces the answer rather than adding one", async () => {
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  const reply = (v: string) => () => ({ judgements: [{ moment: "m1", verdict: v, sentence: 1 }] });
  await runJudge(env(d, reply("backs")), "u1");
  await runJudge(env(d, reply("unrelated")), "u1");
  /* Spread: node:sqlite rows have a null prototype, which deepEqual
     distinguishes from a plain object and which has nothing to do with
     what is being tested. */
  const rows = (d.prepare("SELECT verdict FROM eval_machine").all() as Array<{ verdict: string }>).map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ verdict: "unrelated" }]);
});

test("a new version is a new row, so the old answers survive a model swap", async () => {
  /*
   * "gated by the eval set before a model swap" cannot be done if the old
   * model's answers are gone the moment the new one runs.
   */
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  const reply = (v: string) => () => ({ judgements: [{ moment: "m1", verdict: v, sentence: 1 }] });
  await runJudge(env(d, reply("backs")), "u1", { version: "judge-1" });
  await runJudge(env(d, reply("unrelated")), "u1", { version: "judge-2" });
  const rows = (
    d.prepare("SELECT version, verdict FROM eval_machine ORDER BY version").all() as Array<{
      version: string;
      verdict: string;
    }>
  ).map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { version: "judge-1", verdict: "backs" },
    { version: "judge-2", verdict: "unrelated" },
  ]);
});

test("one person's set is not another's", async () => {
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  const out = await runJudge(env(d, () => ({ judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }] })), "u2");
  assert.equal(out.claims, 0);
  assert.equal(out.judged, 0);
});

test("a moment whose video was deleted is not a question any more", async () => {
  const d = db();
  d.prepare("INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES ('cl1','c1','ann','backs',1)").run();
  d.prepare("UPDATE v2_clips SET deleted_at = 1 WHERE id = 'c1'").run();
  const out = await runJudge(env(d, () => ({ judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }] })), "u1");
  assert.equal(out.judged, 0);
});
