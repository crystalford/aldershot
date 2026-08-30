import { test } from "node:test";
import assert from "node:assert/strict";

import { PLANS, type Plan } from "../src/plans.ts";

/*
 * These numbers are what a customer reads on the pricing page before paying,
 * so they are asserted rather than left to drift. Landing.dc.html and the
 * Settings panel both show them; 05-INFRA-AND-COSTS.md disagrees, and the
 * prototype wins (see the note in src/plans.ts).
 */
test("Free is the prototype's Free", () => {
  assert.equal(PLANS.free.label, "Free");
  assert.equal(PLANS.free.price, 0);
  assert.equal(PLANS.free.sourceMinutes, 300);
  assert.equal(PLANS.free.storageGb, 25);
});

test("Studio is the prototype's Studio", () => {
  assert.equal(PLANS.studio.label, "Studio");
  assert.equal(PLANS.studio.price, 29);
  assert.equal(PLANS.studio.sourceMinutes, 1200);
  assert.equal(PLANS.studio.storageGb, 100);
});

/*
 * "pro" predates the two-tier pricing. Any row still carrying it must behave
 * as Studio rather than falling through to a smaller cap, which would cut off
 * an account that had paid.
 */
test("a legacy pro row gets Studio's allowance, not Free's", () => {
  assert.deepEqual(PLANS.pro, PLANS.studio);
});

test("every plan is a real plan with a positive allowance", () => {
  for (const key of ["free", "pro", "studio"] as Plan[]) {
    assert.ok(PLANS[key], `${key} is missing`);
    assert.ok(PLANS[key].sourceMinutes > 0, `${key} has no minutes`);
    assert.ok(PLANS[key].storageGb > 0, `${key} has no storage`);
  }
});

/* Nothing is unlimited on a variable-cost product (05-INFRA-AND-COSTS.md). */
test("no plan is unlimited", () => {
  for (const p of Object.values(PLANS)) {
    assert.ok(Number.isFinite(p.sourceMinutes));
    assert.ok(Number.isFinite(p.storageGb));
  }
});
