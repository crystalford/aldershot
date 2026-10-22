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
import { CAPABILITIES, resolveFor, resolveModel, REASON, REASON_UPGRADE, UPGRADES } from "../src/models.ts";
import type { Capability } from "../src/models.ts";

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

/*
 * ── Temperature, which only one provider accepts ────────────────────────
 *
 * Nothing in this product set one, so the judge was nondeterministic — the
 * same model over the same 40 adversarial judgements returned 0.0% false
 * support and then 11.1% an hour later. A verdict that flickers is a receipt
 * that is under a claim today and gone tomorrow.
 *
 * Fixing that means pinning the capabilities whose answer is a decision, and
 * Anthropic will not be pinned: Opus 5.5, Opus 5, Sonnet 5.5 and the Fable
 * line all return a 400 for `temperature`. src/llm.ts throws rather than
 * send one there, which is right and is total — the capability goes dark
 * instead of degrading — so the thing to catch is the resolve, not the call.
 */

const CAPS = Object.keys(CAPABILITIES) as Capability[];

test("ACCEPTANCE: no capability resolves to Anthropic with a temperature", () => {
  /*
   * THE BREAK THAT FAILED NOTHING. Adding `...temp(spec)` to the Anthropic
   * branch of resolveFor passed every test in the suite; only a live call
   * would have found it, as a 400 with a remote cause.
   */
  for (const cap of CAPS) {
    const r = resolveFor(cap, { ANTHROPIC_API_KEY: "sk-ant-aaaaaaaa" });
    if (r.provider !== "anthropic") continue;
    assert.equal(
      r.temperature,
      undefined,
      `${cap} resolved to ${r.id} carrying temperature ${r.temperature} — that request is a 400`,
    );
  }
});

test("a pinned capability keeps its temperature on Workers AI", () => {
  /* And the other direction: the pin has to survive the resolve, or the
     table in CAPABILITIES is documentation of something that never happens. */
  const pinned = CAPS.filter((c) => CAPABILITIES[c].temperature !== null);
  assert.ok(pinned.length, "no capability is pinned, so this test asserts nothing");
  for (const cap of pinned) {
    const r = resolveFor(cap, {});
    assert.equal(r.provider, "workers-ai");
    assert.equal(r.temperature, CAPABILITIES[cap].temperature, `${cap} lost its temperature`);
  }
});

test("a prose capability carries none, rather than zero", () => {
  const loose = CAPS.filter((c) => CAPABILITIES[c].temperature === null);
  assert.ok(loose.length, "every capability is pinned, so this test asserts nothing");
  for (const cap of loose) {
    assert.equal(resolveFor(cap, {}).temperature, undefined, `${cap} was pinned by accident`);
  }
});
