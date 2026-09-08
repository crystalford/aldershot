/**
 * What you have finished, in one place.
 *
 * "i just rendered / exported a full video edit.. that should also be saved to
 * a place of finished or exported or whatever" — said the moment the first
 * export in this product's life worked.
 *
 * It was right, and it was the same gap twice. A rendered cut lived only in
 * the Exports strip inside the one edit that made it; a rendered short lived
 * nowhere at all, because Clipping listed videos and Footage's Clips tab lists
 * moments a MODEL found rather than files a USER made. Two surfaces, one
 * query, told apart by `kind`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { listFinished } from "../src/render-job.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.prepare(`INSERT INTO v2_projects (id,user_id,title,kind,created_at) VALUES ('p1','u1','The Cut','cut',1)`).run();
  db.prepare(`INSERT INTO sources (id,user_id,title,r2_key,transcript_state,created_at) VALUES ('s1','u1','A video','u/u1/s1.mp4','ready',1)`).run();
  db.prepare(`INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,kept,origin,created_at) VALUES ('c1','u1','s1',0,9000,'a line',1,'clipping',1)`).run();
  return { db, d1: fakeD1(db) as never };
}

const render = (
  db: DatabaseSync,
  id: string,
  o: { kind: string; state?: string; key?: string | null; project?: string | null; clip?: string | null; user?: string; at?: number },
) =>
  db
    .prepare(
      `INSERT INTO renders (id,project_id,user_id,kind,format,aspect,clip_id,r2_key,duration_s,state,created_at)
       VALUES (?,?,?,?, 'mp4_1080','16:9', ?,?, 30, ?, ?)`,
    )
    .run(id, o.project ?? null, o.user ?? "u1", o.kind, o.clip ?? null, o.key === undefined ? `u/u1/${id}.mp4` : o.key, o.state ?? "ready", o.at ?? 1);

test("a finished cut is named after the edit it came from", async () => {
  const w = world();
  render(w.db, "r1", { kind: "cut", project: "p1" });
  const [row] = await listFinished(w.d1, "u1", "cut");
  assert.equal(row.title, "The Cut");
  assert.equal(row.href, "/p/p1/cut", "no way back to the edit that made it");
});

test("a finished short is named after the video its clip came from", async () => {
  /* A short has no project, so naming it through the project would leave every
     one of them blank — which is what "Rendered a video" used to be. */
  const w = world();
  render(w.db, "r2", { kind: "short", clip: "c1" });
  const [row] = await listFinished(w.d1, "u1", "short");
  assert.equal(row.title, "A video");
  assert.equal(row.href, "/sources/s1", "Clipping is gone; a short points back at its footage");
});

test("the two kinds do not see each other", async () => {
  /* Footage and Clipping disagreed about a count once before, because two
     queries answered the same question differently. One query, one filter. */
  const w = world();
  render(w.db, "r1", { kind: "cut", project: "p1" });
  render(w.db, "r2", { kind: "short", clip: "c1" });
  assert.deepEqual((await listFinished(w.d1, "u1", "cut")).map((r) => r.id), ["r1"]);
  assert.deepEqual((await listFinished(w.d1, "u1", "short")).map((r) => r.id), ["r2"]);
});

test("asking for both kinds returns both", async () => {
  /* Exports asks for both, and it is the ONLY surface that lists a finished
     short now. If this narrows to one kind again, every short you rendered
     goes unreachable while still paying for its storage — which is exactly
     what deleting Clipping would have done on its own. */
  const w = world();
  render(w.db, "r1", { kind: "cut", project: "p1" });
  render(w.db, "r2", { kind: "short", clip: "c1" });
  const both = await listFinished(w.d1, "u1", ["cut", "short"]);
  assert.deepEqual(both.map((r) => r.id).sort(), ["r1", "r2"]);
});

test("asking for no kinds returns nothing rather than everything", async () => {
  /* An empty list must not fall through to an unfiltered query. */
  const w = world();
  render(w.db, "r1", { kind: "cut", project: "p1" });
  assert.deepEqual(await listFinished(w.d1, "u1", []), []);
});

test("only what actually finished", async () => {
  /* A render still running belongs on the surface that started it, where there
     is a Stop; a failed one is not something you have. */
  const w = world();
  render(w.db, "ok", { kind: "cut", project: "p1" });
  render(w.db, "running", { kind: "cut", project: "p1", state: "running" });
  render(w.db, "failed", { kind: "cut", project: "p1", state: "failed" });
  render(w.db, "nofile", { kind: "cut", project: "p1", key: null });

  const ids = (await listFinished(w.d1, "u1", "cut")).map((r) => r.id);
  assert.deepEqual(ids, ["ok"]);
});

test("never another account's video", async () => {
  const w = world();
  render(w.db, "mine", { kind: "cut", project: "p1" });
  render(w.db, "theirs", { kind: "cut", project: null, user: "u2" });
  const ids = (await listFinished(w.d1, "u1", "cut")).map((r) => r.id);
  assert.deepEqual(ids, ["mine"]);
});

test("a render whose edit was deleted still lists — the file is still yours", async () => {
  /* An inner join would have made it vanish, which is worse than a row with no
     title: the mp4 exists and is still being stored and billed. */
  const w = world();
  render(w.db, "orphan", { kind: "cut", project: null });
  const rows = await listFinished(w.d1, "u1", "cut");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].href, null, "it offered a link to a project that is gone");
});

test("newest first", async () => {
  const w = world();
  render(w.db, "old", { kind: "cut", project: "p1", at: 1 });
  render(w.db, "new", { kind: "cut", project: "p1", at: 2 });
  assert.deepEqual((await listFinished(w.d1, "u1", "cut")).map((r) => r.id), ["new", "old"]);
});
