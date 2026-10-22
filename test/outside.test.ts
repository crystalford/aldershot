/**
 * WHETHER SCOUT MAY GO OUTSIDE — the preference, and the one way it moves.
 *
 * Invariant 9 is the hard limit: Scout links and never downloads. This is the
 * softer one, which is whether he looks at all, and it is the first setting in
 * the product where the wrong default is a privacy decision taken on somebody
 * else's behalf. So two things are pinned here: that an account nobody asked
 * reads as "ask", and that the next state is never named by the client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREF, OUTSIDE_PREFS, PILL, LINE, nextPref, prefOf, readPref, resolvePress, writePref, type OutsidePref } from "../src/outside.ts";

/** The one column these two functions touch, with nothing else in the way. */
function fakeDb(start: string | null = null) {
  let stored: string | null = start;
  const db = {
    prepare: (sql: string) => ({
      bind: (...b: unknown[]) => ({
        first: async () => {
          assert.match(sql, /^SELECT outside_pref/);
          return { outside_pref: stored };
        },
        run: async () => {
          assert.match(sql, /^UPDATE v2_users SET outside_pref/);
          stored = b[0] as string;
        },
      }),
    }),
  } as never;
  return { db: db as unknown as D1Database, read: () => stored };
}

test("a press is told where it came FROM, never where to go", async () => {
  /*
   * The body names the state the pill was showing. If it named its own
   * destination, a client could post {pref:"always"} and switch Scout on
   * without anybody pressing anything — and "on" is the direction of this
   * control that must only ever be reachable by a person.
   */
  assert.deepEqual(resolvePress("never", "never"), { pref: "always", stale: false });
  assert.deepEqual(resolvePress("always", "always"), { pref: "ask", stale: false });
  /* No guard sent at all still cycles from what is stored. */
  assert.deepEqual(resolvePress("ask", undefined), { pref: "never", stale: false });
});

test("a press that disagrees with what is stored changes nothing", async () => {
  /*
   * Two tabs open on the room, or the two halves of a double press. The
   * second one must not take a second step on top of a step its presser
   * never saw — it reports the truth and the pill re-paints.
   */
  const { db, read } = fakeDb("never");
  const before = read();
  const r = resolvePress(await readPref(db, "u1"), "always");
  assert.deepEqual(r, { pref: "never", stale: true });
  assert.equal(read(), before, "a stale press must not write");
});

test("the preference round-trips, and a null column reads as ask", async () => {
  const { db, read } = fakeDb(null);
  assert.equal(await readPref(db, "u1"), "ask", "an account nobody asked is not opted in");
  for (const p of OUTSIDE_PREFS) {
    await writePref(db, "u1", p);
    assert.equal(read(), p);
    assert.equal(await readPref(db, "u1"), p);
  }
});

test("a read that throws is the cautious default, not a dead page", async () => {
  /* The room's front door reads this. A D1 blip must not be a 500 on the
     page everything else starts from — the same rule the spend cap and the
     breaker follow. */
  const broken = {
    prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no"); } }) }),
  } as unknown as D1Database;
  assert.equal(await readPref(broken, "u1"), "ask");
});

test("every state has a pill and a line, and the line never contradicts it", () => {
  /* A line reading "bring him into a project" under a pill reading Off is
     the interface disagreeing with itself. */
  for (const p of OUTSIDE_PREFS) {
    assert.ok(PILL[p] && LINE[p], `${p} needs both`);
  }
  assert.match(LINE.never, /your footage only/);
  assert.ok(!/project to research/.test(LINE.never));
  assert.match(LINE.always, /every project/);
  assert.equal(DEFAULT_PREF, "ask");
  /* prefOf is the only way a stored string becomes a state, so anything
     outside the three has to land on the cautious one. */
  for (const junk of ["", "ALWAYS", "on", "true", "1"]) {
    assert.equal(prefOf(junk), "ask", `${JSON.stringify(junk)} must not read as a yes`);
  }
  /* And the cycle only ever produces states that have words. */
  let p: OutsidePref = DEFAULT_PREF;
  for (let i = 0; i < 4; i += 1) {
    p = nextPref(p);
    assert.ok(OUTSIDE_PREFS.includes(p));
  }
});
