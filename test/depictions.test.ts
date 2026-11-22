/**
 * DEPICTIONS — a generated picture over a claim, when a person puts it there
 * (decision 26 as of 21 Nov; doc 22, row 3).
 *
 * What changed, and what didn't. A generated picture may now sit over a
 * line known to be a claim when somebody chose it for that line, and it
 * goes out labelled as a depiction with the claim's receipt unchanged. It is
 * still never the proof, never photoreal, and never something the product
 * reaches for on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DEPICTION_LABEL, KIND_LABEL, allowed, place, type Candidate, type Source } from "../src/pictures.ts";
import { cueSheet, labelFor } from "../src/cuesheet.ts";
import { getBeats, insertBeat, moveBeat } from "../src/projects.ts";
import { fakeD1, schema } from "./helpers/fake-d1.ts";

const pic = (id: string, source: Source, over: Partial<Candidate> = {}): Candidate => ({
  id,
  source,
  kind: source === "generated" ? "synthetic" : source === "documents" ? "evidence" : "illustration",
  ...over,
});

test("a generated picture a person chose for a known claim is allowed, as a depiction", () => {
  const r = allowed("claim", pic("g", "generated"), { depict: true });
  assert.equal(r.reason, null);
  assert.equal(r.depicts, true);
});

test("without both halves it is still refused: chosen, and the line known", () => {
  /* The caller passes depict only when a person chose it AND the line's
     move was answered; either missing is the old refusal. */
  const r = allowed("claim", pic("g", "generated"));
  assert.match(r.reason!, /generated picture cannot carry a claim/);
  assert.ok(!r.depicts);
});

test("never the proof, whoever asks", () => {
  const r = allowed("evidence", pic("g", "generated"), { depict: true });
  assert.match(r.reason!, /generated picture cannot carry evidence/);
  assert.ok(!r.depicts);
});

test("never photoreal, even as a depiction", () => {
  const r = allowed("claim", pic("g", "generated", { photoreal: true }), { depict: true });
  assert.ok(r.reason);
  assert.ok(!r.depicts);
});

test("only generated pictures depict: a stock clip over a claim is still the gavel problem", () => {
  const r = allowed("claim", pic("s", "world"), { depict: true });
  assert.ok(r.reason, "somebody else's picture of the subject is still refused over a claim");
});

test("the automatic offer never puts a generated picture over a claim", () => {
  /* place() is the product choosing; it doesn't pass depict, so doc 08's
     order still decides what is offered and a claim holds on the speaker. */
  const out = place("claim", [pic("g", "generated")]);
  assert.equal(out.picture, null);
  assert.equal(out.refused.length, 1);
});

test("the label says it's a depiction, on screen and in the cue sheet", () => {
  assert.equal(labelFor("generated", 1), DEPICTION_LABEL);
  assert.equal(labelFor("generated", null), KIND_LABEL.synthetic);
  /* A flag on a stock beat changes nothing: only generated pictures depict. */
  assert.equal(labelFor("stock", 1), KIND_LABEL.illustration);

  const [dep, plain] = cueSheet([
    { id: "b1", kind: "generated", text: "the rover landing", media_r2_key: "k", over_claim: 1 },
    { id: "b2", kind: "generated", text: "a quiet street", media_r2_key: "k2" },
  ]);
  assert.equal(dep.label, DEPICTION_LABEL);
  assert.match(dep.how, /depiction of the claim it sits over, which keeps its own receipt; never the proof/);
  assert.equal(plain.label, KIND_LABEL.synthetic);
  assert.match(plain.how, /never the proof/);
});

test("the flag survives a beat being moved, so the label can't fall off", async () => {
  /* putBeats rewrites every row on any change. A column it forgot would be
     cleared by the first move, and the picture would lose its label while
     still sitting over the claim. */
  const d = new DatabaseSync(":memory:");
  schema(d);
  const db = fakeD1(d) as unknown as D1Database;
  await insertBeat(db, "p1", 0, { kind: "vo", text: "a line" });
  await insertBeat(db, "p1", 1, { kind: "generated", text: "the rover landing", over_claim: true });
  const before = await getBeats(db, "p1");
  const gen = before.find((b) => b.kind === "generated")!;
  assert.equal(gen.over_claim, 1);
  await moveBeat(db, "p1", gen.id, -1);
  const after = await getBeats(db, "p1");
  assert.equal(after[0].id, gen.id);
  assert.equal(after[0].over_claim, 1);
  assert.equal(after[1].over_claim, null);
});
