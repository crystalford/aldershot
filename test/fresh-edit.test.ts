/**
 * Opening your own footage must not hand back the cut you already made.
 *
 * "i choose a clip to edit.. it puts me in the previously edited clip.. so
 * like.. if i wanted to start a new edit with the footage i'd have to
 * essentially undo what i did before. Again i brought this up from the
 * beginning."
 *
 * Two definitions of "is this edit yours yet" existed in one product. Projects
 * used TOUCHED — a brief, a cut, a beat, a render, or a name you typed — to
 * decide what was a real edit and what was just a row. `begin` used its own,
 * much weaker rule for whether an edit could be REUSED: "has no brief". An
 * edit you spent an hour cutting by hand has no brief either, so clicking the
 * video handed it straight back.
 *
 * Both halves have to hold at once, which is why they are tested together:
 * an untouched row is still picked up (or clicking around your library builds
 * a pile of empty edits, which is the complaint that produced reuse in the
 * first place), and a touched one never is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { schema } from "./helpers/fake-d1.ts";
import { TOUCHED } from "../src/projects.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.prepare(
    `INSERT INTO sources (id,user_id,title,cut_title,r2_key,transcript_state,created_at)
     VALUES ('s1','u1','DJI_0016','A cut about ads','u/u1/s1.mp4','ready',1)`,
  ).run();
  return db;
}

const project = (
  db: DatabaseSync,
  id: string,
  o: { title?: string; brief?: string | null; cuts?: string | null } = {},
) =>
  db
    .prepare(
      `INSERT INTO v2_projects (id,user_id,title,kind,source_id,brief,cuts,created_at,updated_at)
       VALUES (?, 'u1', ?, 'cut', 's1', ?, ?, 1, 1)`,
    )
    .run(id, o.title ?? "A cut about ads", o.brief ?? null, o.cuts ?? null);

/** Exactly the query begin() uses to decide whether to reuse. */
const reusable = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT id FROM v2_projects
        WHERE user_id='u1' AND source_id='s1' AND kind='cut'
          AND (brief IS NULL OR TRIM(brief)='')
          AND NOT ${TOUCHED}
          AND deleted_at IS NULL AND archived_at IS NULL
        ORDER BY updated_at DESC LIMIT 1`,
    )
    .get() as { id: string } | undefined;

test("an edit you have CUT is never handed back", async () => {
  /* The bug, exactly: an hour of hand-cutting, no brief anywhere near it. */
  const db = world();
  project(db, "p1", { cuts: '[{"seg":3}]' });
  assert.equal(reusable(db), undefined, "opening the footage reopened the cut you already made");
});

test("an edit you RENAMED is never handed back", async () => {
  const db = world();
  project(db, "p1", { title: "Boomer ads, take two" });
  assert.equal(reusable(db), undefined);
});

test("an edit with a beat in it is never handed back", async () => {
  const db = world();
  project(db, "p1");
  db.prepare(`INSERT INTO beats (id,project_id,idx,kind) VALUES ('b1','p1',0,'vo')`).run();
  assert.equal(reusable(db), undefined);
});

test("an edit you already exported is never handed back", async () => {
  const db = world();
  project(db, "p1");
  db.prepare(
    `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,state,created_at)
     VALUES ('r1','p1','u1','cut','mp4_1080','16:9','ready',1)`,
  ).run();
  assert.equal(reusable(db), undefined);
});

test("but an UNTOUCHED row is still reused, or the pile-up comes back", async () => {
  /*
   * The other half. Reuse exists because a row is created the moment you open
   * a video, and clicking around your own library used to leave twenty empty
   * "Untitled cut"s behind. An untouched row is not an edit yet.
   */
  const db = world();
  project(db, "p1");
  assert.equal(reusable(db)?.id, "p1", "clicking a video twice would make two edits");
});

test("an empty cuts array still counts as untouched", async () => {
  /* '[]' is what an edit that has been opened and not cut actually stores. */
  const db = world();
  project(db, "p1", { cuts: "[]" });
  assert.equal(reusable(db)?.id, "p1");
});

test("the newest untouched row wins, and a touched one beside it is ignored", async () => {
  const db = world();
  project(db, "cut-already", { cuts: '[{"seg":1}]' });
  project(db, "blank");
  assert.equal(reusable(db)?.id, "blank");
});
