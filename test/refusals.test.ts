/**
 * WHAT THE PRODUCT REFUSES, AS A PUBLIC DOCUMENT.
 *
 * The gate rule in scripts/check-fidelity.cjs does the hard half — it proves
 * every refusal is backed by a check or a test that runs, and that a comment
 * describing a rule is not accepted as the rule. What it cannot do is call the
 * function. These tests are the shape of the document itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUSALS, refusalsDocument } from "../src/refusals.ts";

type Doc = {
  product: string;
  refuses: Array<{ id: string; says: string; invariant: number; enforced: string }>;
  receipts: { page: string; data: string };
};

test("every refusal names one of the ten invariants, once", () => {
  const ids = REFUSALS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "two refusals share an id");
  for (const r of REFUSALS) {
    assert.ok(r.invariant >= 1 && r.invariant <= 10, `${r.id} cites invariant ${r.invariant}`);
  }
});

/*
 * THE ANCHORS ARE NOT FOR READERS.
 *
 * They are paths inside a private repository: no use to anybody outside, and
 * structure given away for nothing. The gate checks this too, because it is
 * the kind of field that gets added back by somebody being helpful.
 */
test("the published document carries no internal anchor", () => {
  const json = JSON.stringify(refusalsDocument("https://example.test"));
  assert.ok(!json.includes("anchor"), "the document leaks its anchors");
  assert.ok(!json.includes("check-fidelity"), "the document names an internal file");
  assert.ok(!json.includes(".test.ts"), "the document names a test file");
});

test("the receipt addresses are built from the origin it was asked on", () => {
  const doc = refusalsDocument("https://aldershot.example") as Doc;
  assert.equal(doc.receipts.page, "https://aldershot.example/r/<token>");
  assert.equal(doc.receipts.data, "https://aldershot.example/r/<token>.json");
  /* A different origin must give different addresses — a hardcoded host would
     pass the two assertions above if they were written against one origin. */
  const other = refusalsDocument("http://localhost:8787") as Doc;
  assert.equal(other.receipts.data, "http://localhost:8787/r/<token>.json");
});

test("every refusal reaches the document, with its sentence intact", () => {
  const doc = refusalsDocument("https://example.test") as Doc;
  assert.equal(doc.refuses.length, REFUSALS.length);
  for (const r of REFUSALS) {
    const published = doc.refuses.find((x) => x.id === r.id);
    assert.ok(published, `${r.id} is declared and not published`);
    assert.equal(published.says, r.says);
    assert.equal(published.enforced, r.enforced);
  }
});
