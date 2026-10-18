/**
 * THE WORDS RETRIEVER CAN SEE THE WHOLE LIBRARY NOW.
 *
 * It ranked `listMoments(…, 200)` — the two hundred most recent moments —
 * so on a library of thousands the words half of hybrid retrieval was blind
 * to everything older. The comment in src/assemble.ts celebrates letting
 * words run beside the vector so "a proper name, a number, a piece of
 * jargon" can surface what the embedding missed, and that was true only of
 * footage read this month.
 *
 * Against the real DDL out of migrations/schema.sql, for the reason
 * test/scout-store.test.ts gives: a schema retyped into a test can be
 * retyped wrong in the same direction as the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { searchAny } from "../src/library.ts";
import { tokens } from "../src/bm25.ts";
import { findMaterial } from "../src/assemble.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function db(moments: Array<{ quote: string; title?: string }>) {
  const d = new DatabaseSync(":memory:");
  for (const name of ["v2_users", "sources", "v2_clips", "v2_threads", "v2_clip_threads", "renders", "v2_projects"]) {
    const ddl = SCHEMA.split(";").find((s) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(s),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
    /* And the columns added after the fact. SELECT_MOMENTS reads
       s.proxy_r2_key, which lives in ADDED_COLUMNS rather than in the
       CREATE — a fixture built from the CREATE alone answers "no such
       column" from inside whatever is really being tested. */
    for (const m of SCHEMA.matchAll(/ALTER TABLE (\w+) ADD COLUMN .*?;/gi)) {
      if (m[1].toLowerCase() === name) d.exec(m[0]);
    }
  }
  d.prepare("INSERT INTO v2_users (id,email,created_at) VALUES ('u1','a@b.c',1)").run();

  const titles = [...new Set(moments.map((m) => m.title ?? "Tuesday"))];
  titles.forEach((t, i) =>
    d.prepare(
      "INSERT INTO sources (id,user_id,title,origin,r2_key,transcript_state,created_at) " +
        "VALUES (?,'u1',?,'upload',?, 'ready',1)",
    ).run(`s${i}`, t, `u1/s${i}.mp4`),
  );
  moments.forEach((m, i) =>
    d.prepare(
      "INSERT INTO v2_clips (id,user_id,source_id,start_ms,end_ms,quote,origin,frame_r2_key,kept,created_at) " +
        "VALUES (?,'u1',?,?,?,?,'score','',1,?)",
    ).run(`c${i}`, `s${titles.indexOf(m.title ?? "Tuesday")}`, i * 1000, i * 1000 + 900, m.quote, i),
  );
  return fakeD1(d) as unknown as D1Database;
}

test("a moment older than the two hundred most recent is still found", () => {
  /*
   * THE HOLE THIS CLOSES. The old ranker never saw this row, so a brief
   * mentioning the one word that appears in it returned nothing from the
   * words retriever — on an account where the vector index was also missing
   * it, that is a moment the product could not reach at all.
   */
  const many = Array.from({ length: 300 }, (_, i) => ({ quote: `an ordinary line number ${i}` }));
  const d = db([{ quote: "the turpentine smelled like my grandfather" }, ...many]);
  return searchAny(d, "u1", tokens("turpentine")).then((got) => {
    assert.equal(got.length, 1);
    assert.match(got[0].quote, /turpentine/);
  });
});

test("ANY of the words, not all of them", async () => {
  /*
   * A brief is a sentence and no single moment contains all of it.
   * Narrowing is right for a search box and wrong for retrieval, where the
   * ranker decides and the matcher only has to not miss anything.
   */
  const d = db([{ quote: "the kitchen tap drips" }, { quote: "the garden is overgrown" }]);
  const got = await searchAny(d, "u1", tokens("the bits about the kitchen and the garden"));
  assert.equal(got.length, 2);
});

test("the title counts, because a moment is about what its video is about", async () => {
  const d = db([{ quote: "I never say the word", title: "Tuesday — the kitchen one" }]);
  assert.equal((await searchAny(d, "u1", ["kitchen"])).length, 1);
});

test("no usable terms is nothing, not the whole library", async () => {
  const d = db([{ quote: "something" }]);
  assert.deepEqual(await searchAny(d, "u1", []), []);
  assert.deepEqual(await searchAny(d, "u1", ["a", "of"]), [], "and nothing shorter than three letters");
});

test("a brief with a dozen content words is capped rather than refused", async () => {
  /*
   * Every term is two LIKEs over every row. Six is the ceiling searchExact
   * already uses; the seventh content word adds candidates nobody will
   * read. Capped, not refused — a long brief must still retrieve.
   */
  const d = db([{ quote: "the kitchen tap drips" }]);
  const got = await searchAny(d, "u1", ["kitchen", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
  assert.equal(got.length, 1, "the first six terms include the one that matches");
});

test("one person's library is not another's", async () => {
  const d = db([{ quote: "the kitchen tap drips" }]);
  assert.deepEqual(await searchAny(d, "u2", ["kitchen"]), []);
});

test("a long brief still only asks the database about six words", () => {
  /*
   * Every term is two LIKEs over every row of the library, so the cap is a
   * cost ceiling rather than a result. Nothing about the ROWS changes when
   * it is removed, which is why this watches the SQL: the first version of
   * this file tested only the rows and passed with the cap at sixty.
   */
  const d = db([{ quote: "the kitchen tap drips" }]);
  const asked: string[] = [];
  const spy = {
    prepare(sql: string) {
      asked.push(sql);
      return d.prepare(sql);
    },
  } as unknown as D1Database;
  return searchAny(spy, "u1", ["one", "two", "three", "four", "five", "six", "seven", "eight"]).then(() => {
    const likes = (asked.join(" ").match(/LIKE \?/g) ?? []).length;
    assert.equal(likes, 12, "six terms, quote and title each");
  });
});

/* ── And the retriever it feeds ─────────────────────────────────────────── */

test("findMaterial reaches a moment older than the two hundred most recent", async () => {
  /*
   * THE WHOLE POINT, at the level somebody actually calls. The words half
   * of hybrid retrieval ranked listMoments(…, 200), so this moment existed
   * and was unreachable — and on an account with no vector index, which is
   * every account in local development and any account whose backfill has
   * not run, it was unreachable by any path at all.
   */
  const many = Array.from({ length: 300 }, (_, i) => ({ quote: `an ordinary line number ${i}` }));
  const d = db([{ quote: "the turpentine smelled like my grandfather" }, ...many]);
  /* No VECTORIZE: searchMeaning answers null, so this measures the words
     retriever alone, which is the half under test. */
  const found = await findMaterial({ DB: d } as never, "u1", "something about turpentine");
  assert.equal(found.how, "words");
  assert.match(found.moments[0].quote, /turpentine/);
});

test("findMaterial ranks the rare word above the common one", async () => {
  const d = db([
    { quote: "the house again" },
    { quote: "another house" },
    { quote: "a house, still" },
    { quote: "turpentine and a rag" },
  ]);
  const found = await findMaterial({ DB: d } as never, "u1", "house turpentine");
  assert.match(found.moments[0].quote, /turpentine/, "BM25's IDF, through the real entry point");
});

test("findMaterial with nothing matching falls back to the most recent, and says so", async () => {
  const d = db([{ quote: "the kitchen tap drips" }]);
  const found = await findMaterial({ DB: d } as never, "u1", "sourdough hydration");
  assert.equal(found.how, "recent");
  assert.equal(found.moments.length, 1, "a starting point rather than an answer");
});
