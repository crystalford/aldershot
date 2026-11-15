/**
 * THE INTEGRITY ENVELOPE.
 *
 * A claim and its qualifier go out together or not at all. Phase 6's
 * acceptance says "a must-keep pair is never split by any length target", and
 * the strongest honest form of that is not one cap value but every cap value:
 * the loops below sweep the whole range, because a reducer that splits a pair
 * only at 43 seconds is a reducer that splits pairs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindings, splitBindings, splitLine } from "../src/envelope.ts";
import { compute, type Rule, type FootageSet } from "../src/rules.ts";
import { envelopeBreaks } from "../src/render-job.ts";

/* A claim, the qualifier that makes it honest, and two moments of filler. */
const CLAIM = "Rents in this town doubled inside four years.";
const QUALIFIER = "But that is two streets, and not the whole town.";

const SET: FootageSet = {
  CLIPS: [
    { id: "m1", src: "A", ts: "0:10", dur: 20, tags: ["core"], strand: "rent", text: CLAIM },
    { id: "m2", src: "A", ts: "0:35", dur: 10, tags: ["core"], strand: "rent", text: QUALIFIER },
    { id: "m3", src: "A", ts: "1:00", dur: 30, tags: ["core"], strand: "work", text: "The first four weeks are about showing up and nothing else." },
    { id: "m4", src: "B", ts: "0:20", dur: 30, tags: ["core"], strand: "work", text: "Nobody tells you the second month is the one that hurts." },
  ],
  STRANDS: ["rent", "work"],
};

const KEEP: Rule = { id: "r-keep", kind: "keep", tag: "core", on: true };
const BIND: Rule = { id: "r-bind", kind: "must_keep", cids: ["m1", "m2"], on: true };

const inCut = (rules: Rule[], set: FootageSet = SET): string[] =>
  compute(rules, { set }).st.filter((m) => m.in).map((m) => String(m.id));

/** Half of the pair is in and the other half is not — the thing that must never happen. */
const split = (ids: string[]): boolean => ids.includes("m1") !== ids.includes("m2");

test("a-b and b-c is one group of three, not two groups that disagree about b", () => {
  /*
   * An accusation, its response, and the qualifier on the response. Pairwise
   * bindings would let a reducer drop the accusation while keeping the other
   * two, which is the worst of the three possible cuts.
   */
  const bs = bindings([
    { id: "x", kind: "must_keep", cids: ["a", "b"], on: true },
    { id: "y", kind: "must_keep", cids: ["b", "c"], on: true },
  ]);
  assert.equal(bs.length, 1, "one group");
  assert.deepEqual([...bs[0].ids].sort(), ["a", "b", "c"]);
  assert.deepEqual([...bs[0].ruleIds].sort(), ["x", "y"], "and it remembers both rules that tied it");
});

test("a switched-off must-keep binds nothing, and a half-written one is ignored", () => {
  /* Invariant 6: rules switch off, they are not deleted. Off is how a person
     lifts this constraint, so it has to actually lift. */
  assert.deepEqual(bindings([{ id: "x", kind: "must_keep", cids: ["a", "b"], on: false }]), []);
  assert.deepEqual(bindings([{ id: "y", kind: "must_keep", cids: ["a"], on: true }]), []);
  assert.deepEqual(bindings([{ id: "z", kind: "must_keep", on: true }]), []);
});

test("no cap value splits the pair", () => {
  /* The acceptance test, swept rather than sampled. 90 seconds of footage. */
  for (let secs = 1; secs <= 95; secs += 1) {
    const ids = inCut([KEEP, BIND, { id: "r-cap", kind: "cap", secs, on: true }]);
    assert.equal(split(ids), false, `cap ${secs}s left half a proposition in the cut`);
  }
});

test("and without the binding, some cap value does split it — or the sweep proves nothing", () => {
  /*
   * The sweep above would pass just as happily against an engine that never
   * drops anything. This is the same sweep with the envelope switched off,
   * asserting that the thing being prevented is a thing that happens.
   */
  const ever = [];
  for (let secs = 1; secs <= 95; secs += 1) {
    if (split(inCut([KEEP, { id: "r-cap", kind: "cap", secs, on: true }]))) ever.push(secs);
  }
  assert.ok(ever.length > 0, "the cap never split the pair even unbound; the fixture is not exercising it");
});

test("a pair goes out together, not in together — length stays a dial", () => {
  /*
   * Together-or-neither. The other resolution, restoring the dropped half,
   * would make a must-keep rule a way to defeat the ceiling: bind enough
   * moments and "under two minutes" means nothing.
   *
   * WHICH moments the cap drops is capDropOrder's business and is decided by
   * what each one is the only source of, so asserting that this pair is the
   * one to go would be testing the drop order, not the envelope. The claim
   * here is the ceiling: wherever an unbound cut got under it, a bound cut
   * gets under it too.
   */
  for (let secs = 1; secs <= 95; secs += 1) {
    const cap: Rule = { id: "r-cap", kind: "cap", secs, on: true };
    const loose = compute([KEEP, cap], { set: SET });
    const bound = compute([KEEP, BIND, cap], { set: SET });
    if (loose.secs <= secs) {
      assert.ok(bound.secs <= secs, `cap ${secs}s: the binding defeated the ceiling at ${bound.secs}s`);
    }
  }

  /* And the pair does leave as a unit somewhere in that sweep, or
     together-or-neither has never actually been exercised. */
  const gone = [];
  for (let secs = 1; secs <= 95; secs += 1) {
    const ids = inCut([KEEP, BIND, { id: "r-cap", kind: "cap", secs, on: true }]);
    if (!ids.includes("m1") && !ids.includes("m2")) gone.push(secs);
  }
  assert.ok(gone.length > 0, "the pair never went out as a unit");
});

test("a group inherits the strongest protection any member has", () => {
  /*
   * Step 5 promises it never drops a `strong` moment. Bind an ordinary moment
   * to a strong one and the naive envelope breaks that promise while obeying a
   * rule written to protect meaning: the cap drops the ordinary half, the
   * envelope takes the strong half out after it.
   */
  const set: FootageSet = {
    ...SET,
    CLIPS: SET.CLIPS.map((c) => (c.id === "m1" ? { ...c, tags: ["core", "strong"] } : c)),
  };
  for (let secs = 1; secs <= 95; secs += 1) {
    const ids = compute([KEEP, BIND, { id: "r-cap", kind: "cap", secs, on: true }], { set })
      .st.filter((m) => m.in).map((m) => String(m.id));
    assert.ok(ids.includes("m1"), `cap ${secs}s dropped a strong moment`);
    assert.ok(ids.includes("m2"), `cap ${secs}s split the pair to protect the strong half`);
  }
});

test("a len window is about the pair's whole length, and never takes half of it", () => {
  /* 20s + 10s. A 12-second ceiling cannot keep either one: the proposition is
     30 seconds long whatever the moments are. */
  for (let hi = 1; hi <= 60; hi += 1) {
    const ids = inCut([KEEP, BIND, { id: "r-len", kind: "len", maxSecs: hi, on: true }]);
    assert.equal(split(ids), false, `maxSecs ${hi} split the pair`);
  }
  for (let lo = 1; lo <= 60; lo += 1) {
    const ids = inCut([KEEP, BIND, { id: "r-len", kind: "len", minSecs: lo, on: true }]);
    assert.equal(split(ids), false, `minSecs ${lo} split the pair`);
  }
  /* And the window reads the sum: 25s is under 30, so the pair fails it. */
  assert.equal(inCut([KEEP, BIND, { id: "r-len", kind: "len", maxSecs: 25, on: true }]).includes("m1"), false);
  assert.equal(inCut([KEEP, BIND, { id: "r-len", kind: "len", maxSecs: 35, on: true }]).includes("m1"), true);
});

test("the qualifier is not judged on whether it hooks", () => {
  /*
   * QUALIFIER opens on "but" and its subject is "that". That is what
   * makes it a qualifier, and it is exactly what hooksFast fails a moment
   * for — so a hook rule would drop every qualifier in the product while
   * keeping every claim. The group is judged once, where it opens.
   */
  const ids = inCut([KEEP, BIND, { id: "r-hook", kind: "hook", secs: 2, on: true }]);
  assert.equal(split(ids), false);
  assert.ok(ids.includes("m2"), "the qualifier survived a hook rule it could never pass alone");

  /* Unbound, it does not survive — or this test is about nothing. */
  const loose = inCut([KEEP, { id: "r-hook", kind: "hook", secs: 2, on: true }]);
  assert.equal(loose.includes("m2"), false, "hooksFast does not actually reject the qualifier; pick a harder one");
});

test("a bound pair is one item on a shortlist of n", () => {
  /* "The best eight" means eight things to watch, and a claim with its
     qualifier is one of them. */
  for (let n = 0; n <= 5; n += 1) {
    const ids = inCut([KEEP, BIND, { id: "r-count", kind: "count", n, on: true }]);
    assert.equal(split(ids), false, `count ${n} split the pair`);
  }
  /* n=1 is the pair and nothing else: two moments, one item. */
  const one = inCut([KEEP, BIND, { id: "r-count", kind: "count", n: 1, on: true }]);
  assert.deepEqual(one.sort(), ["m1", "m2"]);
});

test("a pair spanning two sources is not read as split when the cut is one source", () => {
  /*
   * compute() can be scoped to a single source, and splitBindings is the
   * export boundary's assertion. A pair with one half in another source would
   * otherwise read as permanently broken in either scope and block every
   * export — the constraint exists inside a cut, not across the library.
   */
  const bs = bindings([{ id: "x", kind: "must_keep", cids: ["m1", "m4"], on: true }]);
  const here = new Set(["m1", "m2", "m3"]);
  const kept = new Set(["m1"]);
  assert.deepEqual(
    splitBindings(bs, (id) => here.has(String(id)), (id) => kept.has(String(id))),
    [],
    "only one of the pair is in this scope, so there is nothing to keep together",
  );
  /* Both present and one kept IS a split. */
  assert.equal(
    splitBindings(bs, () => true, (id) => kept.has(String(id))).length,
    1,
  );
});

test("splitBindings catches a split however it was made", () => {
  /*
   * Deliberately ignorant of the cause. A hand cut is allowed to split a pair
   * — step 6 overrides everything above it and the person is entitled to —
   * but they are told, and so is the export. This is also the net under a
   * fifth reducer added later by someone who has not read envelope.ts.
   */
  const out = compute(
    [KEEP, BIND, { id: "r-hand", kind: "drop", cid: "m2", on: true, hand: true }],
    { set: SET },
  );
  const kept = new Set(out.st.filter((m) => m.in).map((m) => String(m.id)));
  const present = new Set(out.st.map((m) => String(m.id)));
  const broken = splitBindings(
    bindings([BIND]),
    (id) => present.has(String(id)),
    (id) => kept.has(String(id)),
  );
  assert.equal(broken.length, 1, "a hand cut split the pair and the assertion saw it");

  const line = splitLine(broken[0], (id) => SET.CLIPS.find((c) => c.id === id)?.text, (id) => kept.has(String(id)));
  assert.match(line, /never to separate/);
  assert.match(line, /two streets/, "and it names the half that would go out alone");
  assert.doesNotMatch(line, /\d+%|score|confidence/, "invariant 3: no score reaches a person");
});

test("an unbound cut is the cut it always was", () => {
  /*
   * The envelope is inert with no must_keep rules in the set, which is every
   * project built before this existed. compute() runs the same four reducers
   * through new code paths, so "no bindings" has to mean "no change".
   */
  for (const extra of [
    { id: "r-cap", kind: "cap", secs: 45, on: true } as Rule,
    { id: "r-len", kind: "len", minSecs: 12, maxSecs: 28, on: true } as Rule,
    { id: "r-count", kind: "count", n: 2, on: true } as Rule,
    { id: "r-hook", kind: "hook", secs: 2, on: true } as Rule,
  ]) {
    const withRule = compute([KEEP, extra], { set: SET });
    const withDeadBind = compute([KEEP, extra, { ...BIND, on: false }], { set: SET });
    assert.deepEqual(
      withDeadBind.rows.map((r) => r.key),
      withRule.rows.map((r) => r.key),
      `${extra.kind} behaves differently with a switched-off binding present`,
    );
  }
});

/* ---------------------------------------------------------------------------
 * The export boundary.
 *
 * compute() can no longer split a group. These are about the assertion that
 * does not take compute()'s word for it.
 * ------------------------------------------------------------------------ */

/** Answers the two queries envelopeBreaks makes, and nothing else. */
function fakeProjectDb(
  rules: Rule[],
  beats: Array<{ clip_id: string; struck?: string | null; text?: string | null }>,
) {
  let askedBeats = false;
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => {
          if (/FROM rules/.test(sql)) {
            return {
              results: rules.map((r) => ({
                key: String(r.id),
                kind: r.kind,
                on_: r.on ? 1 : 0,
                text: r.text ?? null,
                tag: r.tag ?? null,
                clip_ids: r.cids ? JSON.stringify(r.cids) : null,
                ord: null,
                secs: null,
                params: null,
                hand: 0,
                wins: 0,
              })),
            };
          }
          if (/FROM beats/.test(sql)) {
            askedBeats = true;
            return {
              results: beats.map((b) => ({
                clip_id: b.clip_id,
                struck: b.struck ?? null,
                text: b.text ?? null,
              })),
            };
          }
          throw new Error(`envelopeBreaks asked something unexpected: ${sql}`);
        },
      }),
    }),
  };
  return { env: { DB: db } as never, askedBeats: () => askedBeats };
}

test("a cut with no must-keep rules costs the render nothing", async () => {
  /* Every project made before the envelope existed. The beats are not even
     read: a check that bills every render for a feature nobody used would be
     its own argument against existing. */
  const { env, askedBeats } = fakeProjectDb([KEEP], [{ clip_id: "m1" }]);
  assert.deepEqual(await envelopeBreaks(env, "p1"), []);
  assert.equal(askedBeats(), false, "it read the beats when there was nothing to check");
});

test("both halves rendering is not a break", async () => {
  const { env } = fakeProjectDb([KEEP, BIND], [{ clip_id: "m1" }, { clip_id: "m2" }]);
  assert.deepEqual(await envelopeBreaks(env, "p1"), []);
});

test("neither half rendering is not a break either", async () => {
  /* The whole proposition is out of this cut, which says nothing it should
     not. Refusing here would block an export for a claim that is not in it. */
  const { env } = fakeProjectDb(
    [KEEP, BIND],
    [{ clip_id: "m1", struck: "1" }, { clip_id: "m2", struck: "1" }, { clip_id: "m3" }],
  );
  assert.deepEqual(await envelopeBreaks(env, "p1"), []);
});

test("a struck qualifier stops the render, and the sentence says which half", async () => {
  const { env } = fakeProjectDb(
    [KEEP, BIND],
    [{ clip_id: "m1", text: CLAIM }, { clip_id: "m2", text: QUALIFIER, struck: "1" }],
  );
  const broken = await envelopeBreaks(env, "p1");
  assert.equal(broken.length, 1);
  assert.deepEqual(broken[0].ids, ["m1", "m2"]);
  assert.match(broken[0].line, /two streets/, "it names the half that would go out alone");
  assert.doesNotMatch(broken[0].line, /\d+%|score|confidence/, "invariant 3");
});

test("a half with no beat at all is a break — absent and struck are the same to a viewer", async () => {
  /*
   * The case a beats-only reading would miss: a rule removed the moment, so
   * there is no row to find struck. To someone watching the file the two are
   * identical, so they are not distinguished.
   */
  const { env } = fakeProjectDb([KEEP, BIND], [{ clip_id: "m1", text: CLAIM }]);
  assert.equal((await envelopeBreaks(env, "p1")).length, 1);
});

test("a switched-off binding does not stop a render", async () => {
  /* Invariant 6 again, this time at the door: off has to actually lift. */
  const { env } = fakeProjectDb(
    [KEEP, { ...BIND, on: false }],
    [{ clip_id: "m1" }, { clip_id: "m2", struck: "1" }],
  );
  assert.deepEqual(await envelopeBreaks(env, "p1"), []);
});

test('struck="0" is not struck', async () => {
  /* blocks.ts reads the column as Boolean(struck) && struck !== "0", and two
     readings of the same column would disagree the first time either moved. */
  const { env } = fakeProjectDb(
    [KEEP, BIND],
    [{ clip_id: "m1" }, { clip_id: "m2", struck: "0" }],
  );
  assert.deepEqual(await envelopeBreaks(env, "p1"), []);
});
