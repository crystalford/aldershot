/**
 * A PASTED BRIEF, COMPILED INTO RULES YOU CAN SEE AND SWITCH OFF.
 *
 * Phase 5's acceptance names the sentence: "hooks in 2s, 20–40s, no
 * politics, we need 8" compiles to four visible rules with a shortlist diff.
 *
 * A brief handed to a model that returned a shortlist would be a black box
 * with a paste box on the front. These pin the other thing: four rows a
 * person can read, argue with, and switch off one at a time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileBrief, shortlistDiff, subjectWords } from "../src/brief.ts";
import { honestReply } from "../src/rule-parse.ts";
import { compute, hooksFast, type FootageSet, type Moment, type Rule } from "../src/rules.ts";

const BRIEF = "hooks in 2s, 20–40s, no politics, we need 8";
const kinds = (text: string) => compileBrief(text).rules.map((r) => r.kind);

/* ── THE ACCEPTANCE ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: the brief compiles to four visible rules", () => {
  const { rules, unparsed } = compileBrief(BRIEF);
  assert.deepEqual(rules.map((r) => r.kind).sort(), ["count", "drop", "hook", "len"]);
  assert.deepEqual(unparsed, []);

  /* Each one reads as the clause the person wrote — invariant 10, the
     user's own words win where they exist. */
  assert.deepEqual(rules.map((r) => r.text), [
    "Hooks in 2s.",
    "20–40s.",
    "We need 8.",
    "No politics.",
  ]);

  /* And each carries what it needs to actually run. */
  const by = (k: string) => rules.find((r) => r.kind === k)!;
  assert.equal(by("hook").secs, 2);
  assert.equal(by("len").minSecs, 20);
  assert.equal(by("len").maxSecs, 40);
  assert.equal(by("count").n, 8);
  assert.deepEqual(by("drop").words, ["politics"]);
});

/* ── Each shape on its own ──────────────────────────────────────────────── */

test("a hook is asked about before a length is", () => {
  /*
   * "hooks in 2s" is a number and a seconds unit, so a looser length
   * pattern eats it and the brief ends up with a two-second maximum — four
   * rules, one of them the opposite of what was asked for.
   */
  assert.deepEqual(kinds("hooks in 2s"), ["hook"]);
  assert.equal(compileBrief("hook within 3 seconds").rules[0].secs, 3);
});

test("a length is a range, a ceiling, a floor, or both ends written separately", () => {
  const len = (t: string) => compileBrief(t).rules.find((r) => r.kind === "len")!;
  assert.deepEqual([len("20-40s").minSecs, len("20-40s").maxSecs], [20, 40]);
  assert.deepEqual([len("20 to 40 seconds").minSecs, len("20 to 40 seconds").maxSecs], [20, 40]);
  assert.deepEqual([len("under 30s").minSecs, len("under 30s").maxSecs], [undefined, 30]);
  assert.deepEqual([len("at least 15s").minSecs, len("at least 15s").maxSecs], [15, undefined]);
  /* Written backwards is still a range. */
  assert.deepEqual([len("40-20s").minSecs, len("40-20s").maxSecs], [20, 40]);
  /* And both ends in one brief is ONE rule, because applyRule keeps one. */
  const both = compileBrief("at least 15s, under 30s").rules.filter((r) => r.kind === "len");
  assert.equal(both.length, 1);
  assert.deepEqual([both[0].minSecs, both[0].maxSecs], [15, 30]);
});

test("a count is a number of shorts, however it is asked for", () => {
  const n = (t: string) => compileBrief(t).rules.find((r) => r.kind === "count")?.n;
  assert.equal(n("we need 8"), 8);
  assert.equal(n("give me six"), 6);
  assert.equal(n("12 shorts"), 12);
  assert.equal(n("make three of them"), 3);
  /* Zero is not a shortlist. */
  assert.equal(n("we need 0"), undefined);
});

test("every “no X” in the brief becomes a rule, not just the first", () => {
  /* A pane that looks complete and is not is worse than one that is short. */
  const rules = compileBrief("no politics, no work stuff").rules.filter((r) => r.kind === "drop");
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].words, ["politics"]);
  assert.deepEqual(rules[1].words, ["work", "stuff"]);
});

test("a subject is the words a moment would have to say, stop words gone", () => {
  /* "no the gym stuff" is about the gym — and a rule matching "the" would
     take the whole library out in one row. */
  assert.deepEqual(subjectWords("the gym stuff"), ["gym", "stuff"]);
  assert.deepEqual(subjectWords("politics"), ["politics"]);
  assert.deepEqual(subjectWords("the and of"), []);
});

test("a brief carrying an ordinary instruction keeps it too", () => {
  /*
   * A compiler that only understood its own four shapes would silently
   * lose half of what was pasted.
   */
  assert.ok(kinds("20-40s, as it happened").includes("order"));
});

test("a brief that means nothing says so, rather than making something up", () => {
  const out = compileBrief("make it pop");
  assert.deepEqual(out.rules, []);
  assert.deepEqual(out.unparsed, ["make it pop"]);
  assert.deepEqual(compileBrief("   ").rules, []);
});

/* ── The shortlist diff ─────────────────────────────────────────────────── */

const moment = (id: string, over: Partial<Moment> = {}): Moment => ({
  id,
  src: "A",
  ts: "0:10",
  dur: 30,
  tags: ["core"],
  text: "The house has a room that gets sun until four.",
  ...over,
});

const set = (clips: Moment[]): FootageSet => ({ CLIPS: clips, STRANDS: [] });

const withIds = (rules: Array<Omit<Rule, "id">>): Rule[] =>
  rules.map((r, i) => ({ ...r, id: i + 1 }));

test("ACCEPTANCE: the brief shows what it did to the shortlist, rule by rule", () => {
  const clips = [
    /* Kept: right length, clean opening, nothing political. */
    ...Array.from({ length: 3 }, (_, i) => moment(`ok${i}`)),
    /* Out on length. */
    moment("tooshort", { dur: 4 }),
    moment("toolong", { dur: 90 }),
    /* Out on the hook — opens on a word pointing off-screen. */
    moment("dangling", { text: "He said the room gets sun until four." }),
    /* Out on the subject. */
    moment("politics", { text: "The politics of it were exhausting, honestly." }),
  ];

  const rules = withIds([
    { kind: "keep", tag: "core", on: true, text: "Keep the good bits." },
    ...compileBrief(BRIEF).rules,
  ]);
  const d = shortlistDiff(rules, { set: set(clips) });

  assert.equal(d.before, 0, "nothing is in before any rule runs");
  assert.equal(d.after, 3);

  const of = (kind: string) => d.rules.find((r) => r.rule.kind === kind)!;
  assert.equal(of("len").removed, 2);
  assert.equal(of("hook").removed, 1);
  assert.equal(of("drop").removed, 1);
  /* Nothing here touches it — a real answer, and more useful than silence. */
  assert.equal(of("count").removed, 0);
});

test("a count it cannot reach is said, not quietly delivered short", () => {
  /*
   * "We need 8" against a library that can produce five is the one thing a
   * person pasting a brief most needs to be told, and a shortlist of five
   * does not say it.
   */
  const clips = Array.from({ length: 5 }, (_, i) => moment(`m${i}`));
  const rules = withIds([
    { kind: "keep", tag: "core", on: true, text: "Keep the good bits." },
    ...compileBrief("we need 8").rules,
  ]);
  const d = shortlistDiff(rules, { set: set(clips) });
  assert.equal(d.after, 5);
  assert.equal(d.short, 3);
});

test("a count it reaches says nothing about being short", () => {
  const clips = Array.from({ length: 9 }, (_, i) => moment(`m${i}`));
  const rules = withIds([
    { kind: "keep", tag: "core", on: true, text: "Keep the good bits." },
    ...compileBrief("we need 8").rules,
  ]);
  const d = shortlistDiff(rules, { set: set(clips) });
  assert.equal(d.after, 8);
  assert.equal(d.short, null);
});

/* ── The three rule kinds that had never run ────────────────────────────── */

test("len, count and hook had been declared and inert", () => {
  /*
   * All three were in RuleKind and in applyRule from the port, and
   * compute() did nothing with any of them — rules that could be added,
   * switched on, and have no effect at all. Two of the brief's four would
   * have been decoration.
   */
  const clips = [moment("a", { dur: 10 }), moment("b", { dur: 30 })];
  const keep: Rule = { id: 1, kind: "keep", tag: "core", on: true };
  const len: Rule = { id: 2, kind: "len", minSecs: 20, maxSecs: 40, on: true };
  const out = compute([keep, len], { set: set(clips) });
  assert.deepEqual(out.st.filter((m) => m.in).map((m) => m.id), ["b"]);
});

test("count takes the last ones, after everything else has had its say", () => {
  /*
   * Taking the first eight and THEN dropping three for length would hand
   * back five when eight were asked for.
   */
  const clips = [moment("a", { dur: 4 }), moment("b"), moment("c"), moment("d")];
  const rules = withIds([
    { kind: "keep", tag: "core", on: true },
    { kind: "len", minSecs: 20, maxSecs: 40, on: true },
    { kind: "count", n: 2, on: true },
  ]);
  const out = compute(rules, { set: set(clips) });
  assert.deepEqual(out.st.filter((m) => m.in).map((m) => m.id), ["b", "c"]);
});

test("a hook rule drops what cannot land fast", () => {
  const clips = [
    moment("clean"),
    moment("dangling", { text: "He said it gets sun until four." }),
    moment("carryon", { text: "And then it gets sun until four." }),
  ];
  const rules = withIds([
    { kind: "keep", tag: "core", on: true },
    { kind: "hook", secs: 2, on: true },
  ]);
  const out = compute(rules, { set: set(clips) });
  assert.deepEqual(out.st.filter((m) => m.in).map((m) => m.id), ["clean"]);
});

test("a rule can match the words that were said, as words", () => {
  /* "rent" must not match "different" — the trap src/bm25.ts and
     src/scout-expand.ts both carry a note about. */
  const clips = [
    moment("rent", { text: "The rent halves if I go." }),
    moment("different", { text: "It was a different thing entirely." }),
  ];
  const rules = withIds([
    { kind: "keep", tag: "core", on: true },
    { kind: "drop", words: ["rent"], on: true },
  ]);
  const out = compute(rules, { set: set(clips) });
  assert.deepEqual(out.st.filter((m) => m.in).map((m) => m.id), ["different"]);
});

test("the hook rule says what it measures, and does not invent a clock", () => {
  /*
   * The engine's moments carry a duration and the text and no per-word
   * timings, so timing an opening means estimating it from character
   * share — and the first version did, which failed a one-sentence moment
   * against a two-second hook because the sentence is the whole clip.
   *
   * It checks the opening LANDS. The seconds stay on the rule because the
   * person wrote them and the pane reads back what they wrote.
   */
  const clean = moment("clean", { dur: 30 });
  assert.equal(hooksFast(clean, 30), true, "a whole sentence is not a late hook");
  assert.equal(hooksFast(clean, 2), true, "and the duration does not decide it");
  assert.equal(hooksFast(moment("x", { text: "He said it." }), 30), false);
  assert.equal(hooksFast(moment("x", { text: "   " }), 30), false);
});

test("a brief that means nothing is told what a BRIEF can say", () => {
  /*
   * The honest reply lists what parses, and a shape the product
   * understands but does not mention is a shape nobody will type again.
   * The four the compiler learned are on that list now.
   */
  const reply = honestReply(["make it pop"])!;
  assert.match(reply, /hooks in 2s/);
  assert.match(reply, /20–40s/);
  assert.match(reply, /no politics/);
  assert.match(reply, /we need 8/);
});

test("a brief needs something to filter, or it filters nothing to nothing", () => {
  /*
   * The engine starts with nothing in and `keep` rules mark moments in, so
   * a brief made only of length, count, subject and hook rules computes a
   * shortlist of zero — correct arithmetic and a useless answer to
   * somebody who just pasted four requirements. Found by pasting the
   * acceptance's own brief at a real project and getting nought back.
   *
   * The route adds the keep rule; this pins the arithmetic that makes it
   * necessary, so nobody removes it believing the compiler covers it.
   */
  const clips = [moment("a"), moment("b")];
  const filtersOnly = withIds(compileBrief("20-40s, we need 2").rules);
  assert.equal(compute(filtersOnly, { set: set(clips) }).st.filter((m) => m.in).length, 0);

  const withKeep = withIds([{ kind: "keep", tag: "core", on: true }, ...compileBrief("20-40s, we need 2").rules]);
  assert.equal(compute(withKeep, { set: set(clips) }).st.filter((m) => m.in).length, 2);
});

test("the route gives a project with no keep rule one, and says it added it", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  const route = src.slice(src.indexOf("A PASTED BRIEF BECOMES RULES"));
  const upto = route.slice(0, route.indexOf("recordPass"));
  assert.match(upto, /Start from everything you have\./);
  assert.match(upto, /!keeps\(before\) && !asked\.rules\.some/, "and only when there is not one already");
});
