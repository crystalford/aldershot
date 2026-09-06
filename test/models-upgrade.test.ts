/**
 * The reasoning upgrade has to buy something.
 *
 * "Better reasoning" was Claude or nothing, gated on ANTHROPIC_API_KEY — which
 * is not set — so resolveModel fell through and handed back the DEFAULT model.
 * The upgrade this product sells in its own UI silently did nothing on any
 * account that had not gone and bought a second AI subscription. Same shape as
 * every other dead control found this session, just further from the surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModel, REASON, REASON_UPGRADE, UPGRADES } from "../src/models.ts";

test("the reasoning upgrade is a different model, with no external key", () => {
  const base = resolveModel("reason", {});
  const up = resolveModel("reason", {}, "upgrade");
  assert.notEqual(up.id, base.id, "an upgrade that returns the default model is not an upgrade");
  assert.equal(up.provider, "workers-ai", "it must not need a second account to work at all");
});

test("the upgrade still supports structured output", () => {
  // Every pass asks for json_schema; a model without it would fail on use
  // rather than at resolve time, which is the worst place to find out.
  assert.equal(resolveModel("reason", {}, "upgrade").jsonSchema, true);
  assert.equal(REASON_UPGRADE.jsonSchema, true);
});

test("it is the same family as the default, not a different vendor", () => {
  // Same window, same structured output, no second bill — the step up is
  // capability, not a switch to somewhere else with its own failure modes.
  assert.ok(REASON_UPGRADE.id.startsWith("@cf/"), "the fallback upgrade stays native");
  assert.equal(REASON_UPGRADE.context, REASON.context);
});

test("a configured Anthropic key still wins", () => {
  const up = resolveModel("reason", { ANTHROPIC_API_KEY: "k" }, "upgrade");
  assert.equal(up.provider, "anthropic");
});

test("the offer no longer claims to need a key it does not need", () => {
  assert.equal(UPGRADES.reason.requiresKey, null);
});
