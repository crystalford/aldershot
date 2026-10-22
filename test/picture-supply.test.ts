/**
 * THE PICTURE SUPPLY, and the two sources that have nothing behind them.
 *
 * src/pictures.ts was complete and unreachable: `allowed()` bit at the beat
 * insert, so asking for a generated card over a claim was refused, and
 * nothing ever OFFERED a picture — so `place()` and `reasonFor()` chose
 * between candidates only in their own tests.
 *
 * What is worth pinning here is not the arithmetic, which pictures.test.ts
 * already covers. It is the honesty: what gets called probative, what gets
 * named as missing rather than omitted, and that a query matching nothing
 * does not become a suggestion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { emptyNote, offerFor } from "../src/picture-supply.ts";

const SCHEMA = readFileSync(join(import.meta.dirname, "../migrations/schema.sql"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const TABLES = [
  "v2_users",
  "sources",
  "v2_projects",
  "v2_clips",
  "v2_threads",
  "v2_clip_threads",
  "renders",
  "plan_beats",
  "scout_runs",
  "scout_beats",
  "scout_sources",
  "scout_ledger",
  "scout_missions",
];

function db() {
  const d = new DatabaseSync(":memory:");
  for (const name of TABLES) {
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
  d.prepare(
    "INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,frame_r2_key,kept,created_at) " +
      "VALUES ('c1','u1','s1',65000,71000,'We moved the launch before the review came in.','score','',1,1)",
  ).run();
  return d;
}

/** A verified Scout find, which is the only kind externalMoments returns. */
function scoutFind(d: DatabaseSync, verify = "verified") {
  d.prepare(
    "INSERT INTO v2_projects (id,user_id,title,kind,created_at,updated_at) VALUES ('p1','u1','A cut','cut',1,1)",
  ).run();
  d.prepare("INSERT INTO scout_runs (id,project_id,trigger,created_at) VALUES ('r1','p1','plan',1)").run();
  d.prepare(
    "INSERT INTO scout_sources (id,run_id,adapter,external_id,url,title,transcript,fetched_at) " +
      "VALUES ('xs1','r1','youtube','vid1','https://example.org/watch?v=vid1','The Backseat Show','native',1)",
  ).run();
  d.prepare(
    "INSERT INTO scout_ledger (id,run_id,beat_id,role,source_id,quote_exact,quote_norm,word_span_json," +
      "t_start_s,t_end_s,verify,match_score,crowd_signals_n,created_at) " +
      "VALUES ('L1','r1',NULL,'subject','xs1','They shipped it knowing the brakes were going.','x','{}'," +
      "128,134,?,1,0,1)",
  ).run(verify);
}

const env = (d: DatabaseSync) => ({ DB: fakeD1(d) }) as never;

test("ACCEPTANCE: own footage is never called probative, because nothing checked", async () => {
  /*
   * `probative` means the thing it shows IS the thing being claimed rather
   * than near it. Retrieval returning a moment for this line says only that
   * the words are close — asserting more would be doc 08's opening problem
   * ("a related but non-probative picture makes a claim more likely to be
   * judged true") committed in the user's own footage.
   *
   * It costs nothing: own is the top tier of invariant 8's order, so the
   * probative bonus could only ever reorder own against own.
   */
  const d = db();
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  const own = o.considered.filter((c) => c.source === "own");
  assert.ok(own.length, "the line should have matched the seeded moment");
  for (const c of own) {
    assert.notEqual(c.probative, true, "own footage was asserted probative with nothing behind it");
    assert.equal(c.kind, "illustration");
  }
});

test("ACCEPTANCE: a verified Scout find IS probative, and that is a fact", async () => {
  /*
   * externalMoments selects on `l.verify = 'verified'`, which is the
   * deterministic verifier having matched the quote word for word against
   * the recording and read the time off word ids. A recording of somebody
   * saying the thing is the thing.
   */
  const d = db();
  scoutFind(d);
  const o = await offerFor(env(d), "u1", { line: "the brakes were going", move: "evidence" });
  const world = o.considered.filter((c) => c.source === "world");
  assert.equal(world.length, 1);
  assert.equal(world[0].probative, true);
  assert.equal(world[0].kind, "evidence");
  /* Invariant 9: Scout links and never downloads, so the way to look at it
     is the platform at its timestamp. */
  assert.match(world[0].href, /^https:\/\//);
  assert.equal(world[0].at, "2:08");
});

test("ACCEPTANCE: an unverified find is not offered at all", async () => {
  /* The ledger holds rejected rows on purpose — they are the measurement of
     the model's hallucination rate. Offering one as a picture would put an
     unchecked quote on screen under somebody's claim. */
  const d = db();
  scoutFind(d, "rejected");
  const o = await offerFor(env(d), "u1", { line: "the brakes were going", move: "evidence" });
  assert.equal(o.considered.filter((c) => c.source === "world").length, 0);
  assert.ok(o.empty.includes("world"));
});

test("ACCEPTANCE: the two unbuilt sources are named, not omitted", async () => {
  /*
   * An empty list and an absent source look identical and are not. A person
   * wondering why no document was suggested is owed "no documents added
   * yet" — the same discipline as invariant 4's reachable "nothing backs
   * this".
   */
  const d = db();
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  assert.ok(o.empty.includes("documents"));
  assert.ok(o.empty.includes("generated"));
  const note = emptyNote(o.empty);
  /* Case-insensitive: the note capitalises whichever clause lands first, so
     pinning the capital would pin the ORDER rather than the content. */
  assert.match(note, /no documents added yet/i);
  assert.match(note, /graphics are not built yet/);
});

test("a query that matched nothing is not a suggestion", async () => {
  /*
   * findMaterial answers "your most recent moments" when nothing matched.
   * Offering those as what could go on this line is the stock-gavel problem
   * with extra steps — a picture chosen because it was handy.
   */
  const d = db();
  const o = await offerFor(env(d), "u1", {
    line: "zzzz nothing in this library is about this zzzz",
    move: "context",
  });
  assert.equal(o.considered.length, 0);
  assert.ok(o.empty.includes("own"));
});

test("the refusal reaches the offer, with the reason", async () => {
  /*
   * Invariant 8 end to end. A CLAIM wants the speaker's own footage, so the
   * verified outside find — probative, evidence, the strongest thing in the
   * pile — is still refused over a claim, and the offer says why rather
   * than quietly returning nothing.
   */
  const d = db();
  scoutFind(d);
  const o = await offerFor(env(d), "u1", { line: "the brakes were going", move: "claim" });
  const refusedWorld = o.placed.refused.find((r) => r.id === "L1");
  assert.ok(refusedWorld, `nothing refused: ${JSON.stringify(o.placed)}`);
  assert.ok(refusedWorld.reason.length > 0);
});

test("a reprise of footage already in the cut loses to one that is not", async () => {
  /*
   * Doc 08's novelty penalty, and the thing that makes it work is that both
   * sides key on the FILE. A title would make two uploads of one recording
   * look like two subjects, and the cut's own side of the comparison is a
   * block's mediaKey, which is a file.
   */
  const d = db();
  d.prepare(
    "INSERT INTO sources (id,user_id,title,origin,r2_key,transcript_state,created_at) " +
      "VALUES ('s2','u1','Wednesday','upload','u1/s2.mp4','ready',2)",
  ).run();
  d.prepare(
    "INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,frame_r2_key,kept,created_at) " +
      "VALUES ('c2','u1','s2',1000,5000,'We moved the launch before the review came in, again.','score','',1,2)",
  ).run();

  const fresh = await offerFor(env(d), "u1", {
    line: "the launch moved before the review",
    move: "context",
    seen: new Set(["u1/s1.mp4"]),
  });
  assert.ok(fresh.placed.picture, "something should have been chosen");
  assert.equal(
    fresh.placed.picture.subject,
    "u1/s2.mp4",
    "the already-shown file won anyway, so the penalty keyed on nothing",
  );
});
