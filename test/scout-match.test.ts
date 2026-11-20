/**
 * MATCH-BACK, REACHABLE AT LAST.
 *
 * `matchByTranscript` has been complete and heavily tested since missions
 * were built — fourteen call sites, every one of them in test/ — and nothing
 * in src/ has ever called it. The last step of the one flow that makes Scout
 * worth having was written, proved, and left unreachable.
 *
 * Scout finds and links (invariant 9), so a find on a platform that forbids
 * downloading is a GHOST plus a MISSION: go and get this, from here, at this
 * timestamp. This is what happens when the person comes back with it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { matchOpenMissions } from "../src/scout-match.ts";

const QUOTE = "get out of my chat and do not come back";

/** A transcript row whose words sit 400ms apart, the way the store keeps them. */
function segmentRow(text: string, fromS = 0, stepS = 0.4) {
  const ws = text.split(/\s+/).filter(Boolean);
  return {
    words: JSON.stringify(ws.map((w, i) => ({ w, s: fromS + i * stepS, e: fromS + i * stepS + stepS - 0.001 }))),
    text,
    start_ms: Math.round(fromS * 1000),
    end_ms: Math.round((fromS + ws.length * stepS) * 1000),
  };
}

function world(uploadText: string, missions: Array<{ id: string; quote: string; inS: number; state?: string }>) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE v2_projects (id TEXT PRIMARY KEY, user_id TEXT)`);
  db.exec(`CREATE TABLE segments (id TEXT PRIMARY KEY, source_id TEXT, idx INTEGER, start_ms INTEGER,
             end_ms INTEGER, speaker TEXT, text TEXT, words TEXT)`);
  db.exec(`CREATE TABLE scout_missions (id TEXT PRIMARY KEY, project_id TEXT, ledger_id TEXT,
             in_s REAL, out_s REAL, quote TEXT, url_at_in TEXT, state TEXT, how TEXT, verdict TEXT,
             coverage REAL, offset_s REAL, fail_reason TEXT, created_at INTEGER, expires_at INTEGER)`);
  db.prepare(`INSERT INTO v2_projects VALUES ('p1','u1')`).run();
  db.prepare(`INSERT INTO v2_projects VALUES ('p2','u2')`).run();

  const row = segmentRow(uploadText);
  db.prepare(`INSERT INTO segments VALUES ('seg1','src1',0,?,?,NULL,?,?)`).run(
    row.start_ms, row.end_ms, row.text, row.words,
  );

  let n = 0;
  for (const m of missions) {
    db.prepare(
      `INSERT INTO scout_missions (id, project_id, ledger_id, in_s, out_s, quote, state, created_at)
       VALUES (?, 'p1', ?, ?, ?, ?, ?, ?)`,
    ).run(m.id, "led-" + m.id, m.inS, m.inS + 5, m.quote, m.state ?? "scouted", ++n);
  }
  const stateOf = (id: string) =>
    db.prepare(`SELECT state, how, verdict, coverage, offset_s FROM scout_missions WHERE id=?`).get(id) as {
      state: string; how: string | null; verdict: string | null; coverage: number | null; offset_s: number | null;
    };
  return { db: fakeD1(db) as never, stateOf, raw: db };
}

test("ACCEPTANCE: the upload answers the mission, and the row says how", async () => {
  /*
   * The whole point of a mission. Not "thanks, attached" — the words match,
   * measured, with the offset from where the mission said they would be.
   */
  const w = world(`some preamble here ${QUOTE} and then he moved on`, [{ id: "m1", quote: QUOTE, inS: 1.2 }]);
  const filled = await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" });

  assert.equal(filled.length, 1);
  assert.equal(filled[0].missionId, "m1");
  assert.equal(filled[0].match.verdict, "verified");
  assert.equal(filled[0].match.method, "transcript");

  const row = w.stateOf("m1");
  assert.equal(row.state, "matched", "the mission is still open after the footage arrived");
  assert.equal(row.verdict, "verified");
  assert.equal(row.how, "transcript");
  assert.ok((row.coverage ?? 0) >= 0.9, `coverage ${row.coverage} was not recorded`);
  assert.equal(row.offset_s, 0);
});

test("ACCEPTANCE: unrelated footage does not fail the mission", async () => {
  /*
   * Every read sees every open mission, so most pairs do not match — that is
   * the normal case, not an error. An upload about something else must leave
   * the mission exactly as it was, waiting.
   */
  const w = world("a completely different recording about gardening", [{ id: "m1", quote: QUOTE, inS: 1.2 }]);
  const filled = await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" });

  assert.deepEqual(filled, []);
  const row = w.stateOf("m1");
  assert.equal(row.state, "scouted", "an unrelated upload closed the mission");
  assert.equal(row.verdict, null, "an unrelated upload wrote a verdict");
  assert.equal(row.coverage, null);
});

test("a near miss is not good enough, and still leaves the mission open", async () => {
  const w = world("get out of my chat and never speak to me again about this", [
    { id: "m1", quote: QUOTE, inS: 0 },
  ]);
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" }), []);
  assert.equal(w.stateOf("m1").state, "scouted");
});

test("ACCEPTANCE: one upload can answer two missions, because it is the same footage", async () => {
  /*
   * Across projects on purpose. An upload does not know which cut it was
   * for, and a clip that carries a moment two cuts were both waiting on
   * answers both — the transcript is a better judge than a folder.
   */
  const second = "and do not come back";
  const w = world(`${QUOTE} is what he said`, [
    { id: "m1", quote: QUOTE, inS: 0 },
    { id: "m2", quote: second, inS: 2.4 },
  ]);
  const filled = await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" });
  assert.deepEqual(filled.map((f) => f.missionId).sort(), ["m1", "m2"]);
  assert.equal(w.stateOf("m1").state, "matched");
  assert.equal(w.stateOf("m2").state, "matched");
});

test("a mission already answered is not answered again", async () => {
  const w = world(`${QUOTE} is what he said`, [{ id: "m1", quote: QUOTE, inS: 0, state: "matched" }]);
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" }), []);
});

test("a dropped mission stays dropped", async () => {
  const w = world(`${QUOTE} is what he said`, [{ id: "m1", quote: QUOTE, inS: 0, state: "dropped" }]);
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" }), []);
  assert.equal(w.stateOf("m1").state, "dropped");
});

test("ACCEPTANCE: another account's missions are not touched", async () => {
  const w = world(`${QUOTE} is what he said`, [{ id: "m1", quote: QUOTE, inS: 0 }]);
  /* m1 belongs to p1, which belongs to u1. Asking as u2 must see nothing. */
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u2", sourceId: "src1" }), []);
  assert.equal(w.stateOf("m1").state, "scouted");
});

test("a source with no word timings matches nothing rather than throwing", async () => {
  const w = world(`${QUOTE} is what he said`, [{ id: "m1", quote: QUOTE, inS: 0 }]);
  w.raw.prepare(`UPDATE segments SET words=NULL WHERE source_id='src1'`).run();
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" }), []);
  assert.equal(w.stateOf("m1").state, "scouted");
});

test("no open missions does no work at all", async () => {
  const w = world(`${QUOTE} is what he said`, []);
  assert.deepEqual(await matchOpenMissions(w.db, { userId: "u1", sourceId: "src1" }), []);
});

test("the read checks the missions, not only the library", () => {
  /*
   * The half that, left unchecked, is a feature that exists and never runs —
   * which is exactly what matchByTranscript already was.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "ingest.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  assert.match(src, /await matchOpenMissions\(env\.DB, \{ userId: src\.user_id, sourceId: src\.id \}\)/);
});
