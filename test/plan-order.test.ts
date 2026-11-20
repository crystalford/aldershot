/**
 * THE PLAN'S ORDER IS THE ARGUMENT, AND THE CUT WAS THROWING IT AWAY.
 *
 * src/index.ts builds a plan's cut from a `keep` rule listing the moments in
 * the order the beats put them, and an order rule whose text reads "Run it as
 * the plan has it." The comment above it says why: "Beat order is not
 * chronological and not by thread — it is the argument."
 *
 * It then passed `order: "time"`, because there was no fourth value. Step 8
 * took the time branch, sorted by source and timestamp, and nothing ever read
 * the `cids` order — hit() tests membership and nothing else. So the one stop,
 * the moment somebody approves the shape of their argument, was the one thing
 * the cut discarded, while the rules pane told them otherwise. No test
 * covered it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compute, ORDERS, orderText, isOrder, type Rule, type Moment } from "../src/rules.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Four moments whose chronological order is the exact REVERSE of the
 * argument's. If anything sorts by time the sequence comes back backwards,
 * and every assertion below says so. Same shape as test/rules.test.ts.
 */
const CLIPS: Moment[] = [
  { id: 1, src: "A", ts: "0:10", dur: 30, tags: ["core"], text: "Fourth in the argument, first on the clock." },
  { id: 2, src: "A", ts: "1:40", dur: 30, tags: ["core"], text: "Third in the argument." },
  { id: 3, src: "A", ts: "3:20", dur: 30, tags: ["core"], text: "Second in the argument." },
  { id: 4, src: "A", ts: "5:00", dur: 30, tags: ["core"], text: "First in the argument, last on the clock." },
];
const set = { CLIPS, STRANDS: [] as string[] };

/** The argument: the reverse of the clock. */
const ARGUMENT = [4, 3, 2, 1];

const planRules = (order: string): Rule[] => [
  { id: "r-keep-plan", kind: "keep", cids: ARGUMENT, on: true, text: "Keep what the plan found." },
  { id: "r-order", kind: "order", order: order as never, on: true, text: orderText(order as never) },
];

const seqOf = (rules: Rule[]) =>
  compute(rules, { set: set as never })
    .rows.filter((r) => r.kind === "clip")
    .map((r) => r.moment!.id);

test("ACCEPTANCE: the cut runs in the order the plan put the beats in", () => {
  assert.deepEqual(seqOf(planRules("given")), ARGUMENT);
});

test("…and the old behaviour really was chronological, so this test can see the difference", () => {
  /* The exact bug, reinstated by argument: `order: "time"` on the same rules. */
  assert.deepEqual(seqOf(planRules("time")), [1, 2, 3, 4]);
});

test("ACCEPTANCE: the rule the plan writes says what it does", () => {
  /*
   * The pane read "Run it as the plan has it." while the engine ran it
   * chronologically. The sentence and the behaviour come from the same place
   * now — orderText off the same key the engine switches on.
   */
  assert.equal(orderText("given"), "Run it as the plan has it.");
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(
    src,
    /kind: "order", order: "given", on: true, text: orderText\("given"\)/,
    "the plan route must write the order it claims",
  );
});

test("switching the order rule off gives the footage as it happened", () => {
  /* Invariant 6: rules switch off. With no order rule the engine defaults to
     time, which is the honest alternative to an argument — not an error. */
  const rules = planRules("given");
  rules[1] = { ...rules[1], on: false };
  assert.deepEqual(seqOf(rules), [1, 2, 3, 4]);
});

test("a moment the argument does not list goes last, not first", () => {
  /*
   * It is in the cut for some other reason — a words rule, a hand-kept line —
   * and the argument has no opinion about where it belongs. Putting it at the
   * front would let an unrelated keep silently open the video.
   */
  const rules: Rule[] = [
    { id: "r-keep-plan", kind: "keep", cids: [4, 3], on: true, text: "Keep what the plan found." },
    { id: "r-words", kind: "keep", words: ["third"], on: true, text: "Keep anything about third." },
    { id: "r-order", kind: "order", order: "given", on: true, text: orderText("given") },
  ];
  const seq = seqOf(rules);
  assert.deepEqual(seq.slice(0, 2), [4, 3], "the argument's own order did not survive");
  assert.equal(seq[2], 2, "the unlisted moment did not go last");
});

test("two moments neither rule lists keep their time order between them", () => {
  const rules: Rule[] = [
    { id: "r-keep-plan", kind: "keep", cids: [4], on: true, text: "Keep what the plan found." },
    { id: "r-words", kind: "keep", words: ["second", "third"], on: true, text: "Keep those." },
    { id: "r-order", kind: "order", order: "given", on: true, text: orderText("given") },
  ];
  const seq = seqOf(rules);
  assert.equal(seq[0], 4, "the listed moment did not lead");
  assert.deepEqual(seq.slice(1), [2, 3], "the unlisted ones are not in time order after it");
});

test("ACCEPTANCE: the picker still offers three orders, not four", () => {
  /*
   * `given` means "the order something else already decided", so there is
   * nothing for a person to press. The prototype draws three chips and this
   * keeps it at three — the new order is visible as a RULE with its own
   * sentence and its own switch, which is where a thing somebody did not
   * choose belongs.
   */
  const cut = readFileSync(join(import.meta.dirname, "..", "src", "ui", "pages", "cut.ts"), "utf8");
  assert.match(cut, /\.filter\(\(o\) => o !== "given"\)/, "the chip row must exclude it");
  assert.equal(Object.keys(ORDERS).length, 4, "four orders exist");
});

test("it is a real order as far as the route is concerned", () => {
  /* isOrder gates what a client may send; an order the engine knows and the
     validator does not would fall through to the default silently. */
  assert.equal(isOrder("given"), true);
  assert.equal(isOrder("argument"), false);
});
