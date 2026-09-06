/**
 * Attaching media to a beat, and whose beat it is.
 *
 * `POST /api/beats/:beatId/record` takes the beat id straight out of the URL.
 * setBeatMedia was `WHERE id=?` with no owner check at all, so any signed-in
 * account could point ANY beat at an object under its own prefix — and the
 * victim's next export would presign it server-side and mux a stranger's
 * audio into their video.
 *
 * The shipped SQL is lifted from the source, so this cannot pass against a
 * copy that has drifted from what runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

function setBeatMediaQuery(): string {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "projects.ts"), "utf8");
  const m = /export async function setBeatMedia[\s\S]*?\.prepare\(\s*`([\s\S]*?)`/.exec(src);
  assert.ok(m, "couldn't find setBeatMedia's query in src/projects.ts");
  return m[1];
}

const ME = "U1";
const THEM = "U2";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE v2_projects(id TEXT PRIMARY KEY, user_id TEXT, deleted_at INTEGER);
    CREATE TABLE beats(id TEXT PRIMARY KEY, project_id TEXT, media_r2_key TEXT,
      recorded_at INTEGER, dur_ms INTEGER);
    INSERT INTO v2_projects VALUES('mine','U1',NULL);
    INSERT INTO v2_projects VALUES('theirs','U2',NULL);
    INSERT INTO v2_projects VALUES('binned','U1',123);
    INSERT INTO beats VALUES('b-mine','mine',NULL,NULL,NULL);
    INSERT INTO beats VALUES('b-theirs','theirs',NULL,NULL,NULL);
    INSERT INTO beats VALUES('b-binned','binned',NULL,NULL,NULL);
  `);
  const attach = (beatId: string, userId: string, key: string) =>
    db.prepare(setBeatMediaQuery()).run(key, Date.now(), 1000, beatId, userId).changes;
  const keyOf = (beatId: string) =>
    (db.prepare(`SELECT media_r2_key k FROM beats WHERE id=?`).get(beatId) as { k: string | null }).k;
  return { attach, keyOf };
}

test("you can attach a recording to your own beat", () => {
  const w = world();
  assert.equal(Number(w.attach("b-mine", ME, "u/U1/beats/b-mine.webm")), 1);
  assert.equal(w.keyOf("b-mine"), "u/U1/beats/b-mine.webm");
});

test("you cannot attach anything to somebody else's beat", () => {
  const w = world();
  assert.equal(
    Number(w.attach("b-theirs", ME, "u/U1/beats/evil.webm")),
    0,
    "a beat id from the URL is not proof of ownership",
  );
  assert.equal(w.keyOf("b-theirs"), null, "their beat still points at nothing");
});

test("a beat in a deleted project is not attachable either", () => {
  const w = world();
  assert.equal(Number(w.attach("b-binned", ME, "u/U1/beats/x.webm")), 0);
  assert.equal(w.keyOf("b-binned"), null);
});

test("a beat that does not exist reports no match rather than succeeding", () => {
  const w = world();
  assert.equal(Number(w.attach("b-nope", ME, "u/U1/beats/x.webm")), 0);
});
