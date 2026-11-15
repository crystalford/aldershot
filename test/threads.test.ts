/**
 * Threads, which nothing has ever written.
 *
 * `v2_threads` and `v2_clip_threads` have been read since the library
 * existed and written by nothing, so every account has had `thread_name:
 * null` on every moment and the room's third clause has never rendered. The
 * failures in a pass like this are all quiet: a chained cluster holding two
 * topics looks exactly like a thread, and a name taken from one member looks
 * exactly like a name.
 *
 * Every test here runs on synthetic vectors. The grouping is a measurement,
 * so it can be pinned without a model, which is the point of it being one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOIN_AT,
  MIN_MEMBERS,
  cluster,
  distinct,
  dot,
  nameFromPhrases,
  phrases,
  unit,
  writeThreads,
} from "../src/threads.ts";

/** A unit vector at `deg` around the first two axes, plus a third axis. */
const at = (deg: number, z = 0): number[] => {
  const r = (deg * Math.PI) / 180;
  return unit([Math.cos(r), Math.sin(r), z]);
};

test("close moments join, distant ones do not", () => {
  const groups = cluster([
    { id: "a", vec: at(0) },
    { id: "b", vec: at(8) },
    { id: "c", vec: at(16) },
    { id: "x", vec: at(90) },
    { id: "y", vec: at(98) },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual([...groups[0].members].sort(), ["a", "b", "c"]);
  assert.deepEqual([...groups[1].members].sort(), ["x", "y"]);
});

test("a moment on its own is a moment, not a thread", () => {
  /* The glossary: a thread is "a topic running through the footage". One
     occurrence has not run through anything. */
  const groups = cluster([
    { id: "a", vec: at(0) },
    { id: "b", vec: at(6) },
    { id: "lonely", vec: at(140) },
  ]);
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].members.includes("lonely"));
  assert.ok(MIN_MEMBERS >= 2);
});

test("average linkage, so a chain does not become one thread", () => {
  /*
   * THE FAILURE SINGLE LINKAGE PRODUCES. a—b—c—d—e each 25° from the next:
   * every neighbouring pair is close and the ends are 100° apart. Single
   * linkage walks the chain and returns one thread holding two topics,
   * which is indistinguishable from a real thread once it is written down.
   */
  const chain = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, vec: at(i * 25) }));
  const groups = cluster(chain);
  assert.ok(
    groups.every((g) => g.members.length < 5),
    "a 100°-wide chain must not come back as one thread",
  );
});

test("the same library twice gives the same threads, in the same order", () => {
  /*
   * Invariant 1's habit: everything in this product is re-produced rather
   * than stored as an outcome, so a pass that answered differently on two
   * identical runs would make a thread something nobody can reason about.
   * Exact float ties happen, and the tie-break is what makes this true.
   */
  const items = [
    { id: "m3", vec: at(4) },
    { id: "m1", vec: at(0) },
    { id: "m2", vec: at(2) },
    { id: "m9", vec: at(95) },
    { id: "m8", vec: at(92) },
  ];
  const a = cluster(items);
  const b = cluster([...items].reverse());
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("the most central moment comes first, with its distance to the middle", () => {
  /* A thread's sample quote is the first member, so "first" has to mean
     "most typical" rather than "whichever row came back first". */
  const g = cluster([
    { id: "edge", vec: at(-10) },
    { id: "middle", vec: at(0) },
    { id: "other", vec: at(10) },
  ])[0];
  assert.equal(g.members[0], "middle");
  assert.equal(g.confidence.length, g.members.length);
  assert.ok(g.confidence[0] >= g.confidence[1] - 1e-9);
  assert.ok(g.confidence[0] <= 1 + 1e-9);
  /* And it really is the cosine, not a rank dressed up as one. */
  assert.ok(g.confidence[0] > 0.98, `centre should sit near its centroid, got ${g.confidence[0]}`);
});

test("a vector of zeroes does not become a NaN that spreads", () => {
  /* An empty quote embeds to something, and dividing by its length is the
     classic way a whole pass comes back full of nulls. */
  assert.deepEqual(unit([0, 0, 0]), [0, 0, 0]);
  assert.equal(dot(unit([0, 0, 0]), at(0)), 0);
  const groups = cluster([
    { id: "a", vec: at(0) },
    { id: "b", vec: at(5) },
    { id: "empty", vec: [0, 0, 0] },
  ]);
  assert.ok(groups.every((g) => g.confidence.every((c) => Number.isFinite(c))));
});

test("the name is what the thread says and the library does not", () => {
  const group = [
    "The house has a room that gets sun until four.",
    "Mum keeps sending photos of the house like it's already mine.",
  ];
  const library = [
    ...group,
    "I think the honest version is I don't like who I am here.",
    "Every plan I make is a plan to be somewhere else in six months.",
    "If I leave, rent halves and I lose everyone I'd call at 2am.",
  ];
  assert.equal(nameFromPhrases(group, library), "the house");
});

test("one member's phrase is not the thread's name", () => {
  /*
   * The quiet one, and the first version of this test did not catch it:
   * written against three quotes that happened to share a phrase anyway, it
   * stayed green with the recurrence guard deleted. A vivid phrase said ONCE
   * reads perfectly as a thread name and describes a single moment — and the
   * rarer it is, the better it scores, so rarity alone picks exactly the
   * wrong thing.
   *
   * Here two of the three say "the rent" and one says a phrase that appears
   * nowhere else in the library at all. Without the guard the answer is a
   * fragment of that one quote.
   */
  const group = [
    "The rent is the cheap part of it.",
    "The rent went up again and I said nothing.",
    "You notice you already have, and then you do the paperwork.",
  ];
  const library = [
    ...group,
    "The rent on the flat is fine.",
    "The rent, honestly, is not the problem.",
    "Mum keeps sending photos like it's already mine.",
    "Every plan I make is a plan to be somewhere else.",
    "I don't like who I am here.",
  ];
  const name = nameFromPhrases(group, library);
  assert.equal(name, "the rent");
  assert.ok(
    group.filter((q) => q.toLowerCase().includes(name ?? "\u0000")).length >= 2,
    `"${name}" appears in fewer than two of the three`,
  );
});

test("a name has to carry a real word", () => {
  /* Stopwords are allowed INSIDE a name — the design's own are "why leave",
     "what it costs", "the house" — so they cannot be stripped. They just
     cannot be all of it. */
  for (const p of phrases("one of the things of the day")) {
    assert.ok(/[a-z]/.test(p), p);
    assert.ok(p !== "of the" && p !== "of" && p !== "the", `"${p}" is not a name`);
  }
  assert.ok(phrases("what it costs").includes("what it costs"), "stopwords inside a name survive");
});

test("the longer phrase wins when they say the same thing", () => {
  const group = ["what it costs is the thing", "what it costs, said plainly"];
  const name = nameFromPhrases(group, group.concat(["something else entirely here"]));
  assert.equal(name, "what it costs");
});

test("two threads may not wear the same name", () => {
  /* The chip is the only handle on a thread. Two chips reading the same
     thing are two things a person cannot tell apart. */
  const g = (name: string, n: number) => ({
    name,
    members: Array.from({ length: n }, (_, i) => `${name}-${i}`),
    confidence: Array.from({ length: n }, () => 1),
  });
  const out = distinct([g("the house", 3), g("the house", 2), g("what it costs", 2)]);
  assert.deepEqual(out.map((x) => x.name), ["the house", "what it costs"]);
});

test("writing threads replaces them, and never accumulates", () => {
  /*
   * A thread is derived, like a cut from its rules — not a thing a person
   * made. A pass that merged would leave yesterday's reading beside today's
   * and the chips would slowly stop describing the footage.
   */
  const sql: string[] = [];
  const db = {
    prepare: (s: string) => ({ bind: (...b: unknown[]) => ({ sql: s, b }) }),
    batch: async (stmts: Array<{ sql: string }>) => {
      sql.push(...stmts.map((s) => s.sql.replace(/\s+/g, " ").trim()));
      return [];
    },
  } as unknown as D1Database;

  return writeThreads(db, "u1", [
    { name: "the house", members: ["c1", "c2"], confidence: [0.9, 0.8] },
  ]).then((n) => {
    assert.equal(n, 1);
    assert.ok(sql[0].startsWith("DELETE FROM v2_clip_threads"), sql[0]);
    assert.ok(sql[1].startsWith("DELETE FROM v2_threads"), sql[1]);
    assert.ok(sql.some((s) => s.startsWith("INSERT INTO v2_threads")));
    assert.equal(sql.filter((s) => s.startsWith("INSERT INTO v2_clip_threads")).length, 2);
    /* One batch, so a pass that dies halfway does not leave a user with the
       deletes applied and none of the inserts. */
    assert.equal(sql.length, 5);
  });
});

test("the join threshold is a number somebody can move", () => {
  /* It is unmeasured and the file says so. What must not happen is it
     drifting to a value that joins everything or nothing. */
  assert.ok(JOIN_AT > 0.3 && JOIN_AT < 0.95, `JOIN_AT=${JOIN_AT} is not a threshold`);
  const spread = [
    { id: "a", vec: at(0) },
    { id: "b", vec: at(70) },
    { id: "c", vec: at(140) },
  ];
  assert.equal(cluster(spread).length, 0, "three unrelated moments are not a thread");
  assert.equal(cluster(spread, 0.0).length, 1, "and the threshold is what decides that");
});

/**
 * The staleness query, against real SQLite.
 *
 * It is the one part of threading that is SQL rather than arithmetic, and
 * the HAVING clause is the kind of thing that is wrong in a way no type
 * catches: a nested MAX over two aggregates, compared against a subquery
 * that returns NULL for an account with no threads yet. Both of those are
 * silent when wrong — the sweep simply never picks anybody up, and the
 * symptom is thread chips that quietly stop appearing.
 */
import { DatabaseSync } from "node:sqlite";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { rethread, staleThreadUsers } from "../src/threads.ts";

function seeded(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  sqlite.exec(`
    INSERT INTO v2_users (id, email) VALUES ('u1','a@x'), ('u2','b@x'), ('u3','c@x');
    INSERT INTO sources (id, user_id, title) VALUES ('s1','u1','A'), ('s2','u2','B'), ('s3','u3','C');
  `);
  return fakeD1(sqlite) as unknown as D1Database;
}

const clip = (db: D1Database, id: string, src: string, created: number, deleted: number | null = null) =>
  db
    .prepare(
      `INSERT INTO v2_clips (id, source_id, start_ms, end_ms, quote, kept, created_at, deleted_at)
       VALUES (?, ?, 0, 1000, 'q', 1, ?, ?)`,
    )
    .bind(id, src, created, deleted)
    .run();

const thread = (db: D1Database, id: string, user: string, created: number) =>
  db
    .prepare(`INSERT INTO v2_threads (id, user_id, name, clip_count, created_at) VALUES (?, ?, 'n', 1, ?)`)
    .bind(id, user, created)
    .run();

test("an account with moments and no threads at all is stale", async () => {
  /* The comparison is against zero, and a subquery over no rows returns
     NULL — which compares false to everything unless it is coalesced. This
     is the case that would leave every new account permanently unthreaded. */
  const db = seeded();
  await clip(db, "c1", "s1", 100);
  assert.deepEqual(await staleThreadUsers(db), ["u1"]);
});

test("an account whose threads are newer than its moments is left alone", async () => {
  const db = seeded();
  await clip(db, "c1", "s1", 100);
  await thread(db, "t1", "u1", 200);
  assert.deepEqual(await staleThreadUsers(db), []);
});

test("a moment DELETED since the threads were written makes them stale", async () => {
  /*
   * The one that would be missed. The library shrank, nothing was created,
   * and a thread goes on claiming three moments when one of them is gone.
   */
  const db = seeded();
  await clip(db, "c1", "s1", 100);
  await thread(db, "t1", "u1", 200);
  assert.deepEqual(await staleThreadUsers(db), [], "nothing has happened yet");
  await db.prepare(`UPDATE v2_clips SET deleted_at = 300 WHERE id = 'c1'`).run();
  assert.deepEqual(await staleThreadUsers(db), ["u1"]);
});

test("one account's new footage does not drag everybody else in", async () => {
  const db = seeded();
  await clip(db, "c1", "s1", 100);
  await thread(db, "t1", "u1", 200);
  await clip(db, "c2", "s2", 100);
  await thread(db, "t2", "u2", 50);
  await clip(db, "c3", "s3", 400);
  const stale = await staleThreadUsers(db);
  assert.deepEqual(stale, ["u2", "u3"]);
  assert.ok(!stale.includes("u1"));
});

test("the sweep takes a few accounts, not the whole platform", async () => {
  /* It embeds every quote it reads. A sweep that woke up and re-read every
     library on the platform would be a bill rather than a background task. */
  const db = seeded();
  await clip(db, "c1", "s1", 100);
  await clip(db, "c2", "s2", 100);
  await clip(db, "c3", "s3", 100);
  assert.equal((await staleThreadUsers(db, 2)).length, 2);
  assert.equal((await staleThreadUsers(db)).length, 3, "USERS_PER_SWEEP is 3");
});

/**
 * THE WHOLE PASS, end to end, with no model anywhere.
 *
 * Everything above tests a piece. This tests the wiring, which is the part
 * that has nothing else watching it: a pass that read the right moments,
 * grouped them correctly and then wrote them against the wrong user, or
 * dropped every group because the quote lookup missed, would pass every test
 * above it.
 */
test("read, grouped, named and written, with a stand-in embedder", async () => {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  sqlite.exec(`
    INSERT INTO v2_users (id, email) VALUES ('u1','a@x');
    INSERT INTO sources (id, user_id, title) VALUES ('s1','u1','A');
  `);
  const db = fakeD1(sqlite) as unknown as D1Database;

  const quotes: Array<[string, string]> = [
    ["c1", "The house has a room that gets sun until four."],
    ["c2", "Mum keeps sending photos of the house like it is already mine."],
    ["c3", "If I leave, the rent halves and I lose everyone I would call at 2am."],
    ["c4", "I keep pricing the rent because the other price is embarrassing."],
  ];
  for (const [id, quote] of quotes) {
    await db
      .prepare(
        `INSERT INTO v2_clips (id, source_id, start_ms, end_ms, quote, kept, created_at)
         VALUES (?, 's1', 0, 1000, ?, 1, 1)`,
      )
      .bind(id, quote)
      .run();
  }

  /* Two axes: one for the house, one for the rent. Deliberately crude —
     the grouping is already pinned above, and what is under test here is
     that the right vector reaches the right moment. */
  const embedder = async (texts: string[]) =>
    texts.map((t) => [/house/i.test(t) ? 1 : 0, /rent/i.test(t) ? 1 : 0, 0.01]);

  const out = await rethread({ DB: db } as never, "u1", { embedder });
  assert.equal(out.moments, 4);
  assert.equal(out.threads, 2, `wrote ${out.threads} threads, ${out.unnamed} unnamed`);

  const { results } = await db
    .prepare(`SELECT name, clip_count FROM v2_threads WHERE user_id = 'u1' ORDER BY name`)
    .all<{ name: string; clip_count: number }>();
  assert.deepEqual(
    (results ?? []).map((r) => ({ name: r.name, clip_count: r.clip_count })),
    [
      { name: "the house", clip_count: 2 },
      { name: "the rent", clip_count: 2 },
    ],
  );

  /* And the membership rows point at the real clips, which is the join the
     room reads to put a thread name on a moment card. */
  const joined = await db
    .prepare(
      `SELECT c.id AS clip, t.name AS thread
         FROM v2_clip_threads ct JOIN v2_threads t ON t.id = ct.thread_id
         JOIN v2_clips c ON c.id = ct.clip_id
        ORDER BY c.id`,
    )
    .all<{ clip: string; thread: string }>();
  assert.deepEqual(
    (joined.results ?? []).map((r) => ({ clip: r.clip, thread: r.thread })),
    [
      { clip: "c1", thread: "the house" },
      { clip: "c2", thread: "the house" },
      { clip: "c3", thread: "the rent" },
      { clip: "c4", thread: "the rent" },
    ],
  );

  /* Having written them, the account is no longer stale. */
  assert.deepEqual(await staleThreadUsers(db), []);
});

test("no embedder configured leaves the library alone rather than failing", async () => {
  /* Threads are an enrichment. An account with no Vectorize and no embedding
     model is the account this product shipped with, and it must read its
     footage exactly as before. */
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  sqlite.exec(`
    INSERT INTO v2_users (id, email) VALUES ('u1','a@x');
    INSERT INTO sources (id, user_id, title) VALUES ('s1','u1','A');
    INSERT INTO v2_clips (id, source_id, start_ms, end_ms, quote, kept, created_at)
      VALUES ('c1','s1',0,1,'a',1,1), ('c2','s1',0,1,'b',1,1);
  `);
  const db = fakeD1(sqlite) as unknown as D1Database;
  const out = await rethread({ DB: db } as never, "u1", { embedder: async () => null });
  assert.deepEqual(out, { threads: 0, moments: 2, unnamed: 0 });
});
