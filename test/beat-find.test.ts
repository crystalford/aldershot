/**
 * WHAT A BEAT FINDS, AND WHAT HAPPENS WHEN THE JUDGE DOES NOT ANSWER.
 *
 * The compose — retrieval, the judge, the rerank — lives in its own module
 * for this: the DEGRADATION is the part worth testing. A judge that throws
 * must cost the ordering and the coverage, never the beat, and a route is a
 * place where that cannot be checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { candidatesFor } from "../src/beat-find.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function db(quotes: string[]) {
  const d = new DatabaseSync(":memory:");
  for (const name of ["v2_users", "sources", "v2_clips", "v2_threads", "v2_clip_threads", "renders", "v2_projects"]) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
    for (const m of SCHEMA.matchAll(/ALTER TABLE (\w+) ADD COLUMN .*?;/gi)) {
      if (m[1].toLowerCase() === name) d.exec(m[0]);
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
    ).run(`c${i}`, i * 1000, i * 1000 + 900, q, i),
  );
  return d;
}

const env = (d: DatabaseSync, run: (input: Record<string, unknown>) => unknown) =>
  ({ DB: fakeD1(d), AI: { run: async (_m: string, input: Record<string, unknown>) => run(input) } }) as never;

const QUOTES = [
  "The house has a room that gets sun until four.",
  "Rent halves if I go, and I lose everyone.",
  "Okay is this recording.",
];

test("the judge's verdict is the order, and the coverage", async () => {
  const d = db(QUOTES);
  /* c2 is last out of retrieval and the only one that backs it. */
  const got = await candidatesFor(
    env(d, () => ({
      judgements: [
        { moment: "m1", verdict: "related" },
        { moment: "m2", verdict: "related" },
        { moment: "m3", verdict: "backs", sentence: 1 },
      ],
    })),
    "u1",
    "the house rent recording",
  );
  assert.equal(got.length, 3);
  assert.equal(got[0].backs, true, "the one that backs it is first");
  assert.ok(got.slice(1).every((g) => g.backs === false));
});

test("a judge that throws costs the ordering, not the beat", async () => {
  /*
   * A beat marked thin because a model call failed would send somebody to
   * reshoot footage they already have. The moments are all still there and
   * `backs` is null, which findForBeats reads as "nobody checked".
   */
  const d = db(QUOTES);
  const got = await candidatesFor(
    env(d, () => {
      throw new Error("the model is down");
    }),
    "u1",
    "the house rent recording",
  );
  assert.equal(got.length, 3);
  assert.ok(got.every((g) => g.backs === null));
});

test("a judge that answers nothing leaves every moment unchecked", async () => {
  const d = db(QUOTES);
  const got = await candidatesFor(env(d, () => ({})), "u1", "the house rent recording");
  assert.equal(got.length, 3);
  assert.ok(got.every((g) => g.backs === null), "an inferred unrelated is not a verdict about this beat");
});

test("a need that matches nothing is nothing, and the judge is never asked", async () => {
  /*
   * findMaterial answers an unmatched brief with "your most recent", which
   * is right for "eight minutes on whatever I have" and a lie for a beat —
   * it would fill the beat with unrelated footage and mark it healthy. And
   * a model call to sort nothing is a model call for nothing.
   */
  const d = db(QUOTES);
  let asked = 0;
  const got = await candidatesFor(
    env(d, () => {
      asked += 1;
      return {};
    }),
    "u1",
    "sourdough hydration percentages",
  );
  assert.deepEqual(got, []);
  assert.equal(asked, 0);
});

test("an empty library is nothing, not a crash", async () => {
  const d = db([]);
  assert.deepEqual(await candidatesFor(env(d, () => ({})), "u1", "anything"), []);
});
