/**
 * THE PORT IS CORRECT ONLY IF IT REPRODUCES THE REFERENCE.
 *
 * `design/one-take/footage.js` is the specification for the rule engine, and
 * the handoff's acceptance test for the port is its own sample cut: 8 of 14
 * moments, 5:59, 4 to-camera gaps. That number is not a round target somebody
 * picked — it is what those four seed rules produce from those fourteen
 * moments, and it is checkable by hand:
 *
 *   the eight `core` moments        44+31+47+33+40+35+42+39 = 311s
 *   four threads, twelve seconds each                      =  48s
 *                                                            ---
 *                                                            359s = 5:59
 *
 * So this file is the only thing standing between a port that looks right and
 * a port that has quietly changed the precedence of two rules.
 *
 * The fixture is copied from the reference verbatim and must stay that way. If
 * the reference changes, this fails, and that is the point.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compute,
  applyRule,
  ruleEffect,
  ruleKey,
  describe,
  effectLine,
  fmt,
  toFootageSet,
  wordDur,
  type Rule,
  type Moment,
} from "../src/rules.ts";

/* design/one-take/footage.js — STRANDS and CLIPS, verbatim. */
const STRANDS = ["why leave", "what it costs", "the house", "what I'd miss", "landing it"];

const CLIPS: Moment[] = [
  { id: 1, src: "A", ts: "0:00", dur: 38, tags: ["chat"], text: "Okay is this— yeah it's recording. Hi. Give me a second, where was I." },
  { id: 2, src: "A", ts: "6:40", dur: 44, tags: ["core", "strong"], strand: "why leave", text: "I think the honest version is I don't like who I am here. Not the city. Me, in it." },
  { id: 3, src: "A", ts: "14:12", dur: 31, tags: ["core"], strand: "why leave", text: "Every plan I make is a plan to be somewhere else in six months. That's been true for three years." },
  { id: 4, src: "A", ts: "22:15", dur: 36, tags: ["hedge"], strand: "why leave", text: "But I mean, maybe that's just, I don't know, maybe everyone feels like that and it's fine." },
  { id: 5, src: "B", ts: "3:05", dur: 29, tags: ["chat"], text: "Sorry, the mic's on the dash — if it rattles, that's why." },
  { id: 6, src: "B", ts: "11:48", dur: 47, tags: ["core"], strand: "what it costs", text: "If I leave, rent halves and I lose everyone I'd call at 2am. That's the actual trade. Say it plainly." },
  { id: 7, src: "B", ts: "19:30", dur: 33, tags: ["core"], strand: "what it costs", text: "I keep pricing it in money because the other price is embarrassing to say out loud." },
  { id: 8, src: "B", ts: "27:52", dur: 40, tags: ["core", "house"], strand: "the house", text: "The house has a room that gets sun until four. I've thought about that room more than I've thought about the job." },
  { id: 9, src: "B", ts: "36:10", dur: 35, tags: ["core", "house"], strand: "the house", text: "Mum keeps sending photos of it like it's already mine." },
  { id: 10, src: "C", ts: "8:20", dur: 42, tags: ["core"], strand: "what I'd miss", text: "Tuesday nights. Not the people exactly. The version of me that shows up on Tuesday nights." },
  { id: 11, src: "C", ts: "17:45", dur: 30, tags: ["hedge"], strand: "what I'd miss", text: "I don't know. I don't know. This is probably a bad idea to think about on camera." },
  { id: 12, src: "C", ts: "31:20", dur: 39, tags: ["core", "strong"], strand: "what I'd miss", text: "You can't keep a version of yourself alive by visiting it twice a year." },
  { id: 13, src: "C", ts: "44:02", dur: 46, tags: ["strong", "resolve"], strand: "landing it", text: "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made." },
  { id: 14, src: "C", ts: "58:30", dur: 28, tags: ["chat"], text: "Okay that's— I'll stop there. I need to eat something." },
];

const SEED: Rule[] = [
  { id: 1, kind: "keep", tag: "core", on: true, text: "Keep the parts where you're actually working something out." },
  { id: 2, kind: "drop", tag: "chat", on: true, text: "Take out the hellos, the mic checks, the where-was-I." },
  { id: 3, kind: "order", order: "strand", on: true, text: "Run it one thread at a time." },
  { id: 4, kind: "gap", on: true, text: "Leave me twelve seconds to camera at the end of each thread." },
];

const set = { CLIPS, STRANDS };

test("the sample cut: 8 of 14 moments, 5:59, 4 to-camera gaps", () => {
  const out = compute(SEED, { set });

  const kept = out.st.filter((m) => m.in);
  assert.equal(kept.length, 8, "eight of fourteen");
  assert.deepEqual(kept.map((m) => m.id), [2, 3, 6, 7, 8, 9, 10, 12]);

  const gaps = out.rows.filter((r) => r.voice && r.byId === 4);
  assert.equal(gaps.length, 4, "four threads are represented, so four gaps");

  assert.equal(out.secs, 359);
  assert.equal(fmt(out.secs), "5:59");
});

test("the clip that lands it is NOT in the sample cut, and that is correct", () => {
  /*
   * Moment 13 — "So I'm going. Not because it's better there." — is the line
   * the whole thing is about, and the seed rules leave it out, because it is
   * tagged `strong` and `resolve` and the keep rule asks for `core`. The
   * reference does this too. Pinned because it looks exactly like a port bug
   * and is not one: it is what "rules you can see" means, and the fix is
   * another rule, not a special case in the engine.
   */
  const out = compute(SEED, { set });
  assert.ok(!out.st.find((m) => m.id === 13)!.in);

  const withLanding = applyRule(SEED, {
    id: 5, kind: "keep", tag: "resolve", on: true, text: "End on where you land it.",
  });
  const after = compute(withLanding, { set });
  assert.ok(after.st.find((m) => m.id === 13)!.in, "and one more rule brings it in");
  assert.equal(after.secs, 359 + 46 + 12, "plus its own thread's gap");
});

test("precedence: drop beats keep, and a keep with `wins` takes it back", () => {
  /* Steps 2, 3 and 4. Moment 8 is both `core` (kept) and `house` (dropped). */
  const dropHouse: Rule[] = [...SEED, { id: 5, kind: "drop", tag: "house", on: true }];
  const dropped = compute(dropHouse, { set });
  assert.ok(!dropped.st.find((m) => m.id === 8)!.in, "the later drop rule takes it");
  assert.equal(dropped.st.find((m) => m.id === 8)!.dropId, 5, "and says which rule did");

  const wins: Rule[] = [
    { ...SEED[0], wins: true },
    ...SEED.slice(1),
    { id: 5, kind: "drop", tag: "house", on: true },
  ];
  assert.ok(compute(wins, { set }).st.find((m) => m.id === 8)!.in, "`wins` re-takes it");
});

test("a hand decision overrides every rule above it", () => {
  /* Step 6. This is the escape hatch that keeps the engine honest: a person
     who disagrees with the rules does not have to argue with them. */
  const byHand: Rule[] = [...SEED, { id: 9, kind: "keep", cid: 1, on: true, hand: true }];
  const out = compute(byHand, { set });
  assert.ok(out.st.find((m) => m.id === 1)!.in, "kept by hand despite the drop rule");

  const cutByHand: Rule[] = [...SEED, { id: 9, kind: "drop", cid: 2, on: true, hand: true }];
  assert.ok(!compute(cutByHand, { set }).st.find((m) => m.id === 2)!.in);
});

test("the cap never drops a `strong` moment, and charges itself", () => {
  /* Step 5. The ceiling is a rule like any other, so what it took has to be
     attributable or the rules pane cannot explain the cut. */
  const capped = applyRule(SEED, { id: 5, kind: "cap", secs: 180, on: true, text: "Keep it under three minutes." });
  const out = compute(capped, { set });

  const clipSecs = out.rows.filter((r) => r.kind === "clip").reduce((n, r) => n + r.secs, 0);
  assert.ok(clipSecs <= 180, `${clipSecs}s over the cap`);
  for (const m of out.st.filter((m) => m.tags.includes("strong") && m.tags.includes("core"))) {
    assert.ok(m.in, `the cap dropped a strong moment (${m.id})`);
  }
  const takenByCap = out.st.filter((m) => m.dropId === 5);
  assert.ok(takenByCap.length > 0);
  assert.ok(
    takenByCap.every((m) => !m.tags.includes("strong")),
    "and it only ever took moments it was allowed to",
  );
});

test("the cap drops a wholly redundant moment before a longer unique one", () => {
  /*
   * THE ONE DEPARTURE FROM THE REFERENCE, and the reason for it.
   *
   * footage.js sorts by duration and drops the longest. Longest-first is right
   * about cost and silent about value: a moment that repeats another word for
   * word survives a cap meant to tighten the cut, because it is short.
   *
   * Here `echo` says nothing `long` does not already say, and `unique` says
   * something nothing else does. Longest-first would take `unique` (60s) and
   * keep `echo`. Cost-over-unique-value takes `echo` first.
   */
  const CL: Moment[] = [
    { id: "long", src: "A", ts: "0:00", dur: 40, tags: ["core"], text: "the filter cost forty pounds and the water tasted identical afterwards" },
    { id: "echo", src: "A", ts: "1:00", dur: 20, tags: ["core"], text: "the filter cost forty pounds, water tasted identical" },
    { id: "unique", src: "A", ts: "2:00", dur: 60, tags: ["core"], text: "my father drove four hours through snow and never mentioned it once" },
  ];
  const rules: Rule[] = [
    { id: 1, kind: "keep", tag: "core", on: true },
    { id: 2, kind: "cap", secs: 100, on: true },
  ];
  const out = compute(rules, { set: { CLIPS: CL, STRANDS: [] } });
  const gone = out.st.filter((m) => !m.in).map((m) => m.id);
  assert.deepEqual(gone, ["echo"], "the repetition goes, not the longest");
  assert.ok(out.st.find((m) => m.id === "unique")!.in);
});

test("with nothing repeated, the cap reduces to the reference's longest-first", () => {
  /*
   * Which is what makes the departure above a REFINEMENT rather than a
   * different algorithm. Three moments sharing no content words at all: the
   * unique-value term is equal for each, so cost ordering is duration
   * ordering, and the engine drops exactly what footage.js would.
   */
  const CL: Moment[] = [
    { id: "a", src: "A", ts: "0:00", dur: 60, tags: ["core"], text: "turpentine varnish linseed gesso" },
    { id: "b", src: "A", ts: "1:00", dur: 30, tags: ["core"], text: "rowing blisters calluses oarlock" },
    { id: "c", src: "A", ts: "2:00", dur: 20, tags: ["core"], text: "sourdough starter hydration crumb" },
  ];
  const rules: Rule[] = [
    { id: 1, kind: "keep", tag: "core", on: true },
    { id: 2, kind: "cap", secs: 55, on: true },
  ];
  const out = compute(rules, { set: { CLIPS: CL, STRANDS: [] } });
  assert.deepEqual(out.st.filter((m) => !m.in).map((m) => m.id), ["a"], "the longest, as the reference does");
});

test("order: as it happened, one thread at a time, sharpest line first", () => {
  /* Step 8, and the gap rule's dependence on it — threads have no last moment
     in chronological order, so chronological order has no gaps. */
  const asHappened = compute(SEED.map((r) => (r.kind === "order" ? { ...r, order: "time" as const } : r)), { set });
  assert.deepEqual(
    asHappened.rows.filter((r) => r.kind === "clip").map((r) => r.moment!.id),
    [2, 3, 6, 7, 8, 9, 10, 12],
    "source then timecode",
  );
  assert.equal(asHappened.rows.filter((r) => r.voice).length, 0, "no threads, no gaps");

  const sharpest = compute(SEED.map((r) => (r.kind === "order" ? { ...r, order: "open" as const } : r)), { set });
  const first = sharpest.rows[0].moment!;
  assert.equal(first.id, 2, "the longest `strong` moment, moved to the front");
  assert.equal(sharpest.rows.filter((r) => r.kind === "clip").length, 8, "moved, not duplicated");
});

test("struck words shorten a moment, with a three-second floor", () => {
  /* Step 12. A moment struck down to nothing is still a shot to watch. */
  const m = CLIPS[1];
  const words = m.text.split(" ").length;
  assert.equal(wordDur(m), 44);
  const half: Record<number, boolean> = {};
  for (let i = 0; i < Math.floor(words / 2); i++) half[i] = true;
  assert.ok(wordDur(m, { 2: half }) < 44 * 0.6);

  const all: Record<number, boolean> = {};
  for (let i = 0; i < words; i++) all[i] = true;
  assert.equal(wordDur(m, { 2: all }), 3, "the floor, not zero");
});

test("voice over picture costs no runtime", () => {
  /* Step 11. The gap rows are the only voice rows in the sample cut, so
     putting them over picture takes exactly their 48 seconds off. */
  const plain = compute(SEED, { set });
  const over: Record<string, string> = {};
  for (const r of plain.rows.filter((r) => r.voice)) over[r.key] = "over";
  assert.equal(compute(SEED, { set, beatMode: over }).secs, 359 - 48);
});

test("a rule says what it is doing right now", () => {
  /*
   * Rule effects are first-class: computed by diffing the cut with and without
   * the rule. Without this the product is a black box with toggles, which is
   * the thing it is explicitly not.
   */
  const dropChat = ruleEffect(SEED, SEED[1], { set });
  assert.equal(dropChat.removed, 0, "nothing core is chat — it watches for it");
  assert.equal(dropChat.added, 0);

  const keepCore = ruleEffect(SEED, SEED[0], { set });
  assert.equal(keepCore.added, 8, "this rule is the reason there is a cut at all");
  assert.equal(keepCore.secs, 359);
});

test("an order rule replaces rather than stacking; other rules append", () => {
  const twice = applyRule(applyRule(SEED, { id: 9, kind: "order", order: "time", on: true }), {
    id: 10, kind: "order", order: "open", on: true,
  });
  assert.equal(twice.filter((r) => r.kind === "order").length, 1);
  assert.equal(twice.find((r) => r.kind === "order")!.order, "open");

  const caps = applyRule(applyRule(SEED, { id: 9, kind: "cap", secs: 180, on: true }), {
    id: 10, kind: "cap", secs: 120, on: true,
  });
  assert.equal(caps.filter((r) => r.kind === "cap").length, 1, "a second cap replaces the first");
  assert.equal(applyRule(SEED, { id: 9, kind: "keep", tag: "hedge", on: true }).length, 5, "keeps append");
});

test("a real library becomes a footage set the engine can run", () => {
  /*
   * PHASE 2'S ACTUAL ACCEPTANCE: the port runs "over the real document", not
   * over a fixture. An engine that only ever sees its own sample is the
   * "built, and nothing can reach it" failure this repo has had three times —
   * find-good, essay.ts, /poster.
   *
   * Threads are the sample's strands, and the ORDER of them matters: the
   * engine runs threads in the set's order, so sorting them alphabetically
   * would make a cut open on whichever topic happened to start with an early
   * letter.
   */
  const library = [
    /* "why leave" appears first and sorts LAST, so first-appearance and
       alphabetical genuinely disagree. The first version of this fixture had
       them agree, which meant the assertion below passed either way. */
    { id: "c1", source_id: "srcB", start_ms: 125_000, end_ms: 165_000, quote: "I don't like who I am here, not the city, me in it", thread_name: "why leave", heat: 2 },
    { id: "c2", source_id: "srcA", start_ms: 0, end_ms: 38_000, quote: "okay is this— yeah it's recording, where was I", thread_name: null, heat: 0 },
    { id: "c3", source_id: "srcA", start_ms: 400_000, end_ms: 444_000, quote: "the house has a room that gets sun until four", thread_name: "the house", heat: 1 },
  ];
  const built = toFootageSet(library, (m) => (m.quote.includes("recording") ? ["housekeeping"] : ["core"]));

  assert.deepEqual(built.STRANDS, ["why leave", "the house"], "first appearance, not alphabetical");
  assert.equal(built.CLIPS[0].ts, "2:05", "m:ss from start_ms");
  assert.equal(built.CLIPS[0].dur, 40, "seconds from the span");
  assert.deepEqual(built.CLIPS[0].tags, ["core"], "tags come from the function, not the row");
  assert.equal(built.CLIPS[1].src, "srcA", "the source, so chronological order is per video");
  assert.equal(built.CLIPS[1].strand, undefined, "an unthreaded moment has no strand, not an empty one");

  const out = compute(
    [
      { id: 1, kind: "keep", tag: "core", on: true },
      { id: 2, kind: "drop", tag: "housekeeping", on: true },
      { id: 3, kind: "order", order: "strand", on: true },
    ],
    { set: built },
  );
  assert.deepEqual(out.st.filter((m) => m.in).map((m) => m.id), ["c1", "c3"]);
  assert.equal(out.secs, 40 + 44, "the real durations, not the sample's");
  assert.deepEqual(
    out.rows.filter((r) => r.kind === "clip").map((r) => r.moment!.strand),
    ["why leave", "the house"],
    "and the cut runs the threads in the set's order",
  );
});

test("the cut describes itself in terms somebody can check", () => {
  /* "8 of 14 moments · 5:59 · one thread at a time · 4 to-camera gaps" is a
     cut you can verify. "8 moments" is a number you have to trust. */
  const line = describe(compute(SEED, { set }), SEED);
  assert.match(line, /^8 of 14 moments · 5:59 · one thread at a time · 4 to-camera gaps$/);

  const timeRules = SEED.map((r) => (r.kind === "order" ? { ...r, order: "time" as const } : r));
  assert.match(describe(compute(timeRules, { set }), timeRules), /as it happened$/, "no gaps, so none claimed");

  /* A note belongs with the runtime it explains. Appended at the end it read
     "one thread at a time of 2:00", which is not a sentence. */
  assert.match(
    describe(compute(SEED, { set }), SEED, " of 8:00 — that is everything that matched"),
    /· 5:59 of 8:00 — that is everything that matched · one thread at a time/,
  );
});

test("an order rule's effect says what changed, not what it is called", () => {
  /*
   * The line a rule shows is the explanation layer — "without it the product
   * is a black box with toggles". An order rule changes no MEMBERSHIP, so a
   * diff reports zero for the one rule that decides what you watch first, and
   * the first version of this duly printed "nothing here touches it" on it.
   *
   * Restating its own sentence is no better: "Run it one thread at a time"
   * answered by "one thread at a time" tells nobody anything. So it reports
   * what the cut now opens on, which is its visible consequence.
   */
  /*
   * A SET WHERE THE THREADS INTERLEAVE, which the reference's own sample does
   * not — and that is worth knowing. In the sample each source carries its own
   * threads in time order, so "one thread at a time" produces the SAME
   * sequence as "as it happened" and no honest effect line can tell them
   * apart there. Two earlier versions of this test were measuring that
   * coincidence: one reported what the cut opens on (the same moment under all
   * three orders, because the strongest line is also the earliest kept one),
   * and one reported a positional diff of zero.
   */
  const woven = {
    STRANDS: ["why", "cost"],
    CLIPS: [
      { id: "w1", src: "A", ts: "0:30", dur: 20, tags: ["core"], strand: "why", text: "I don't like who I am here" },
      { id: "w2", src: "A", ts: "1:30", dur: 20, tags: ["core"], strand: "cost", text: "rent halves and I lose everyone" },
      { id: "w3", src: "A", ts: "2:30", dur: 20, tags: ["core", "strong"], strand: "why", text: "every plan is a plan to be elsewhere" },
    ] as Moment[],
  };
  const orderOf = (o: "time" | "strand" | "open") => {
    const rs: Rule[] = [
      { id: 1, kind: "keep", tag: "core", on: true },
      { id: 2, kind: "order", order: o, on: true },
    ];
    return effectLine(rs, rs[1], { set: woven });
  };

  assert.equal(orderOf("strand"), "moves 2 of 3", "why, why, cost — against why, cost, why");
  assert.ok(!/one thread/.test(orderOf("strand")), "not a restatement of the rule");
  /* With the rule off compute() falls back to chronological, so asking for
     chronological is asking for what you already have. */
  assert.equal(orderOf("time"), "already in that order");
  assert.notEqual(orderOf("strand"), orderOf("time"));
  assert.equal(orderOf("open"), "moves 3 of 3", "the strongest line to the front moves everything");

  /* And the sample's own order rule genuinely changes nothing about the
     sequence — only the gaps, which the gap rule is credited for. */
  const sampleOrder = effectLine(SEED, SEED[2], { set });
  assert.equal(sampleOrder, "already in that order");
});

test("every other rule's effect comes from the diff", () => {
  assert.equal(effectLine(SEED, SEED[0], { set }), "brings in 8", "the keep rule is why there is a cut");
  assert.equal(
    effectLine(SEED, SEED[1], { set }),
    "nothing here touches it — it watches for it",
    "nothing core is chat in this set, and saying so is the honest answer",
  );
  assert.equal(effectLine(SEED, SEED[3], { set }), "adds 48s to camera", "the gap rule adds seconds, not moments");

  const capped = applyRule(SEED, { id: 9, kind: "cap", secs: 180, on: true });
  assert.match(effectLine(capped, capped.find((r) => r.kind === "cap")!, { set }), /^takes \d+ off the cut$/);

  const off = SEED.map((r) => (r.id === 1 ? { ...r, on: false } : r));
  assert.equal(effectLine(off, off[0], { set }), "off — footage as shot");
});

test("a rule's name says what it is, so two briefs cannot collide", () => {
  /*
   * Rules are stored under a project-scoped unique name, so the name must be
   * stable across re-parses AND unique within a set. Numbering by position is
   * neither, and the failure is a crash rather than a wrong cut: a brief
   * parsing to [order, cap] names them r-said-0 and r-said-1; a later "make it
   * 90 seconds" parses to [cap], names it r-said-0, and applyRule replaces the
   * CAP with it while the ORDER rule still holds that name. The unique
   * constraint rejects the save.
   */
  assert.equal(ruleKey({ kind: "keep", tag: "core", on: true }), "r-keep-core");
  assert.equal(ruleKey({ kind: "drop", tag: "hedge", on: true }), "r-drop-hedge");
  assert.equal(ruleKey({ kind: "cap", secs: 90, on: true }), "r-cap");
  assert.equal(ruleKey({ kind: "order", order: "open", on: true }), "r-order");

  /* A cap is a cap whatever its length, because applyRule makes it
     single-valued — so a second one must take the FIRST one's name. */
  assert.equal(ruleKey({ kind: "cap", secs: 120, on: true }), ruleKey({ kind: "cap", secs: 90, on: true }));
  /* An order likewise, whichever order it asks for. */
  assert.equal(ruleKey({ kind: "order", order: "time", on: true }), ruleKey({ kind: "order", order: "strand", on: true }));
  /* But a keep and a drop on the same tag are different rules, and a hand
     decision is the escape hatch from the tag rule rather than the same one. */
  assert.notEqual(ruleKey({ kind: "keep", tag: "core", on: true }), ruleKey({ kind: "drop", tag: "core", on: true }));
  /*
   * TWO HAND DECISIONS ON DIFFERENT MOMENTS, which is the collision that
   * actually happens — keeping clip 3 by hand and keeping clip 9 by hand are
   * two rules, and without the moment in the name both are "r-keep". The
   * first version of this compared a hand rule to a TAGGED one, which differ
   * for an unrelated reason, so it passed whether the moment was in the name
   * or not.
   */
  assert.notEqual(
    ruleKey({ kind: "keep", cid: "c3", hand: true, on: true }),
    ruleKey({ kind: "keep", cid: "c9", hand: true, on: true }),
  );
  assert.notEqual(
    ruleKey({ kind: "keep", tag: "core", on: true }),
    ruleKey({ kind: "keep", cid: "c9", hand: true, on: true }),
  );

  /* And every rule in a realistic set gets a distinct one. */
  const set2: Array<Omit<Rule, "id">> = [
    { kind: "keep", tag: "core", on: true },
    { kind: "drop", tag: "housekeeping", on: true },
    { kind: "drop", tag: "hedge", on: true },
    { kind: "order", order: "strand", on: true },
    { kind: "cap", secs: 180, on: true },
    { kind: "gap", on: true },
    { kind: "keep", cid: 13, hand: true, on: true },
    { kind: "keep", cid: 4, hand: true, on: true },
    { kind: "drop", cid: 9, hand: true, on: true },
  ];
  const keys = set2.map(ruleKey);
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
});

test("switching a rule off and on restores the cut exactly", () => {
  /*
   * PHASE 2'S ACCEPTANCE, and it is a property of re-producing the cut rather
   * than something the toggle has to be careful about: both states run the
   * same engine over the same rules, so there is nothing to drift. It is
   * pinned because the obvious alternative — patching the beats the rule
   * disagrees with — would NOT have this property, and the difference is
   * invisible until somebody toggles twice.
   */
  const capped = applyRule(SEED, { id: "r-cap", kind: "cap", secs: 180, on: true });
  const before = compute(capped, { set });

  const off = capped.map((r) => (r.id === "r-cap" ? { ...r, on: false } : r));
  const loosened = compute(off, { set });
  assert.notEqual(loosened.secs, before.secs, "the rule has to be doing something, or this proves nothing");

  const backOn = off.map((r) => (r.id === "r-cap" ? { ...r, on: true } : r));
  const after = compute(backOn, { set });
  assert.equal(after.secs, before.secs);
  assert.deepEqual(after.rows.map((r) => r.key), before.rows.map((r) => r.key));
  assert.deepEqual(
    after.st.filter((m) => m.in).map((m) => m.id),
    before.st.filter((m) => m.in).map((m) => m.id),
  );
});
