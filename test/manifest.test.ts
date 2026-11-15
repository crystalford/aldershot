/**
 * THE PROVENANCE MANIFEST.
 *
 * Doc 09 marks the Provenance record row "always on": every source, every
 * edit, and for each claim the line in the footage that backs it.
 *
 * "Every edit" is the rule set — invariant 1 says a cut IS its rules — so
 * most of these are about the rules being recorded faithfully, including the
 * ones somebody switched off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MANIFEST_VERSION, NOT_COVERED, buildManifest, manifestJson, type ManifestInput } from "../src/manifest.ts";
import { disputeEntries, type DisputeClip } from "../src/dispute.ts";
import { cueSheet } from "../src/cuesheet.ts";
import type { Rule } from "../src/rules.ts";

const RULES: Rule[] = [
  { id: "r1", kind: "keep", tag: "core", on: true, text: "Keep the parts where you're working something out." },
  { id: "r2", kind: "drop", tag: "housekeeping", on: true, text: "Take out the hellos." },
  { id: "r3", kind: "cap", secs: 120, on: false, text: "Keep it under 2 minutes." },
];

const clip = (over: Partial<DisputeClip> = {}): DisputeClip => ({
  ledgerId: "l1",
  channel: "Council Live",
  sourceTitle: "Full council meeting",
  platform: "youtube",
  url: "https://example.org/a",
  inS: 1200,
  outS: 1214,
  originalS: 4800,
  credit: "Source: Council Live",
  creditRemoved: false,
  quote: "We moved the launch.",
  ...over,
});

const input = (over: Partial<ManifestInput> = {}): ManifestInput => ({
  projectId: "p1",
  title: "Whether to leave",
  runtimeS: 360,
  sources: [{ id: "s1", title: "Tuesday — the kitchen one", from: "yours" }],
  rules: RULES,
  leftOut: [{ momentId: "m2", text: "can you hear me okay", rule: "Take out the hellos." }],
  struckOut: [{ blockId: "s:3", text: "so anyway that was the week" }],
  pictures: [],
  external: [],
  claim: null,
  madeAt: Date.UTC(2026, 9, 21, 9, 30),
  ...over,
});

test("it carries a version, because a record with no version can never change", () => {
  assert.equal(buildManifest(input()).manifest, MANIFEST_VERSION);
});

test("every rule is in it, including the ones switched off", () => {
  /*
   * Invariant 6: rules switch off, they are not deleted. "There was never
   * such a rule" and "somebody turned that rule off" are different facts
   * about how a cut was made — the same distinction the dispute file draws
   * about a credit that was removed.
   */
  const m = buildManifest(input());
  assert.equal(m.rules.length, 3);
  assert.deepEqual(m.rules.map((r) => r.on), [true, true, false]);
  assert.deepEqual(m.rules.map((r) => r.n), [1, 2, 3], "numbered as the pane numbers them");
  assert.equal(m.rules[2].says, "Keep it under 2 minutes.");
});

test("ACCEPTANCE: what was left out says which rule took it", () => {
  /* "Every edit" means more than the rules that kept things: a record that
     only listed what survived would describe a cut without describing the
     cutting. */
  const m = buildManifest(input());
  assert.equal(m.leftOut.length, 1);
  assert.equal(m.leftOut[0].text, "can you hear me okay");
  assert.equal(m.leftOut[0].rule, "Take out the hellos.");
});

test("the claim and its beats, where there was a plan", () => {
  const m = buildManifest(
    input({
      claim: {
        text: "Leaving is a trade, not an escape.",
        beats: [{ name: "The cost", need: "the rent line", found: ["m4"] }],
      },
    }),
  );
  assert.equal(m.claim?.text, "Leaving is a trade, not an escape.");
  assert.deepEqual(m.claim?.beats[0].found, ["m4"]);

  /* And null rather than an empty shape when there was no plan: a cut made by
     striking text makes no claim this product knows about. */
  assert.equal(buildManifest(input()).claim, null);
});

test("external clips carry how much was used and what the credit said", () => {
  const m = buildManifest(input({ external: disputeEntries([clip(), clip({ ledgerId: "l2", creditRemoved: true })]) }));
  assert.equal(m.external.length, 2);
  assert.equal(m.external[0].usedS, 14);
  assert.equal(m.external[0].ofS, 4800);
  assert.equal(m.external[0].fractionOfOriginal, 14 / 4800);
  assert.equal(m.external[1].creditRemoved, true, "removed is recorded, not erased");
});

test("pictures carry their label and how they were made", () => {
  const m = buildManifest(input({ pictures: cueSheet([{ id: "b", kind: "generated", text: "A map" }]) }));
  assert.equal(m.pictures[0].label, "Generated");
  assert.match(m.pictures[0].how, /Nothing generated for it yet/);
});

test("ACCEPTANCE: what the record does not cover is part of the record", () => {
  /*
   * Doc 09 asks for two things this cannot do — a per-claim evidence ledger,
   * and keeping provenance already written into the source files. A manifest
   * silent about those would be claiming properties its own specification
   * names. The gaps are in the file, not in a comment somebody finds later.
   */
  const m = buildManifest(input());
  assert.deepEqual(m.notCovered, NOT_COVERED);
  const text = m.notCovered.join(" ");
  assert.match(text, /evidence table in doc 03 is not built/);
  assert.match(text, /C2PA/);
  assert.match(text, /Nothing fingerprints uploaded footage/);
});

test("it is JSON a person can open when something has gone wrong", () => {
  const out = manifestJson(buildManifest(input()));
  assert.match(out, /\n  "cut": \{/, "indented");
  const back = JSON.parse(out);
  assert.equal(back.cut.title, "Whether to leave");
  assert.equal(back.cut.madeAt, "2026-10-21T09:30:00.000Z", "an instant, not a local date");
  assert.equal(back.cut.runtimeS, 360);
});

test("an unrendered cut has no runtime, and says null rather than zero", () => {
  /* Zero seconds is a real runtime and a wrong one. */
  assert.equal(buildManifest(input({ runtimeS: null })).cut.runtimeS, null);
});

test("ACCEPTANCE: striking a line is an edit, and is recorded as one", () => {
  /*
   * THE FIRST VERSION OF THIS FILE MISSED IT.
   *
   * `leftOut` records moments a rule removed. On a cut made the main way this
   * product is used — "the editor is the transcript: strike what you don't
   * want" — there are no scored moments, so the engine judges nothing and
   * leftOut comes back empty. Measured against the real project: four rules
   * doing visible work and an empty record of what they did.
   *
   * A record of "every edit" that omits striking is a record of the rules,
   * which is a different and smaller claim.
   */
  const m = buildManifest(input());
  assert.equal(m.struckOut.length, 1);
  assert.equal(m.struckOut[0].text, "so anyway that was the week");

  /* And the two are kept apart: a rule removing something and a person
     striking it are different facts about how the cut came to be. */
  assert.notDeepEqual(m.struckOut, m.leftOut);
  assert.ok("rule" in m.leftOut[0], "a rule removal says which rule");
  assert.ok(!("rule" in m.struckOut[0]), "a struck line had no rule behind it");
});
