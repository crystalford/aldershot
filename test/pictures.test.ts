/**
 * WHAT GOES ON SCREEN, AND WHY.
 *
 * Doc 08's premise: "Every script-to-video tool matches nouns: 'the court
 * ruled' gets a stock gavel. That is an integrity problem, not a style
 * one — a related but non-probative picture makes a claim more likely to be
 * judged true."
 *
 * Phase 5's acceptance asks for ONE of these to be tested — "a generated
 * image can never be placed on an EVIDENCE or CLAIM block (test the
 * refusal)" — and the rest are here because a refusal nobody can see the
 * edges of is a refusal nobody can trust.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_LABEL,
  MOVES,
  MOVE_RULES,
  SEEN_PENALTY,
  SOURCE_WEIGHT,
  allowed,
  place,
  chartIsRenderable,
  lintChart,
  type Candidate,
  type ChartSpec,
  type Move,
  type Source,
} from "../src/pictures.ts";

const pic = (id: string, source: Source, over: Partial<Candidate> = {}): Candidate => ({
  id,
  source,
  kind: source === "generated" ? "synthetic" : source === "documents" ? "evidence" : "illustration",
  ...over,
});

/* ── THE ACCEPTANCE ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: a generated picture can never carry evidence or a claim", () => {
  /*
   * Invariant 8, the half with teeth. This is the refusal the build order
   * asks to be tested rather than intended, and it is checked BEFORE the
   * move's own source preferences — a prohibition, not a ranking.
   */
  for (const move of ["evidence", "claim"] as Move[]) {
    const r = allowed(move, pic("g", "generated"));
    assert.ok(r.reason, `${move} must refuse a generated picture`);
    assert.match(r.reason!, /generated picture cannot carry/);
  }

  /* And it cannot win by being the only candidate. */
  const out = place("evidence", [pic("g", "generated")]);
  assert.equal(out.picture, null);
  assert.equal(out.refused.length, 1);
  assert.match(out.reason, /holding on the speaker/);
});

test("a generated picture is fine where the move allows it", () => {
  /* The refusal is about claims and proof, not about generation. Context
     and abstraction both take one. */
  assert.equal(allowed("context", pic("g", "generated")).reason, null);
  assert.equal(allowed("abstraction", pic("g", "generated")).reason, null);
});

/* ── The other refusals ─────────────────────────────────────────────────── */

test("generated is never photoreal, on any move at all", () => {
  /* Decision 26, and doc 08: AI imagery lowers trust even when labelled. */
  for (const move of MOVES) {
    const r = allowed(move, pic("g", "generated", { photoreal: true }));
    assert.ok(r.reason, `${move} must refuse a photoreal generation`);
  }
  assert.match(allowed("context", pic("g", "generated", { photoreal: true })).reason!, /never photoreal/);
});

test("evidence has to be evidence, not a picture of the subject", () => {
  /*
   * THE GAVEL PROBLEM IN ONE LINE. A picture merely about the same subject
   * makes a claim more likely to be believed without being any reason to
   * believe it.
   */
  const r = allowed("evidence", pic("stocky", "world", { probative: false }));
  assert.ok(r.reason);
  const own = allowed("evidence", pic("mine", "own", { probative: false }));
  assert.match(own.reason!, /about the subject rather than evidence of it/);
});

test("a source the move does not want is refused in the move's own words", () => {
  assert.match(allowed("claim", pic("d", "documents")).reason!, /shown by who made it/);
  assert.match(allowed("joke", pic("w", "world")).reason!, /lands on a face or on nothing/);
  assert.match(allowed("turn", pic("g", "world")).reason!, /two things of yours/);
});

test("every move says what it wants and what it refuses", () => {
  /* A move with no rule would silently accept anything. */
  for (const move of MOVES) {
    const rule = MOVE_RULES[move];
    assert.ok(rule.job.length > 5, move);
    assert.ok(rule.wants.length >= 1, move);
    assert.ok(rule.refuses.length > 5, move);
  }
});

/* ── Choosing ───────────────────────────────────────────────────────────── */

test("your own footage comes first, then documents, then the world", () => {
  const out = place("context", [pic("w", "world"), pic("o", "own")]);
  assert.equal(out.picture?.id, "o");
  assert.match(out.reason, /your own footage/);

  assert.ok(SOURCE_WEIGHT.own > SOURCE_WEIGHT.documents);
  assert.ok(SOURCE_WEIGHT.documents > SOURCE_WEIGHT.world);
  assert.ok(SOURCE_WEIGHT.world > SOURCE_WEIGHT.generated);
});

test("a forbidden candidate never wins on being interesting", () => {
  /* The refusals run before any of the scoring, so a generated picture of
     exactly the right thing still loses to nothing at all. */
  const out = place("claim", [pic("g", "generated", { probative: true, subject: "the house" })]);
  assert.equal(out.picture, null);
});

test("nothing to show is a RESULT, and says which kind of nothing", () => {
  /*
   * For a claim or a joke the face is usually the strongest picture, and a
   * product that always found something would be the gavel problem with
   * extra steps. The two cases read differently because they are: one had
   * nothing, the other had things it would not use.
   */
  assert.match(place("joke", []).reason, /nothing to show/);
  assert.match(place("joke", [pic("w", "world")]).reason, /nothing here can carry this line/);
});

test("something already shown loses to something new, but not to a worse tier", () => {
  /*
   * Doc 08 asks for a novelty penalty. Showing the same document twice
   * still beats inventing a picture — which is the trade the size of the
   * penalty encodes.
   */
  const seen = new Set(["the letter"]);
  const fresh = place(
    "example",
    [pic("a", "documents", { subject: "the letter" }), pic("b", "documents", { subject: "the invoice" })],
    seen,
  );
  assert.equal(fresh.picture?.id, "b");

  const vsGenerated = place(
    "example",
    [pic("a", "documents", { subject: "the letter" }), pic("g", "generated", { subject: "new" })],
    seen,
  );
  assert.equal(vsGenerated.picture?.id, "a", "a repeat of the real thing beats a new invented one");
  assert.ok(SEEN_PENALTY < SOURCE_WEIGHT.documents - SOURCE_WEIGHT.generated);
});

test("a TURN is allowed to repeat on purpose", () => {
  /* It is the one move that means "this, again, differently". */
  const seen = new Set(["the kitchen"]);
  const out = place(
    "turn",
    [pic("again", "own", { subject: "the kitchen" }), pic("new", "own", { subject: "the hall" })],
    seen,
  );
  assert.equal(out.picture?.id, "again");
  assert.match(out.reason, /again, against itself/);
});

test("ties keep the order they were found in", () => {
  const out = place("context", [pic("first", "own"), pic("second", "own")]);
  assert.equal(out.picture?.id, "first");
});

test("every refusal is reported with the reason it was refused", () => {
  /* For the receipt: "why am I NOT seeing that" is a question too. */
  const out = place("evidence", [
    pic("g", "generated"),
    pic("photo", "generated", { photoreal: true }),
    pic("d", "documents", { probative: true }),
  ]);
  assert.equal(out.picture?.id, "d");
  assert.equal(out.refused.length, 2);
  assert.ok(out.refused.every((r) => r.reason.length > 5));
});

/* ── Typed, and labelled ────────────────────────────────────────────────── */

test("a picture is typed, and the type is what the label says", () => {
  /* Doc 08: "Every picture is typed evidence / illustration / synthetic;
     the type sets the on-screen label and the cue-sheet entry." */
  assert.deepEqual(Object.keys(KIND_LABEL).sort(), ["evidence", "illustration", "synthetic"]);
  assert.equal(KIND_LABEL.synthetic, "Generated");
});

test("no number reaches the answer", () => {
  /*
   * Invariant 3. The weights order candidates and never leave the module;
   * what comes back is a picture and a sentence.
   */
  const out = place("context", [pic("o", "own", { subject: "the hall" })]);
  assert.deepEqual(Object.keys(out).sort(), ["picture", "reason", "refused"]);
  assert.doesNotMatch(out.reason, /\d/);
});

/* ── Graphics are code, never pixels ────────────────────────────────────── */

const chart = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  mark: "bar",
  baseline: 0,
  units: "£",
  categories: ["rent", "bills"],
  data: [
    { value: 1200, provenance: { doc: "tenancy.pdf", page: 2, cell: "B7" } },
    { value: 640, provenance: { doc: "tenancy.pdf", page: 2, cell: "B8" } },
  ],
  ...over,
});

test("ACCEPTANCE: a chart with a non-zero baseline fails the lint", () => {
  /*
   * Decision 27: bars start at zero, and truncated axes mislead even when
   * explained. A bar is a LENGTH, and a length from a non-zero baseline is
   * a lie about a ratio before anybody reads a label.
   */
  const out = lintChart(chart({ baseline: 400 }));
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "baseline");
  assert.match(out[0].reason, /bars start at zero/);
  assert.equal(chartIsRenderable(chart({ baseline: 400 })), false);
});

test("a line may start anywhere, because it encodes position not magnitude", () => {
  /* The lint is about the MARK, not about axes in general — a line chart
     forced to zero wastes the whole plot on empty space. */
  assert.deepEqual(lintChart(chart({ mark: "line", baseline: 400 })), []);
});

test("the rest of doc 08's hard fails", () => {
  const kinds = (s: Partial<ChartSpec>) => lintChart(chart(s)).map((l) => l.kind);
  assert.deepEqual(kinds({ dualAxis: true }), ["dual-axis"]);
  assert.deepEqual(kinds({ mark: "area", oneDimensional: true }), ["area-1d"]);
  assert.deepEqual(kinds({ categories: Array.from({ length: 8 }, (_, i) => `c${i}`) }), ["colours"]);
  assert.deepEqual(kinds({ units: null }), ["units"]);
  assert.deepEqual(kinds({ units: "   " }), ["units"], "a blank unit is no unit");
});

test("a number with no source blocks the chart", () => {
  /*
   * Invariant 4 inside a chart. A number on screen with no receipt is the
   * claim the receipts exist to make impossible — and a chart is the
   * easiest place in a video to put one.
   */
  const out = lintChart(chart({ data: [{ value: 5 }, { value: 6, provenance: { doc: "a.pdf" } }] }));
  assert.equal(out[0].kind, "provenance");
  assert.match(out[0].reason, /1 of 2 numbers have no source/);
  /* An empty provenance is not provenance. */
  assert.equal(lintChart(chart({ data: [{ value: 5, provenance: { doc: "" } }] }))[0].kind, "provenance");
});

test("an area chart of two-dimensional data is fine", () => {
  assert.deepEqual(lintChart(chart({ mark: "area", oneDimensional: false })), []);
});

test("a clean chart renders, and every failure says why in words", () => {
  assert.deepEqual(lintChart(chart()), []);
  assert.equal(chartIsRenderable(chart()), true);
  const many = lintChart(chart({ baseline: 10, dualAxis: true, units: null, data: [{ value: 1 }] }));
  assert.equal(many.length, 4, "every failure is reported, not just the first");
  for (const l of many) {
    assert.ok(l.reason.length > 20, l.kind);
    assert.doesNotMatch(l.reason, /invalid|malformed|error/i, "it says what is wrong, not that something is");
  }
});

/*
 * ── A verified Scout find, on an EVIDENCE line ───────────────────────────
 *
 * Doc 08's table gives EVIDENCE "own footage → user's documents" and forbids
 * "generated anything · stock · I2V". It forbids STOCK and never mentions a
 * verified recording, because Scout is doc 18 and did not exist when the
 * table was written — and this codebase maps both onto `world`.
 *
 * The Manual is the later word on what the product is, and it says Scout
 * "finds what it's missing — the proof". So the test is what a candidate IS,
 * not where it came from.
 */

test("ACCEPTANCE: a verified outside recording may carry evidence", () => {
  /* kind evidence AND probative: the deterministic verifier matched the
     quote word for word against the recording. "Proof cannot be illustrated;
     it has to be the thing itself" — and this is the thing itself. */
  assert.equal(
    allowed("evidence", { id: "L1", source: "world", kind: "evidence", probative: true }).reason,
    null,
  );
});

test("ACCEPTANCE: and stock still cannot, which is the door this must not open", () => {
  /*
   * The beat insert builds a stock candidate as `kind: "illustration"` with
   * no probative flag — see /api/projects/:id/beats in src/index.ts. Doc 08
   * forbids exactly this and the change above must not admit it.
   */
  const stock = allowed("evidence", { id: "new", source: "world", kind: "illustration" });
  assert.ok(stock.reason, "stock footage was admitted as evidence");
  assert.match(stock.reason, /proof cannot be illustrated/);

  /* Nor an outside clip that calls itself evidence without having been
     checked. Verified is a fact in a column, not a label a caller picks. */
  const unchecked = allowed("evidence", { id: "x", source: "world", kind: "evidence" });
  assert.ok(unchecked.reason, "an unverified outside clip was admitted as evidence");
});

test("ACCEPTANCE: generated is still refused on evidence and on a claim", () => {
  /* Phase 5's named acceptance, re-asserted next to the change that could
     have weakened it. Checked before any source list, so no amount of
     claiming to be probative evidence gets a generated picture through. */
  for (const move of ["evidence", "claim"] as const) {
    const no = allowed(move, { id: "g", source: "generated", kind: "evidence", probative: true });
    assert.ok(no.reason, `${move} admitted a generated picture`);
    assert.match(no.reason, /generated picture cannot carry/);
  }
});

test("the new door is only open on evidence", () => {
  /* A claim is shown by who made it. A verified outside recording of
     somebody else saying the thing is not the speaker making this claim. */
  const onClaim = allowed("claim", { id: "L1", source: "world", kind: "evidence", probative: true });
  assert.ok(onClaim.reason, "a claim admitted an outside recording");
});

/*
 * ── On an EVIDENCE line, being the proof beats being yours ───────────────
 *
 * The bonus for probative was a flat 0.1, which can never close the 0.2
 * between `own` and `documents` — so a marked document that IS the proof
 * always lost to whatever clip retrieval returned from the maker's own
 * library. Found by driving it: an evidence line about a dated memo was
 * given a clip saying "I don't like who I am here", with the document
 * sitting underneath it marked and ignored.
 */

test("ACCEPTANCE: a marked document outranks an unmarked own clip on evidence", () => {
  const mine = { id: "own", source: "own", kind: "illustration" } as const;
  const memo = { id: "doc", source: "documents", kind: "evidence", probative: true } as const;
  assert.equal(place("evidence", [mine, memo]).picture?.id, "doc");
});

test("ACCEPTANCE: and a verified outside recording does too", () => {
  /* `world` is 0.5 against own's 1, the widest gap the bonus has to clear —
     which is why it is sized to clear it. */
  const mine = { id: "own", source: "own", kind: "illustration" } as const;
  const found = { id: "L1", source: "world", kind: "evidence", probative: true } as const;
  assert.equal(place("evidence", [mine, found]).picture?.id, "L1");
});

test("two probative candidates fall back to invariant 8's order", () => {
  /* The bonus decides proof against not-proof. It must not flatten the
     source order between two things that are both proof: own footage of the
     thing still comes before a document of it. */
  const mine = { id: "own", source: "own", kind: "evidence", probative: true } as const;
  const memo = { id: "doc", source: "documents", kind: "evidence", probative: true } as const;
  const found = { id: "L1", source: "world", kind: "evidence", probative: true } as const;
  assert.equal(place("evidence", [memo, found, mine]).picture?.id, "own");
  assert.equal(place("evidence", [found, memo]).picture?.id, "doc");
});

test("the bonus does not reorder any other move", () => {
  /*
   * CONTEXT wants own → world → generated, and a probative world candidate
   * must not jump the maker's own footage there: only EVIDENCE is defined by
   * being proof. Broken by making the bonus unconditional, this fails.
   */
  const mine = { id: "own", source: "own", kind: "illustration" } as const;
  const found = { id: "L1", source: "world", kind: "evidence", probative: true } as const;
  assert.equal(place("context", [found, mine]).picture?.id, "own");
});
