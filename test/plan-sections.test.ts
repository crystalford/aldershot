/**
 * DECLARING A SECTION, IN YOUR OWN WORDS.
 *
 * A plan's beats were whatever a model drafted at the moment the plan was
 * made, and the only thing anybody could do to them afterwards was keep or
 * cut — `createPlan` writes every beat in one INSERT. So a plan could not
 * grow, and somebody who knew their piece needed a section on orbital
 * mechanics had no way to say so. That is also invariant 10's second half
 * ("the user's own words win where they exist") broken at the one point where
 * their words are the whole contribution.
 *
 * Half of these are about the thing a stoplist most wants to do and must not:
 * overrule the sentence somebody typed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { addBeat, createPlan, getPlan, setFound } from "../src/plan-store.ts";
import { needAdvice } from "../src/plan.ts";
import { fakeD1, schema } from "./helpers/fake-d1.ts";

const seeded = async (beats = 2) => {
  const raw = new DatabaseSync(":memory:");
  schema(raw);
  const db = fakeD1(raw) as never;
  const planId = await createPlan(db, {
    userId: "u1",
    topic: "whether the story was written before the rockets were",
    claim: "the account came first and the engineering was fitted to it",
    beats: Array.from({ length: beats }, (_, i) => ({
      role: "subject" as const,
      name: `drafted ${i}`,
      need: `somebody saying thing ${i} on camera`,
    })),
  });
  return { db, planId, raw };
};

test("a section the author wrote is stored in their words, and marked theirs", async () => {
  const { db, planId } = await seeded();
  const written = "the burn is described, then the number is given and it is wrong";
  const added = await addBeat(db, planId, { name: "orbital mechanics", need: written });

  assert.equal(added.byUser, true);
  assert.equal(added.need, written, "the need was altered on the way in");

  const plan = await getPlan(db, planId, "u1");
  const back = plan?.beats.find((b) => b.id === added.id);
  assert.ok(back, "the section was not read back");
  assert.equal(back.need, written, "the need was altered on the way out");
  assert.equal(back.byUser, true);
  assert.equal(back.kept, true, "a section somebody declared starts kept");
});

/*
 * AND A DRAFTED ONE IS NOT MARKED THEIRS.
 *
 * `createPlan` does not write the column, so a model's beat reads falsy. If
 * this ever passed for both, the flag would be decoration and the two things
 * that need it — a re-draft that must not overwrite, and Scout's documented
 * promise to keep what is already in the plan — would both be unservable.
 */
test("a beat a model drafted is not marked as the author's", async () => {
  const { db, planId } = await seeded();
  const plan = await getPlan(db, planId, "u1");
  assert.equal(plan?.beats.length, 2);
  for (const b of plan.beats) assert.equal(b.byUser, false, `${b.name} claims to be the author's`);
});

/*
 * THE IDX CONTINUES, IT DOES NOT COUNT.
 *
 * plan_beats is UNIQUE(plan_id, idx), so taking the count as the next index is
 * wrong the moment any row is ever removed — and it collides rather than
 * failing loudly in a way anybody would read.
 */
test("a second and third section land after the beats already there", async () => {
  const { db, planId } = await seeded(3);
  const a = await addBeat(db, planId, { name: "the first Mars mission", need: "somebody describing the plan" });
  const b = await addBeat(db, planId, { name: "the counter", need: "somebody answering it" });
  assert.equal(a.idx, 3);
  assert.equal(b.idx, 4);

  const plan = await getPlan(db, planId, "u1");
  const idxs = plan?.beats.map((x) => x.idx) ?? [];
  assert.deepEqual(idxs, [0, 1, 2, 3, 4], `indices collided or reordered: ${idxs.join(",")}`);
});

/*
 * AND WITH A HOLE IN THE SEQUENCE, WHICH IS THE CASE THAT CATCHES IT.
 *
 * The first version of the test above passed whether the next index came from
 * MAX(idx)+1 or from the row COUNT, because on three contiguous beats both
 * answers are 3 — so it did not pin the claim it was written for. A removed
 * row is what separates them: count says 2, which already exists.
 */
test("a section still lands after the last one when a beat has been removed", async () => {
  const { db, planId, raw } = await seeded(3);
  raw.exec(`DELETE FROM plan_beats WHERE idx=1`);

  const added = await addBeat(db, planId, { name: "orbital mechanics", need: "the burn described" });
  assert.equal(added.idx, 3, "the next index came from the count, not the last index");

  const plan = await getPlan(db, planId, "u1");
  assert.deepEqual(plan?.beats.map((x) => x.idx), [0, 2, 3]);
});

test("an unrecognised role reads as the case being made", async () => {
  const { db, planId } = await seeded(0);
  const odd = await addBeat(db, planId, { name: "x", need: "y", role: "nonsense" as never });
  assert.equal(odd.role, "subject");
  const kept = await addBeat(db, planId, { name: "x2", need: "y2", role: "counter" });
  assert.equal(kept.role, "counter");
});

/* ---- the on-camera rule, as advice ---- */

/*
 * THE WHOLE POINT: IT ADVISES AND STORES ANYWAY.
 *
 * src/scout-decompose.ts drops a beat whose behaviour names a motive, after
 * one regeneration. That is right for a model and wrong for a person:
 * invariant 10 says their words win, and invariant 3's posture is reasons
 * rather than verdicts. So the phrase comes back AND the row is written.
 */
test("a need that names a motive is reported and stored regardless", async () => {
  const { db, planId } = await seeded(0);
  const motive = "he wants to look competent about the numbers";

  assert.equal(needAdvice({ need: motive }), "wants to", "the phrase was not reported");

  const added = await addBeat(db, planId, { name: "the engineering", need: motive });
  const plan = await getPlan(db, planId, "u1");
  assert.equal(plan?.beats.find((b) => b.id === added.id)?.need, motive, "a stoplist overruled the author");
});

test("the phrase reported is the word they typed, not the stoplist's stem", () => {
  /* The list holds stems ("narcissist*"), so diagnosis returns "narcissis".
     Quoting that back at Scout is fine; showing it to the person who typed
     the word reads like a bug. */
  assert.equal(needAdvice({ need: "narcissistic framing of the launch" }), "narcissistic");
  assert.equal(needAdvice({ need: "she is insecure about it" }), "insecure");
});

test("the name is checked too, and a clean section is left alone", () => {
  assert.equal(needAdvice({ name: "the narcissist bit", need: "somebody saying it on camera" }), "narcissist");
  assert.equal(needAdvice({ name: "orbital mechanics", need: "the burn described, then the number given" }), null);
});

/* ---- filling one section ---- */

/*
 * ONE SECTION TOPPED UP, THE REST UNTOUCHED.
 *
 * Topping up one gap used to re-pay for every other beat, which is the
 * difference between a plan you return to and a plan you run once. setFound
 * already took a Map; what this pins is that a one-entry Map writes one row.
 */
test("finding for one section leaves the other rows' results alone", async () => {
  const { db, planId } = await seeded(3);
  const before = await getPlan(db, planId, "u1");
  const ids = (before?.beats ?? []).map((b) => b.id);

  await setFound(db, planId, new Map([[ids[0], { ids: ["c1", "c2"], backed: 2 }]]));
  await setFound(db, planId, new Map([[ids[2], { ids: ["c9"], backed: null }]]));

  /* Now re-fill only the middle one and check the other two did not move. */
  await setFound(db, planId, new Map([[ids[1], { ids: ["c5"], backed: 1 }]]));

  const after = await getPlan(db, planId, "u1");
  const by = (id: string) => after?.beats.find((b) => b.id === id);
  assert.deepEqual(by(ids[0])?.found, ["c1", "c2"]);
  assert.equal(by(ids[0])?.backed, 2);
  assert.deepEqual(by(ids[1])?.found, ["c5"]);
  assert.deepEqual(by(ids[2])?.found, ["c9"]);
  assert.equal(by(ids[2])?.backed, null, "nobody checked became a number");
});
