/**
 * The editing copy.
 *
 * The editor plays and scrubs the ORIGINAL — 45 to 180 minutes, routinely
 * gigabytes, opened twice at once (the player and the thumbnail decoder), and
 * seeked every time you click a word. A 480p copy with a keyframe every two
 * seconds is what makes that feel like an editor.
 *
 * The design said Cloudflare Stream. Stream bills per minute stored REGARDLESS
 * OF FILE SIZE, so a small copy costs what the master costs, for ever, on a
 * product that deletes nothing. R2 is about a tenth of it with no egress.
 *
 * The invariant these exist to protect: WHAT YOU WATCH IS NOT WHAT YOU RENDER.
 * If an export ever comes off the proxy, 4K becomes a 480p upscale and nobody
 * finds out until they open the file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { playableKey } from "../src/sources.ts";
import { proxyKeyFor } from "../src/proxy.ts";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { edlForProject } from "../src/render-job.ts";

test("a video with an editing copy plays the copy", () => {
  assert.equal(
    playableKey({ r2_key: "u/1/sources/a/original.mp4", proxy_r2_key: "u/1/sources/a/original.edit.mp4" }),
    "u/1/sources/a/original.edit.mp4",
  );
});

test("a video without one plays the original, which is a working state", () => {
  /* Footage read before this existed, a copy still being made, and a copy that
     failed are all this case. None of them is an error. */
  assert.equal(playableKey({ r2_key: "u/1/sources/a/original.mp4", proxy_r2_key: null }), "u/1/sources/a/original.mp4");
  assert.equal(playableKey({ r2_key: "u/1/sources/a/original.mp4" }), "u/1/sources/a/original.mp4");
});

test("an empty key is not a copy", () => {
  /* A blank string in the column would otherwise resolve to /media/ and 404. */
  assert.equal(playableKey({ r2_key: "orig.mp4", proxy_r2_key: "" }), "orig.mp4");
});

test("the copy's key is derived, so a retry overwrites rather than piles up", () => {
  assert.equal(proxyKeyFor("u/1/sources/a/original.mp4"), "u/1/sources/a/original.edit.mp4");
  assert.equal(proxyKeyFor("u/1/sources/a/original.MOV"), "u/1/sources/a/original.edit.mp4");
  /* Twice is the same answer — that is the whole point of deriving it. */
  assert.equal(proxyKeyFor("u/1/sources/a/original.mp4"), proxyKeyFor("u/1/sources/a/original.mp4"));
});

test("the copy is never mistaken for a source to copy again", () => {
  /* Handed its own output it must return it unchanged. Without that, a key
     that finds its way back round — a bad join, a backfill reading the wrong
     column — makes original.edit.edit.mp4: a 480p copy of a 480p copy, which
     is what the editor would then play. */
  assert.equal(proxyKeyFor("u/1/sources/a/original.edit.mp4"), "u/1/sources/a/original.edit.mp4");
});

test("THE EXPORT STILL COMES OFF THE MASTER", async () => {
  /*
   * The one that matters. Every surface plays the 480p copy; the render must
   * not, or a 4K export is an upscale of a preview and the file is quietly
   * wrong. This asserts against the real edlForProject rather than by reading
   * the code.
   */
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.prepare(
    `INSERT INTO sources (id,user_id,title,r2_key,proxy_r2_key,transcript_state,created_at)
     VALUES ('s1','u1','A video','u/u1/sources/s1/original.mp4','u/u1/sources/s1/original.edit.mp4','ready',1)`,
  ).run();
  db.prepare(
    `INSERT INTO v2_projects (id,user_id,title,kind,source_id,created_at)
     VALUES ('p1','u1','The Cut','cut','s1',1)`,
  ).run();
  db.prepare(
    `INSERT INTO segments (id,source_id,idx,start_ms,end_ms,text,words)
     VALUES ('g1','s1',0,0,4000,'hello there',NULL)`,
  ).run();

  const env = { DB: fakeD1(db) } as never;
  const project = { id: "p1", user_id: "u1", source_id: "s1", cuts: null, block_order: null } as never;
  const built = await edlForProject(env, project, "u1");

  assert.ok(built, "nothing was built");
  assert.ok(built.edl.cuts.length > 0, "the EDL was empty");
  for (const cut of built.edl.cuts) {
    assert.equal(
      cut.sourceKey,
      "u/u1/sources/s1/original.mp4",
      "the export was built from the editing copy — a 4K render would be a 480p upscale",
    );
  }
});
