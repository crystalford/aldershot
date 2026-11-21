/**
 * THE PLAN AT FILM SCALE — doc 21, build phase 1.
 *
 * Accepted when: the sample plan round-trips; a len rule on one section
 * changes only that section's blocks; total length is derived, never stored.
 *
 * The sample is design/next/film.js, copied verbatim from the prototype's
 * room (Studio.dc.html) and its earlier Plan page — the same arrangement as footage.js and test/rules.test.ts. Its
 * numbers are the ones the rendered prototype shows in its header, so they are
 * checkable by eye: 20:00 · 11 sections · your voice 2:08 of 14:08 · about
 * 1,800 words to go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { computeFilm, parseFilmPlan, sectionFromRows, PlanShapeError, MIN_BLOCK_S, WORDS_PER_S, type FilmPlan, type SectionRule } from "../src/film-plan.ts";

const FILM_JS = join(import.meta.dirname, "..", "design", "next", "film.js");
const PAGES = ["Studio.dc.html", "Plan.dc.html"].map((f) => join(import.meta.dirname, "..", "design", "next", f));

// A variable specifier, so the typechecker treats the reference as data rather than a module it must type.
const ref: { SEQ: any[]; BOTH: any; COLD: any; ACTS: Array<{ label: string }> } = await import(pathToFileURL(FILM_JS).href);

const sample = (): FilmPlan =>
  parseFilmPlan({
    claim: "NASA didn't borrow science fiction's look. It paid for it.",
    targetS: 1200,
    acts: ref.ACTS.map((a) => a.label),
    sections: ref.SEQ.map((s) => sectionFromRows(s, ref.ACTS.length)),
  });
const rule = (r: Partial<SectionRule> & Pick<SectionRule, "kind" | "section">): SectionRule => ({ id: 1, on: true, ...r });

test("the reference is the prototype's: the room and the Plan page still carry film.js's SEQ verbatim", () => {
  const lit = (t: string) => {
    const i = t.indexOf("const SEQ = [");
    assert.ok(i >= 0, "no SEQ literal");
    return t.slice(i, t.indexOf("\n];", i) + 3);
  };
  for (const page of PAGES) assert.equal(lit(readFileSync(page, "utf8")), lit(readFileSync(FILM_JS, "utf8")), page);
});

test("the sample plan round-trips through JSON unchanged", () => {
  const plan = sample();
  assert.deepEqual(parseFilmPlan(JSON.parse(JSON.stringify(plan))), plan);
});

test("the sample computes to what the prototype shows: 20:00, 11 sections, voice 2:08 of 14:08", () => {
  const film = computeFilm(sample());
  assert.equal(film.totalS, 1200);
  assert.equal(film.overS, 0);
  assert.equal(film.sections.length, 11);
  assert.deepEqual(film.voice, { totalS: 848, recordedS: 128, wordsToGo: Math.round((848 - 128) * WORDS_PER_S) });
  assert.equal(film.voice.wordsToGo, 1800);
  assert.deepEqual(film.acts.map((a) => [a.startS, a.endS]), [[0, 390], [390, 810], [810, 1200]]);
  assert.deepEqual(film.problems, []);
  // Timed end to end with no gaps and no overlaps.
  let t = 0;
  for (const s of film.sections) for (const b of s.blocks) { assert.equal(b.startS, t); t = b.endS; }
  assert.equal(t, film.totalS);
});

test("a len rule on one section changes only that section's blocks", () => {
  const plan = sample();
  const before = computeFilm(plan);
  const after = computeFilm(plan, [rule({ kind: "len", section: "s9", secs: 65 })]);
  const durs = (f: typeof before, id: string) => f.sections.find((s) => s.id === id)!.blocks.map((b) => b.dur);
  for (const s of before.sections) {
    if (s.id === "s9") continue;
    assert.deepEqual(durs(after, s.id), durs(before, s.id), `${s.id} should not have moved`);
  }
  const s9 = after.sections.find((s) => s.id === "s9")!;
  assert.equal(s9.durS, 65);
  assert.equal(after.totalS, 1200 - 40);
  // The archive clip speaks in its own words and keeps its 20 seconds.
  assert.equal(s9.blocks[1].sound.mode, "sync");
  assert.equal(s9.blocks[1].dur, 20);
  assert.ok(s9.blocks.every((b) => b.dur >= MIN_BLOCK_S));
  // The plan itself is untouched — the rule is not an edit.
  assert.deepEqual(computeFilm(plan), before);
});

test("a length that would cut someone's words fails visibly and leaves the section as it was", () => {
  const plan = sample();
  const film = computeFilm(plan, [rule({ kind: "len", section: "s7", secs: 30 })]);
  assert.equal(film.sections.find((s) => s.id === "s7")!.durS, 150);
  assert.equal(film.problems.length, 1);
  assert.match(film.problems[0], /“The fire” can't be 0:30 — 0:48 is as short as it goes/);
});

test("total length is derived, never stored: a plan carrying one is refused", () => {
  const stored = { ...JSON.parse(JSON.stringify(sample())), total: 1200 };
  assert.throws(() => parseFilmPlan(stored), (e: unknown) => e instanceof PlanShapeError && /plan\.total: not part of a plan/.test(e.message));
  const timed = JSON.parse(JSON.stringify(sample()));
  timed.sections[0].blocks[0].startS = 0;
  assert.throws(() => parseFilmPlan(timed), /blocks\[0\]\.startS: not part of a plan/);
});

test("a plan that doesn't fit the shape fails visibly, naming the place", () => {
  const bad = JSON.parse(JSON.stringify(sample()));
  bad.sections[3].blocks[2].picture.kind = "stock";
  assert.throws(() => parseFilmPlan(bad), /plan\.sections\[3\]\.blocks\[2\]\.picture\.kind: expected one of/);
  const dup = JSON.parse(JSON.stringify(sample()));
  dup.sections[1].id = dup.sections[0].id;
  assert.throws(() => parseFilmPlan(dup), /"s1" is used twice/);
  const half = JSON.parse(JSON.stringify(sample()));
  half.sections[0].blocks[0].dur = 9.5;
  assert.throws(() => parseFilmPlan(half), /dur: expected whole seconds/);
});

test("the prototype's cold open: order + declare + len, and the film stays at 20:00", () => {
  const plan = sample();
  const cold = sectionFromRows(ref.COLD, plan.acts.length);
  const rules: SectionRule[] = [
    rule({ id: 1, kind: "declare", section: cold.id, declared: cold }),
    rule({ id: 2, kind: "order", section: cold.id, first: true }),
    rule({ id: 3, kind: "len", section: "s5", secs: 130 }),
  ];
  const film = computeFilm(plan, rules);
  assert.deepEqual(film.problems, []);
  assert.equal(film.sections[0].id, "s0");
  assert.equal(film.sections[0].act, 0, "a section moved to the front joins Act 1");
  assert.equal(film.totalS, 1200);
  // Switch the rules off and nothing happened.
  assert.deepEqual(computeFilm(plan, rules.map((r) => ({ ...r, on: false }))), computeFilm(plan));
});

test("Aldershot's two proposals: add “Both were true”, then trim back to length", () => {
  const plan = sample();
  const both = sectionFromRows(ref.BOTH, plan.acts.length);
  const add = computeFilm(plan, [rule({ id: 1, kind: "declare", section: both.id, declared: both, after: "s6" })]);
  assert.equal(add.totalS, 1290);
  assert.equal(add.overS, 90);
  assert.equal(add.sections[6].id, "s6b");
  const trimmed = computeFilm(plan, [
    rule({ id: 1, kind: "declare", section: both.id, declared: both, after: "s6" }),
    rule({ id: 2, kind: "len", section: "s9", secs: 65 }),
    rule({ id: 3, kind: "len", section: "s5", secs: 100 }),
  ]);
  assert.equal(trimmed.totalS, 1200);
  assert.deepEqual(trimmed.problems, []);
});

test("drop leaves a section out without deleting it; a rule that can't apply says so", () => {
  const plan = sample();
  const film = computeFilm(plan, [rule({ kind: "drop", section: "s10" }), rule({ id: 2, kind: "len", section: "nope", secs: 10 })]);
  assert.deepEqual(film.dropped, ["s10"]);
  assert.equal(film.totalS, 1200 - 90);
  assert.ok(plan.sections.some((s) => s.id === "s10"), "still in the plan");
  assert.deepEqual(film.problems, ["There's no section “nope” to change the length of."]);
});

test("a moved section joins the act it lands in; a declared one that splits an act is reported", () => {
  const film = computeFilm(sample(), [rule({ kind: "order", section: "s2", after: "s9" })]);
  assert.equal(film.sections.find((s) => s.id === "s2")!.act, 2);
  assert.deepEqual(film.problems, []);
  const split = computeFilm(sample(), [rule({ kind: "order", section: "s9", after: "s1" })]);
  assert.equal(split.sections[1].id, "s9");
  assert.equal(split.sections[1].act, 0, "it joins the act it lands in, so no act is split");
  assert.deepEqual(split.problems, []);
  const both = { ...sectionFromRows(ref.BOTH, 3), act: 2 };
  const wedged = computeFilm(sample(), [rule({ kind: "declare", section: both.id, declared: both, after: "s1" })]);
  assert.deepEqual(wedged.problems, ["“Both were true” is in ACT 3 · THE BILL but sits inside ACT 1 · THE PROMISE."]);
  const late = computeFilm(sample(), [rule({ kind: "declare", section: both.id, declared: { ...both, act: 0 } })]);
  assert.deepEqual(late.problems, ["The acts are out of order — an earlier act comes back after a later one has started."]);
});
