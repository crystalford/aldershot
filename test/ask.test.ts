/**
 * ASK IT ANYTHING ABOUT YOUR FOOTAGE — and the four things it can answer.
 *
 * The Manual's front-door sentence, and the one feature where "we could not
 * check" and "nothing backs this" are easiest to confuse and worst to
 * confuse: one sends a person to look again, the other sends them to shoot
 * footage they may already have.
 *
 * Same harness as beat-find.test.ts, because it is the same compose with a
 * different deliverable: a beat needs coverage and throws the line away,
 * and here the line IS the answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { answerLead, ask } from "../src/ask.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function db(quotes: string[]) {
  const d = new DatabaseSync(":memory:");
  for (const name of ["v2_users", "sources", "v2_clips", "v2_threads", "v2_clip_threads", "renders", "v2_projects"]) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
    for (const m of SCHEMA.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+) .*?;/gi)) {
      if (m[1].toLowerCase() !== name) continue;
      const has = d.prepare(`PRAGMA table_info(${name})`).all().some((c) => c.name === m[2]);
      if (!has) d.exec(m[0]);
    }
  }
  d.prepare("INSERT INTO v2_users (id,email,created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare(
    "INSERT INTO sources (id,user_id,title,origin,r2_key,transcript_state,created_at) " +
      "VALUES ('s1','u1','Tuesday','upload','u1/s1.mp4','ready',1)",
  ).run();
  quotes.forEach((q, i) =>
    d.prepare(
      "INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,frame_r2_key,kept,created_at) " +
        "VALUES (?,'u1','s1',?,?,?,'score','',1,?)",
    ).run(`c${i}`, 65_000 + i * 1000, 65_900 + i * 1000, q, i),
  );
  return d;
}

const env = (d: DatabaseSync, run: (input: Record<string, unknown>) => unknown) =>
  ({ DB: fakeD1(d), AI: { run: async (_m: string, input: Record<string, unknown>) => run(input) } }) as never;

const QUOTES = [
  "We moved the launch before the review came in.",
  "Nobody wanted to be the one to say it out loud.",
];

test("ACCEPTANCE: the answer is the lines, with times off the moment and not the model", async () => {
  const d = db(QUOTES);
  const a = await ask(
    env(d, () => ({
      judgements: [{ moment: "m1", verdict: "backs", sentence: 1, why: "It dates the two." }],
    })),
    "u1",
    "the launch moved before the review",
  );

  assert.equal(a.lines.length, 1, "one moment backed it");
  const [l] = a.lines;
  assert.equal(l.line, QUOTES[0], "the line is rebuilt from our own text");
  /* The clip starts at 65s. The model was never asked for a time and has
     nowhere to put one — invariant 2. */
  assert.equal(l.atMs, 65_000);
  assert.equal(l.atLabel, "1:05");
  assert.equal(l.sourceTitle, "Tuesday");
  assert.equal(l.why, "It dates the two.");
});

test("ACCEPTANCE: nothing the model returns can move a timestamp", async () => {
  /*
   * Invariant 2, end to end — and honestly labelled: this cannot be made to
   * fail from inside src/ask.ts, because `parseJudgements` constructs its
   * own object from four named fields and nothing else the model sends gets
   * past it. Breaking `lineFor` to read a model field changes nothing here,
   * since the field is already gone.
   *
   * So the load-bearing version of this claim lives in test/judge.test.ts
   * ("a field the schema does not have cannot survive the parse"), which was
   * written because of this test and does fail when broken. This one stays
   * as the end-to-end statement: whatever the model volunteers, the answer
   * carries the moment's own span, because a receipt a viewer clicks has to
   * land where the words are.
   */
  const d = db(QUOTES);
  const a = await ask(
    env(d, () => ({
      judgements: [
        {
          moment: "m1",
          verdict: "backs",
          sentence: 1,
          /* None of these exist in the schema. All of them are plausible. */
          atMs: 999_000,
          at: "16:39",
          start_ms: 999_000,
          t: 999,
        },
      ],
    })),
    "u1",
    "the launch moved before the review",
  );

  assert.equal(a.lines[0].atMs, 65_000);
  assert.equal(a.lines[0].atLabel, "1:05");
});

test("ACCEPTANCE: a near miss is never an answer", async () => {
  /* The whole reason the judge is in this path. `related` goes in `nearby`,
     which the page renders as a separate group under a lead that says so. */
  const d = db(QUOTES);
  const a = await ask(
    env(d, () => ({
      judgements: [
        { moment: "m1", verdict: "related", why: "Same evening, different point." },
        { moment: "m2", verdict: "related" },
      ],
    })),
    "u1",
    "who moved the launch",
  );

  assert.equal(a.lines.length, 0);
  assert.ok(a.nearby.length > 0);
  assert.equal(a.unchecked, false);
  assert.match(answerLead(a), /Nothing in your footage says that/);
});

test('ACCEPTANCE: "we could not check" is not "nothing backs this"', async () => {
  /*
   * The two answers a person acts on differently. A judge that threw leaves
   * `lines` empty, and reporting that as "nothing in your footage says that"
   * would send somebody to reshoot footage they already have.
   */
  const d = db(QUOTES);
  const a = await ask(
    env(d, () => {
      throw new Error("the model is down");
    }),
    "u1",
    "the launch moved before the review",
  );

  assert.equal(a.unchecked, true);
  assert.equal(a.lines.length, 0, "nothing may be presented as an answer");
  assert.ok(a.nearby.length > 0, "they were retrieved, which is true");
  assert.match(answerLead(a), /could not check/);
  assert.doesNotMatch(answerLead(a), /Nothing in your footage says/);
});

test("a judge that answered nothing is unchecked, not unanimous", async () => {
  /*
   * parseJudgements fills every gap with `unrelated` so a short answer
   * cannot shrink the set — so a call that said nothing arrives as a full
   * list of confident `unrelated`s. Reading those as verdicts is the trap
   * beat-find.ts documents, and here it would print a definite no.
   */
  const d = db(QUOTES);
  const a = await ask(env(d, () => ({ judgements: [] })), "u1", "the launch moved before the review");
  assert.equal(a.unchecked, true);
  assert.match(answerLead(a), /could not check/);
});

test("the most-recent fallback is refused, because it is not an answer", async () => {
  /*
   * findMaterial returns "your most recent moments" when a query matched
   * nothing. Handing those back is the lie this feature is most able to
   * tell — a confident answer made of whatever was filmed last.
   */
  const d = db(QUOTES);
  let asked = 0;
  const a = await ask(
    env(d, () => {
      asked += 1;
      return { judgements: [{ moment: "m1", verdict: "backs", sentence: 1 }] };
    }),
    "u1",
    "zzzz nothing in this library is about this zzzz",
  );
  assert.equal(a.how, "none");
  assert.equal(a.lines.length, 0);
  assert.equal(a.nearby.length, 0);
  assert.equal(asked, 0, "a model call to sort nothing is a model call for nothing");
  assert.match(answerLead(a), /Nothing in your footage is about that/);
});

test("an empty question costs nothing", async () => {
  const d = db(QUOTES);
  let asked = 0;
  const a = await ask(env(d, () => { asked += 1; return {}; }), "u1", "   ");
  assert.equal(asked, 0);
  assert.deepEqual([a.lines.length, a.nearby.length, a.how], [0, 0, "none"]);
});

test("the four leads are four different sentences", () => {
  /*
   * They read alike and mean different things, and a UI that collapsed any
   * two would be the failure invariant 4 is about. Also: no percentage
   * reaches a person — invariant 3.
   */
  const line = {
    momentId: "c0", sourceId: "s1", sourceTitle: "Tuesday",
    line: "x", quote: "x", atMs: 0, atLabel: "0:00", why: null,
  };
  const leads = [
    answerLead({ question: "q", lines: [line], nearby: [], how: "words", unchecked: false }),
    answerLead({ question: "q", lines: [], nearby: [line], how: "words", unchecked: false }),
    answerLead({ question: "q", lines: [], nearby: [], how: "none", unchecked: false }),
    answerLead({ question: "q", lines: [], nearby: [line], how: "words", unchecked: true }),
  ];
  assert.equal(new Set(leads).size, 4, `two of these say the same thing: ${JSON.stringify(leads)}`);
  for (const l of leads) assert.doesNotMatch(l, /\d+%/, "no percentage reaches a person");

  /* And it counts, because "3 lines say it" and "one line says it" are
     different amounts of evidence and the plural is not decoration. */
  assert.match(
    answerLead({ question: "q", lines: [line, line, line], nearby: [], how: "words", unchecked: false }),
    /3 lines/,
  );
});
