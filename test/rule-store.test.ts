/**
 * Rules, stored and read back.
 *
 * Invariant 1: a cut is re-produced from rules, never stored as an outcome.
 * The beats table has always stored the outcome; until the rules table existed
 * that was ALL there was, so an assembled cut could not be re-produced at all
 * and nothing could be switched off because nothing had been written down.
 *
 * Every failure in a round trip like this is silent. A rule that comes back
 * with its order dropped produces a cut in a sequence nobody chose; one that
 * comes back with `on` inverted produces the opposite cut; and both look
 * completely healthy on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveRules, loadRules } from "../src/rule-store.ts";
import { compute, type Rule } from "../src/rules.ts";

/** An in-memory stand-in for the one table these two functions touch. */
function fakeDb() {
  let rows: Array<Record<string, unknown>> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...b: unknown[]) => ({
        run: async () => {
          if (/^DELETE/.test(sql)) rows = [];
        },
        all: async () => ({ results: [...rows].sort((a, b2) => (a.idx as number) - (b2.idx as number)) }),
        /* What batch() will replay. */
        __insert: () => {
          const cols = (sql.match(/\(([^)]+)\)\s*\n?\s*VALUES/) ?? [])[1]?.split(",").map((c) => c.trim()) ?? [];
          rows.push(Object.fromEntries(cols.map((c, i) => [c, b[i]])));
        },
      }),
    }),
    batch: async (stmts: Array<{ __insert: () => void }>) => {
      for (const st of stmts) st.__insert();
      return [];
    },
  } as never;
  return db;
}

const round = async (rules: Rule[]): Promise<Rule[]> => {
  const db = fakeDb();
  await saveRules(db, "p1", rules);
  return loadRules(db, "p1");
};

test("a rule's name survives the save, because everything else holds it", async () => {
  /*
   * The row id is re-minted on every save — saving replaces the list — so
   * anything outside the table that refers to a rule has to hold the rule's
   * own name instead. Measured before this existed: toggling one rule off
   * changed all four rules' ids, and only a full page reload hid it. The next
   * thing to hold a rule id (a reorder, an undo) would not have been so lucky.
   */
  const rules: Rule[] = [
    { id: "r-core", kind: "keep", tag: "core", on: true },
    { id: "r-cap", kind: "cap", secs: 120, on: true },
  ];
  const db = fakeDb();
  await saveRules(db, "p1", rules);
  const once = await loadRules(db, "p1");
  assert.deepEqual(once.map((r) => r.id), ["r-core", "r-cap"]);

  /* Save what came back, twice more. The names must not move. */
  await saveRules(db, "p1", once.map((r) => (r.id === "r-cap" ? { ...r, on: false } : r)));
  const twice = await loadRules(db, "p1");
  assert.deepEqual(twice.map((r) => r.id), ["r-core", "r-cap"]);
  assert.equal(twice.find((r) => r.id === "r-cap")!.on, false);
});

test("a rule set survives the round trip, in order", async () => {
  const rules: Rule[] = [
    { id: "a", kind: "keep", tag: "core", on: true, text: "Keep the parts where you're working something out." },
    { id: "b", kind: "drop", tag: "housekeeping", on: false, text: "Take out the hellos." },
    { id: "c", kind: "order", order: "open", on: true, text: "Start on the sharpest line." },
    { id: "d", kind: "cap", secs: 120, on: true, text: "Keep it under 2 minutes." },
    { id: "e", kind: "keep", cid: "clip7", on: true, hand: true },
    { id: "f", kind: "keep", tag: "strong", on: true, wins: true },
  ];
  const back = await round(rules);

  assert.deepEqual(back.map((r) => r.kind), ["keep", "drop", "order", "cap", "keep", "keep"]);
  assert.equal(back[1].on, false, "off is a state, not a deletion — nothing here is deleted");
  assert.equal(back[2].order, "open", "the order survives, or the cut is built in a sequence nobody chose");
  assert.equal(back[3].secs, 120);
  assert.equal(back[4].hand, true);
  assert.equal(back[5].wins, true);
  assert.equal(back[0].text, "Keep the parts where you're working something out.");
});

test("one named moment comes back as cid, several as cids", async () => {
  /* The engine's matcher reads both, and a one-element array would send every
     single-moment rule down the slower path for nothing. */
  const [one, many] = await round([
    { id: "a", kind: "keep", cid: "c1", on: true },
    { id: "b", kind: "drop", cids: ["c2", "c3"], on: true },
  ]);
  assert.equal(one.cid, "c1");
  assert.equal(one.cids, undefined);
  assert.deepEqual(many.cids, ["c2", "c3"]);
  assert.equal(many.cid, undefined);
});

test("a stored order that is not one of the three is dropped, not passed through", async () => {
  /*
   * compute() falls back to chronological on an unrecognised order, silently.
   * So a corrupt or renamed value would produce a cut in the wrong sequence
   * with nothing anywhere saying so — better to have no order rule, which at
   * least matches what the engine will actually do.
   */
  const db = fakeDb();
  await saveRules(db, "p1", [{ id: "a", kind: "order", order: "sideways" as never, on: true }]);
  const [back] = await loadRules(db, "p1");
  assert.equal(back.order, undefined);
});

test("saving replaces, so the list is the list", async () => {
  /* The rule set IS the ordered list the pane shows. A merge would need a
     notion of identity across two lists that the pane does not have. */
  const db = fakeDb();
  await saveRules(db, "p1", [
    { id: "a", kind: "keep", tag: "core", on: true },
    { id: "b", kind: "drop", tag: "hedge", on: true },
  ]);
  await saveRules(db, "p1", [{ id: "c", kind: "keep", tag: "strong", on: true }]);
  const back = await loadRules(db, "p1");
  assert.equal(back.length, 1);
  assert.equal(back[0].tag, "strong");

  await saveRules(db, "p1", []);
  assert.deepEqual(await loadRules(db, "p1"), [], "and an empty set is an empty set");
});

test("what comes back produces the same cut as what went in", async () => {
  /*
   * The only test that matters, because it is the invariant: rules in, the
   * same cut out. Anything the round trip loses shows up here as a different
   * cut rather than as a missing field somebody has to notice.
   */
  const set = {
    CLIPS: [
      { id: "m1", src: "A", ts: "0:10", dur: 40, tags: ["core"], strand: "why", text: "the first four weeks are about showing up" },
      { id: "m2", src: "A", ts: "2:00", dur: 20, tags: ["housekeeping"], text: "can you hear me okay" },
      { id: "m3", src: "B", ts: "1:00", dur: 30, tags: ["core", "strong"], strand: "cost", text: "rent halves and I lose everyone I would call at 2am" },
    ],
    STRANDS: ["why", "cost"],
  };
  const rules: Rule[] = [
    { id: "a", kind: "keep", tag: "core", on: true },
    { id: "b", kind: "drop", tag: "housekeeping", on: true },
    { id: "c", kind: "order", order: "strand", on: true },
    { id: "d", kind: "gap", on: true },
  ];

  const before = compute(rules, { set });
  const after = compute(await round(rules), { set });

  assert.equal(after.secs, before.secs);
  assert.deepEqual(
    after.rows.map((r) => r.key),
    before.rows.map((r) => r.key),
    "same rows, same order, same gaps",
  );
});

test("the three fields the brief compiler sets survive the round trip", async () => {
  /*
   * `len` carries its window, `count` carries its number, and a subject rule
   * carries the words it matches. None of them is a tag, a cid, an order or a
   * `secs`, which is every column the table had — so all four came back as
   * bare kinds: a `len` rule with no window, which compute() skips entirely,
   * and a "no politics" rule matching no words at all.
   *
   * A rule that reads correctly in the pane and does nothing is the exact
   * failure invariant 1 exists to prevent, and it is silent twice over: the
   * sentence is still there, and the cut is still a cut.
   */
  const [len, count, avoid] = await round([
    { id: "r-len", kind: "len", minSecs: 8, maxSecs: 45, on: true, text: "Between 8 and 45 seconds." },
    { id: "r-count", kind: "count", n: 8, on: true, text: "The best eight." },
    { id: "r-avoid", kind: "drop", words: ["politics", "election"], on: true, text: "Nothing about politics." },
  ]);

  assert.equal(len.minSecs, 8, "a len rule with no window is a rule compute() walks straight past");
  assert.equal(len.maxSecs, 45);
  assert.equal(count.n, 8, "a count rule with no n keeps everything");
  assert.deepEqual(avoid.words, ["politics", "election"], "a subject rule with no words matches nothing");
});

test("a cut made by len, count and words is the same cut after a reload", async () => {
  /*
   * The equivalence test above this one uses keep, drop, order and gap — the
   * four kinds that already persisted. That is why it stayed green through a
   * reload that dropped three fields on the floor. This is the same claim
   * aimed at the rules a pasted brief actually compiles to.
   */
  const set = {
    CLIPS: [
      { id: "m1", src: "A", ts: "0:05", dur: 5, tags: ["core"], strand: "why", text: "so anyway that was the week" },
      { id: "m2", src: "A", ts: "0:30", dur: 20, tags: ["core"], strand: "why", text: "rent halves and I lose everyone I would call at 2am" },
      { id: "m3", src: "A", ts: "1:10", dur: 20, tags: ["core"], strand: "why", text: "the election changed how politics felt on this street" },
      { id: "m4", src: "B", ts: "0:10", dur: 60, tags: ["core"], strand: "cost", text: "the long one about the four weeks of showing up every morning" },
      { id: "m5", src: "B", ts: "2:00", dur: 20, tags: ["core"], strand: "cost", text: "nobody tells you the first month is just admin" },
      { id: "m6", src: "B", ts: "3:00", dur: 20, tags: ["core"], strand: "cost", text: "I stopped counting the hours in the second year" },
    ],
    STRANDS: ["why", "cost"],
  };
  const rules: Rule[] = [
    { id: "a", kind: "keep", tag: "core", on: true },
    { id: "b", kind: "drop", words: ["politics"], on: true },
    { id: "c", kind: "len", minSecs: 8, maxSecs: 45, on: true },
    { id: "d", kind: "count", n: 2, on: true },
  ];

  const before = compute(rules, { set });
  const after = compute(await round(rules), { set });

  assert.deepEqual(
    before.rows.map((r) => r.key),
    after.rows.map((r) => r.key),
    "same rows, same order",
  );
  assert.equal(after.secs, before.secs);
  /* And the cut is actually the narrow one, or the assertion above would hold
     just as well for two rule sets that both did nothing. There is no gap rule
     here, so the rows are the moments. */
  assert.deepEqual(before.rows.map((r) => r.key), ["cm2", "cm5"], "count said two, len dropped the 5s and the 60s, words dropped the election");
});
