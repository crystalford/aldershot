/**
 * WHAT YOUR LIBRARY CAN BACK — the Librarian's third question, standing.
 *
 * "It gets better the more you put in it" is a claim about an accumulating
 * pool, and until this exists nothing in the product can demonstrate it. The
 * row is supposed to move when you capture.
 *
 * Two rules do the work here, and both are older than this file:
 * "nobody checked" is not "nothing backs it" (src/plan.ts keeps
 * `backed === null` apart from `backed === 0`), and no aggregate without its
 * members (invariant 4 — every band expands to moments that resolve).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { standingFor, standingOf, standingLine, STANDINGS } from "../src/standing.ts";
import { THIN_BELOW } from "../src/plan.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE plans (id TEXT PRIMARY KEY, user_id TEXT, topic TEXT, claim TEXT,
             state TEXT, project_id TEXT, created_at INTEGER)`);
  db.exec(`CREATE TABLE plan_beats (id TEXT PRIMARY KEY, plan_id TEXT, idx INTEGER, role TEXT,
             name TEXT, need TEXT, kept INTEGER, found TEXT, backed INTEGER, by_user INTEGER)`);
  db.exec(`CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, deleted_at INTEGER, kept INTEGER)`);

  db.prepare(`INSERT INTO plans VALUES ('pl1','u1','Mars','Leaving is noticed, not decided.','found',NULL,2)`).run();

  let idx = 0;
  const beat = (o: {
    id: string; name?: string; found?: string[]; backed?: number | null; kept?: number; byUser?: number;
  }) =>
    db.prepare(
      `INSERT INTO plan_beats (id, plan_id, idx, role, name, need, kept, found, backed, by_user)
       VALUES (?, 'pl1', ?, 'subject', ?, 'what it has to show', ?, ?, ?, ?)`,
    ).run(
      o.id, idx++, o.name ?? o.id, o.kept ?? 1,
      o.found ? JSON.stringify(o.found) : null,
      o.backed === undefined ? null : o.backed,
      o.byUser ?? 0,
    );

  const clip = (id: string, alive = true) =>
    db.prepare(`INSERT INTO v2_clips VALUES (?, 'u1', ?, 1)`).run(id, alive ? null : 99);

  return { db: fakeD1(db) as never, beat, clip, raw: db };
}

/* ── The judgement, without a database ──────────────────────────────────── */

test("ACCEPTANCE: nobody checked is not nothing backs it", () => {
  /*
   * The distinction the whole report rests on, and the one src/plan.ts and
   * /api/ask both already refuse to blur. Collapsing them tells somebody
   * they have nothing when the truth is that nobody has looked.
   */
  assert.equal(standingOf({ backed: null, surviving: 3 }), "unchecked");
  assert.equal(standingOf({ backed: 0, surviving: 3 }), "nothing");
});

test("ACCEPTANCE: a beat before the stop is unchecked, not empty-handed", () => {
  /*
   * THE CASE THE UNIT TESTS MISSED AND THE LIVE FIXTURE CAUGHT.
   *
   * A plan at state "beats" — before the one stop — has no `found` and no
   * `backed`, so nothing survives because nothing was ever looked for. With
   * the survival check first, the board read "3 sections across your plans:
   * 3 it has nothing for" about a plan nobody had searched on.
   *
   * That is this file's whole distinction inverted, in the state every plan
   * passes through. Every other test here passed throughout.
   */
  assert.equal(standingOf({ backed: null, surviving: 0 }), "unchecked");
});

test("thin is little that backs it, not few results", () => {
  assert.equal(standingOf({ backed: THIN_BELOW - 1, surviving: 20 }), "thin");
  assert.equal(standingOf({ backed: THIN_BELOW, surviving: 20 }), "backed");
});

test("ACCEPTANCE: support that has been deleted is a gap, whatever the judge said", () => {
  /*
   * The one way a stored snapshot stops being an answer without anybody
   * touching the plan. `found` is from when retrieval ran; the moments in it
   * can be cut afterwards.
   */
  assert.equal(standingOf({ backed: 5, surviving: 0 }), "nothing");
});

/* ── Over a library ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: every band expands to moments that resolve", async () => {
  /* Invariant 4, as this engine's own check: no aggregate without its
     members. A band that cannot be expanded is not shippable. */
  const w = world();
  w.clip("c1");
  w.clip("c2");
  w.beat({ id: "b1", found: ["c1", "c2"], backed: 2 });

  const [row] = await standingFor(w.db, "u1");
  assert.equal(row.standing, "backed");
  assert.deepEqual(row.moments, ["c1", "c2"]);
  assert.equal(row.backed, 2);
});

test("ACCEPTANCE: a deleted moment drops out of the band it was backing", async () => {
  const w = world();
  w.clip("c1");
  w.clip("c2", false);
  w.beat({ id: "b1", found: ["c1", "c2"], backed: 2 });

  const [row] = await standingFor(w.db, "u1");
  assert.deepEqual(row.moments, ["c1"], "a deleted moment is still being counted as support");
});

test("ACCEPTANCE: gaps come first", async () => {
  /* Scout's board leads with what it could not fill because that is the next
     thing to do. The same reason applies here. */
  const w = world();
  w.clip("c1"); w.clip("c2");
  w.beat({ id: "backed", found: ["c1", "c2"], backed: 2 });
  w.beat({ id: "unchecked", found: ["c1"], backed: null });
  w.beat({ id: "nothing", found: [], backed: 0 });
  w.beat({ id: "thin", found: ["c1"], backed: 1 });

  const rows = await standingFor(w.db, "u1");
  assert.deepEqual(rows.map((r) => r.standing), ["nothing", "thin", "unchecked", "backed"]);
  assert.deepEqual(rows.map((r) => r.beatId), ["nothing", "thin", "unchecked", "backed"]);
});

test("a beat the person cut is not on the worklist", async () => {
  /* They said no. A list that keeps offering what you declined is a list you
     stop reading. */
  const w = world();
  w.beat({ id: "b1", found: [], backed: 0, kept: 0 });
  assert.deepEqual(await standingFor(w.db, "u1"), []);
});

test("another account's plans are not in it", async () => {
  const w = world();
  w.beat({ id: "b1", found: [], backed: 0 });
  assert.deepEqual(await standingFor(w.db, "u1").then((r) => r.length), 1);
  assert.deepEqual(await standingFor(w.db, "u2"), []);
});

test("a malformed found column is no moments rather than a thrown page", async () => {
  const w = world();
  w.beat({ id: "b1", backed: 2 });
  w.raw.prepare(`UPDATE plan_beats SET found='not json' WHERE id='b1'`).run();
  const [row] = await standingFor(w.db, "u1");
  assert.deepEqual(row.moments, []);
  assert.equal(row.standing, "nothing");
});

test("it carries whose sentence the beat is", async () => {
  /* A person's beat is a decision, not a suggestion, and the worklist should
     not read the same for both. */
  const w = world();
  w.clip("c1");
  w.beat({ id: "b1", found: ["c1"], backed: 1, byUser: 1 });
  const [row] = await standingFor(w.db, "u1");
  assert.equal(row.byUser, true);
});

/* ── The sentence ───────────────────────────────────────────────────────── */

test("ACCEPTANCE: the whole sentence, because the gate cannot check it", () => {
  /*
   * THE DISCIPLINE src/ui/pages/room.ts SETS FOR ITS ARCHIVE PARAGRAPH, and
   * the reason it sets it, quoted: the line is assembled from the person's
   * own data, "so it is text the data wrote and the strings rule cannot match
   * it against a prototype that holds a different library. That leaves the
   * scaffolding ... unchecked by the gate, so it is pinned by exact string in
   * test/archive.test.ts, which asserts the whole sentence rather than a
   * fragment of it for exactly this reason."
   *
   * Same bargain here. data-content buys the exemption; these assertions are
   * what pay for it.
   */
  assert.equal(
    standingLine([
      { standing: "backed" }, { standing: "thin" }, { standing: "nothing" }, { standing: "unchecked" },
    ] as never),
    "4 sections across your plans: 1 your footage backs, 1 it barely backs, 1 it has nothing for and 1 nobody has checked.",
  );
  assert.equal(
    standingLine([{ standing: "nothing" }] as never),
    "1 section across your plans: 1 it has nothing for.",
  );
  assert.equal(
    standingLine([{ standing: "backed" }, { standing: "backed" }] as never),
    "2 sections across your plans: 2 your footage backs.",
  );
  assert.equal(standingLine([]), "Nothing claimed yet — a plan is where a claim comes from.");
});

test("ACCEPTANCE: no percentage, and no score, reaches the sentence", () => {
  /* Invariant 3. Counts of things are facts the product already shows
     ("N clips · N edits"); a percentage is an invitation to argue with the
     number instead of with the reason. */
  const rows = [
    { standing: "backed" }, { standing: "thin" }, { standing: "nothing" }, { standing: "unchecked" },
  ] as never;
  const line = standingLine(rows);
  assert.ok(!/%/.test(line), "a percentage reached the sentence");
  assert.ok(!/\b0\.\d/.test(line), "a score reached the sentence");
  assert.match(line, /4 sections/);
  assert.match(line, /nothing for/);
});

test("an account with no plans is told so, not shown an empty box", () => {
  assert.match(standingLine([]), /Nothing claimed yet/);
});

test("one section reads as one, not as 1 sections", () => {
  assert.match(standingLine([{ standing: "nothing" }] as never), /^1 section across/);
});

test("the standings are ordered gaps-first in the declaration too", () => {
  /* RANK is derived from reading order nowhere — it is its own map — so this
     pins that the two agree, which is the kind of thing that drifts. */
  assert.deepEqual([...STANDINGS], ["nothing", "thin", "unchecked", "backed"]);
});
