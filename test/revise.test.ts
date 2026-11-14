/**
 * THE EVIDENCE CHANGING THE PLAN'S MIND.
 *
 * PASS-4-BRIEF: "Scout fills a plan's gaps; it cannot change the plan's
 * mind." These pin the half that makes it able to — and, more importantly,
 * the refusals, because every way this goes wrong is a confident sentence.
 *
 * A revision is a model telling somebody their video is about something
 * else. It has to be right about WHY, honest about what it costs, and
 * incapable of citing a quote nobody said.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costLine, parseRevision, priceRevision, type Evidence } from "../src/revise.ts";

const CURRENT = "the account came first and the engineering was fitted to it";

const ev: Evidence[] = [
  { ref: "r1", quote: "we wrote the mission before we could fly it", source: "a hearing" },
  { ref: "r2", quote: "the artist's impression came first", source: "a memo" },
];

const reply = (o: Record<string, unknown>) => ({ response: JSON.stringify(o) });

const ok = (over: Record<string, unknown> = {}) =>
  reply({
    changes: true,
    claim: "the pictures set the engineering, not the other way round",
    why: "both moments describe the image preceding the capability",
    drivenBy: ["r1", "r2"],
    ...over,
  });

/* ── Proposing ────────────────────────────────────────────────────────── */

test("a revision carries its claim, its reason and what drove it", () => {
  const r = parseRevision(ok(), ev, CURRENT);
  assert.ok(r);
  assert.equal(r.claim, "the pictures set the engineering, not the other way round");
  assert.match(r.why, /image preceding the capability/);
  assert.deepEqual(r.drivenBy, ["r1", "r2"]);
});

test("changes: false is no, whatever else came back", () => {
  /* A model that says no and fills the other fields anyway must not have
     its filled fields treated as a proposal. */
  assert.equal(parseRevision(ok({ changes: false }), ev, CURRENT), null);
  assert.equal(parseRevision(ok({ changes: "true" }), ev, CURRENT), null);
});

test("IT CANNOT CITE EVIDENCE THAT DOES NOT EXIST", () => {
  /*
   * The rule src/scout-reduce.ts enforces, here: the model gets short ids
   * and returns short ids, so a reference it invented resolves to nothing
   * our side and is dropped. A revision pointing at r9 when two rows were
   * sent is a revision citing a find nobody made.
   */
  const r = parseRevision(ok({ drivenBy: ["r1", "r9", "r404"] }), ev, CURRENT);
  assert.ok(r);
  assert.deepEqual(r.drivenBy, ["r1"], "invented refs must not survive");

  /* And one driven ONLY by invented refs is not a revision at all. */
  assert.equal(parseRevision(ok({ drivenBy: ["r9"] }), ev, CURRENT), null);
});

test("a revision driven by nothing is an opinion, not a revision", () => {
  assert.equal(parseRevision(ok({ drivenBy: [] }), ev, CURRENT), null);
});

test("the same claim back is not a change of mind", () => {
  /* Including when it has been re-typed with different spacing and a full
     stop, which is what a model does when it has nothing to say. */
  assert.equal(parseRevision(ok({ claim: CURRENT }), ev, CURRENT), null);
  assert.equal(parseRevision(ok({ claim: `  ${CURRENT.toUpperCase()}.  ` }), ev, CURRENT), null);
});

test("a claim or a reason missing is not a proposal", () => {
  assert.equal(parseRevision(ok({ claim: "" }), ev, CURRENT), null);
  assert.equal(parseRevision(ok({ why: "   " }), ev, CURRENT), null);
});

test("an answer that is not JSON is no revision, not a crash", () => {
  assert.equal(parseRevision({ response: "I think it still holds, really" }, ev, CURRENT), null);
  assert.equal(parseRevision({}, ev, CURRENT), null);
});

test("the quotes go out and never come back", () => {
  /*
   * A revision is allowed to say WHICH moment changed its mind and not to
   * repeat what the moment said: the quote in the UI is read from our own
   * verified row, so there is no field here a fabricated quote could
   * arrive in. The schema is the enforcement, so the schema is what this
   * reads.
   */
  const src = readFileSync("src/revise.ts", "utf8");
  const schema = src.slice(src.indexOf("const SCHEMA"), src.indexOf("function systemPrompt"));
  for (const forbidden of ["quote", "t_start", "time", "timecode"]) {
    assert.ok(!schema.includes(forbidden), `the model can return a ${forbidden}`);
  }
});

/* ── What it would cost ───────────────────────────────────────────────── */

const beats = [
  { id: "b1", need: "the claim as made" },
  { id: "b2", need: "somebody answering it" },
  { id: "b3", need: "the aside about budgets" },
];

test("a revision that keeps everything costs nothing", () => {
  const cost = priceRevision(beats, () => true, () => 3);
  assert.equal(cost.kept, 3);
  assert.equal(cost.dropped, 0);
  assert.equal(cost.orphanedTakes, 0);
  assert.match(cost.says, /Every beat you have survives this/);
});

test("THE TAKES ARE COUNTED, BECAUSE THE TAKES ARE THE COST", () => {
  /*
   * The expensive question PASS-4 calls the sharpest in the brief: when the
   * thesis changes, what happens to work already done? A cut re-produces, a
   * beat re-produces from the claim, narration is written last and
   * regenerates. A RECORDED TAKE does not — invariant 6 calls a performance
   * "the one thing in this product you cannot re-make by pressing
   * something". So that is the number a person has to be given.
   */
  const takes: Record<string, number> = { b1: 0, b2: 2, b3: 1 };
  const cost = priceRevision(beats, (need) => need === "the claim as made", (id) => takes[id] ?? 0);

  assert.equal(cost.kept, 1);
  assert.equal(cost.dropped, 2);
  assert.equal(cost.orphanedTakes, 3, "both dropped beats' takes must be counted");
  assert.match(cost.says, /^3 takes you recorded/, "the takes have to lead the sentence");
});

test("dropped beats with no recordings say so plainly", () => {
  const cost = priceRevision(beats, (need) => need !== "the aside about budgets", () => 0);
  assert.equal(cost.dropped, 1);
  assert.match(cost.says, /Nothing you have recorded is affected/);
});

test("the sentence says the takes are KEPT, because nothing is deleted", () => {
  /*
   * Invariant 6. A take whose beat is gone is still a take you can hear —
   * what it stops being is part of THIS video, which is the true and much
   * smaller claim. "Lost" or "deleted" here would be the product lying
   * about its own strongest promise.
   */
  const says = costLine(1, 2, 3);
  assert.match(says, /kept and still playable/);
  for (const word of ["lost", "deleted", "destroyed", "gone forever"]) {
    assert.ok(!says.toLowerCase().includes(word), `the cost line said "${word}"`);
  }
});

test("one take reads as one take", () => {
  const says = costLine(2, 1, 1);
  assert.match(says, /1 take you recorded is for/);
  assert.match(says, /It is kept/);
  assert.ok(!says.includes("1 takes"));
});

test("pricing makes no model call", () => {
  const src = readFileSync("src/revise.ts", "utf8");
  const body = src.slice(src.indexOf("export function priceRevision"));
  const fn = body.slice(0, body.indexOf("\n}\n"));
  for (const forbidden of ["runRead", "resolveFor", "env.AI", "await"]) {
    assert.ok(!fn.includes(forbidden), `priceRevision reached for ${forbidden}`);
  }
});

test("no score reaches the person (invariant 3)", () => {
  for (const [k, d, t] of [[3, 0, 0], [1, 2, 3], [2, 1, 0], [0, 3, 1]]) {
    const says = costLine(k, d, t);
    assert.ok(!/%|\bscore\b|\bconfiden|\brating\b/i.test(says), `a score leaked: ${says}`);
    assert.ok(says.length > 20, "a cost with no sentence is a number on its own");
  }
});

/* ── Which beats survive ──────────────────────────────────────────────── */

const planBeats = [
  { ref: "b1", name: "the claim as made", need: "the line itself" },
  { ref: "b2", name: "the answer", need: "somebody answering it" },
];

test("the beats it keeps come back, and invented ones do not", () => {
  const r = parseRevision(ok({ keeps: ["b1", "b7"] }), ev, CURRENT, planBeats);
  assert.ok(r);
  assert.deepEqual(r.keeps, ["b1"], "a beat that does not exist cannot be kept");
});

test("A BEAT IT FORGOT IS DROPPED, WHICH OVER-REPORTS THE COST", () => {
  /*
   * The safe direction, deliberately. A model that forgets to list a beat
   * makes the revision look MORE expensive than it is, so the person is
   * warned about takes that were never really at risk. The opposite default
   * — assume kept unless named — would hide the one cost that cannot be
   * undone, which is the whole thing this module is careful about.
   */
  const r = parseRevision(ok({ keeps: [] }), ev, CURRENT, planBeats);
  assert.ok(r);
  assert.deepEqual(r.keeps, []);

  const cost = priceRevision(
    planBeats.map((b) => ({ id: b.ref, need: b.need })),
    (need) => r.keeps.includes(planBeats.find((b) => b.need === need)?.ref ?? ""),
    () => 1,
  );
  assert.equal(cost.dropped, 2);
  assert.equal(cost.orphanedTakes, 2);
});
