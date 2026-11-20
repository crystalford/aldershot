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
  "beats",
  "documents",
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

test("ACCEPTANCE: a source with nothing in it is named, not omitted", async () => {
  /*
   * An empty list and an absent source look identical and are not. A person
   * wondering why no document was suggested is owed a sentence — the same
   * discipline as invariant 4's reachable "nothing backs this".
   *
   * `documents` and `generated` were BOTH in this list as unbuilt until they
   * had a supply. Documents is named for a different reason now — nothing
   * the maker has added is about this line, which is a fact about their
   * library rather than about the product — and generated is never named
   * here at all, because a card is made from the line and a line with words
   * always has one.
   */
  const d = db();
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  assert.ok(o.empty.includes("documents"));
  assert.ok(!o.empty.includes("generated"), "a card is always available on a line with words");
  const note = emptyNote(o.empty);
  /* Case-insensitive: the note capitalises whichever clause lands first, so
     pinning the capital would pin the ORDER rather than the content. */
  assert.match(note, /no document you have added is about this line/i);
});

test("the generated tier is always available on a line with words", async () => {
  /*
   * It was the unbuilt one. It is a card of the line itself now — doc 08's
   * "a quote's words lift from the page into kinetic type" — so there is
   * nothing to retrieve and nothing to call, and the only way it is empty is
   * a line with no words on it.
   *
   * NOT PROBATIVE, and explicitly so: setting a sentence in type is not
   * evidence the sentence is true.
   */
  const d = db();
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  const card = o.considered.find((c) => c.source === "generated");
  assert.ok(card, "no card was offered for a line with words");
  assert.equal(card.kind, "synthetic");
  assert.equal(card.probative, false);
  assert.ok(!o.empty.includes("generated"));
});

test("a line with no words has no card to offer", async () => {
  const d = db();
  const o = await offerFor(env(d), "u1", { line: "   ", move: "context" });
  assert.ok(o.empty.includes("generated"));
  assert.match(emptyNote(o.empty), /no words on this line to set/);
});

test("a card is refused over a claim and over its proof", async () => {
  /*
   * Invariant 8's hard half, now that something actually offers a generated
   * picture: "generated is never photoreal and never over a claim or its
   * proof". Phase 5's named acceptance, reached through the supply rather
   * than through a hand-built candidate.
   */
  const d = db();
  for (const move of ["claim", "evidence"] as const) {
    const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move });
    const no = o.placed.refused.find((r) => r.id === "card");
    assert.ok(no, `${move} did not refuse the card: ${JSON.stringify(o.placed.refused)}`);
    assert.match(no.reason, /generated picture cannot carry/);
  }
});

/** A document in the library, with or without the maker's marking. */
function doc(d: DatabaseSync, id: string, title: string, note: string | null) {
  d.prepare(
    "INSERT INTO documents (id,user_id,title,note,filename,media_type,r2_key,bytes,created_at) " +
      "VALUES (?,'u1',?,?,?,'application/pdf',?,1024,1)",
  ).run(id, title, note, `${id}.pdf`, `u/u1/documents/${id}`);
}

test("ACCEPTANCE: a marked document is probative; an unmarked one is not", async () => {
  /*
   * Doc 08 wants "the proof itself — the document with its line marked", and
   * nothing in this codebase reads a PDF to find the line. So the marking is
   * the maker's own sentence about what it shows — invariant 10 — and
   * without one the document is still a document, still above the open
   * world, and NOT proof: "with its line marked" is the half missing.
   */
  const d = db();
  doc(d, "d1", "Launch review memo", "The review was dated after the launch went out.");
  doc(d, "d2", "Launch review memo scan", null);

  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  const marked = o.considered.find((c) => c.id === "d1");
  const bare = o.considered.find((c) => c.id === "d2");

  assert.ok(marked, "a marked document about this line was not offered");
  assert.equal(marked.source, "documents");
  assert.equal(marked.probative, true);

  assert.ok(bare, "an unmarked document about this line was not offered at all");
  assert.notEqual(bare.probative, true);
});

test("ACCEPTANCE: an unmarked document cannot carry evidence", async () => {
  /*
   * The consequence, end to end: `allowed()` refuses a candidate on an
   * EVIDENCE line when probative is explicitly FALSE, which is what the
   * supply says about a document nobody has marked.
   *
   * NOT "nothing is placed" — own footage is legitimately allowed on an
   * evidence line, because doc 08's source order for EVIDENCE is "own
   * footage → user's documents" and we do not claim to know whether a
   * moment is probative. Asserting null here passed for the wrong reason
   * the first time and then failed for the right one.
   */
  const d = db();
  doc(d, "d2", "Launch review memo scan", null);
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "evidence" });

  const no = o.placed.refused.find((r) => r.id === "d2");
  assert.ok(no, `the unmarked document was not refused: ${JSON.stringify(o.placed)}`);
  assert.match(no.reason, /about the subject rather than evidence of it/);
  assert.notEqual(o.placed.picture?.id, "d2", "an unmarked document was placed as proof");
});

test("and a marked one can", async () => {
  /* The other direction, or the test above passes for a document that could
     never win regardless of its marking. */
  const d = db();
  doc(d, "d1", "Launch review memo", "The review was dated after the launch went out.");
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "evidence" });
  assert.ok(
    !o.placed.refused.some((r) => r.id === "d1"),
    `a marked document was refused as proof: ${JSON.stringify(o.placed.refused)}`,
  );
});

test("a document that is not about the line is not offered", async () => {
  /* Word overlap, measured — the house rule. A library is tens of items, so
     the alternative to a measurement here would be a model call per line to
     answer a question a set intersection answers. */
  const d = db();
  doc(d, "d3", "Parking permit", "The permit for the yard, renewed in June.");
  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  assert.equal(o.considered.filter((c) => c.source === "documents").length, 0);
  assert.ok(o.empty.includes("documents"));
});

test("a document put away stops being offered, and is not deleted", async () => {
  /* Invariant 6. The row stays, the file stays, the offer stops. */
  const d = db();
  doc(d, "d1", "Launch review memo", "The review was dated after the launch went out.");
  d.prepare("UPDATE documents SET removed_at = 1 WHERE id = 'd1'").run();

  const o = await offerFor(env(d), "u1", { line: "the launch moved before the review", move: "context" });
  assert.equal(o.considered.filter((c) => c.source === "documents").length, 0);
  assert.equal(
    (d.prepare("SELECT COUNT(*) AS n FROM documents WHERE id = 'd1'").get() as { n: number }).n,
    1,
    "the row was deleted",
  );
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
  /* The card is always there — it is made from the line, not found — so what
     this test is about is that nothing was RETRIEVED. */
  assert.equal(o.considered.filter((c) => c.source !== "generated").length, 0);
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
