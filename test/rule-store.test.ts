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
