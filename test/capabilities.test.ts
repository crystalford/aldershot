/**
 * CAPABILITIES, NOT TIERS.
 *
 * There was one reasoning role and a binary tier, so every reasoning call in
 * the product shared one model and the only question was "better or not".
 * That was the right shape when Aldershot cut blocks and asked a model to
 * score them. The reasoning layer is the editing now, and the calls in it do
 * not resemble each other: deciding whether a clip backs a claim is invariant
 * 4, and naming a project is a title.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTHROPIC_BEST, CAPABILITIES, REASON, REASON_UPGRADE, resolveFor, type Capability } from "../src/models.ts";

const WITH_KEY = { ANTHROPIC_API_KEY: "sk-ant-aaaaaaaa" };
const NO_KEY = {};
const ALL = Object.keys(CAPABILITIES) as Capability[];

test("ACCEPTANCE: load-bearing work gets the best model there is", () => {
  /*
   * judge decides whether a clip backs a claim; classify decides whether a
   * generated picture may sit over one; direct decides what the video says.
   * A wrong answer in any of the three breaks an invariant rather than
   * producing a worse cut.
   */
  for (const cap of ALL.filter((c) => CAPABILITIES[c].loadBearing)) {
    const m = resolveFor(cap, WITH_KEY);
    assert.equal(m.provider, "anthropic", `${cap} is not on the best model`);
    assert.equal(m.id, ANTHROPIC_BEST);
  }
  assert.deepEqual(
    ALL.filter((c) => CAPABILITIES[c].loadBearing).sort(),
    ["classify", "direct", "judge"],
  );
});

test("without a key it falls to the best available, not to the cheap default", () => {
  /*
   * The point of a fallback is to stay as close to the intended quality as
   * the configuration allows. Dropping load-bearing work to the flash model
   * because a key is missing is the config silently becoming a different
   * product.
   */
  for (const cap of ALL.filter((c) => CAPABILITIES[c].loadBearing)) {
    const m = resolveFor(cap, NO_KEY);
    assert.equal(m.provider, "workers-ai");
    assert.equal(m.id, REASON_UPGRADE.id, `${cap} fell to the cheap default`);
    assert.notEqual(m.id, REASON.id);
  }
});

test("ACCEPTANCE: reading a whole transcript keeps the big window, key or no key", () => {
  /*
   * THE ONE PLACE THE BIGGEST MODEL IS NOT THE BEST CHOICE, and it is a
   * quality argument rather than a price one. A 1M-token window reads a
   * two-hour transcript in one piece; a 200k window reads it in chunks and
   * cannot see across the joins. For "which moments carry this subject", the
   * model that sees all of it at once does the better job.
   */
  for (const env of [WITH_KEY, NO_KEY]) {
    const m = resolveFor("read", env);
    assert.equal(m.provider, "workers-ai");
    assert.equal(m.context, 1_048_576);
    assert.ok(m.context > 200_000, "a transcript this long would have to be read in pieces");
  }
});

test("ACCEPTANCE: the window wins over the key, if a capability ever wants both", () => {
  /*
   * THE TEST ABOVE DOES NOT PIN THIS, which is why this exists.
   *
   * Deleting the longContext branch entirely failed nothing: `read` is not
   * load-bearing, so it falls through to the same 1M-window model by another
   * route. The branch is not redundant though — it encodes which of the two
   * wins — and the day somebody marks `read` load-bearing, the wrong order
   * silently hands a two-hour transcript to a 200k window and the product
   * gets quietly worse at the thing it is for.
   *
   * So this makes that capability exist for one assertion.
   */
  const spec = CAPABILITIES.read;
  const was = spec.loadBearing;
  spec.loadBearing = true;
  try {
    const m = resolveFor("read", WITH_KEY);
    assert.equal(m.context, 1_048_576, "the key won and the window was lost");
    assert.equal(m.provider, "workers-ai");
  } finally {
    spec.loadBearing = was;
  }
});

test("naming stays fast, because somebody is watching the box", () => {
  /* Latency is the quality that matters for a title. A better title two
     seconds later is a worse product. */
  const m = resolveFor("name", WITH_KEY);
  assert.equal(m.id, REASON.id);
  assert.equal(CAPABILITIES.name.loadBearing, false);
});

test("every capability resolves to something that can return a closed shape", () => {
  /*
   * "Closed schemas for anything a model returns; an output that doesn't fit
   * fails visibly." A capability resolved to a model that cannot do
   * structured output would fail visibly on every single call.
   */
  for (const cap of ALL) {
    for (const env of [WITH_KEY, NO_KEY]) {
      assert.equal(resolveFor(cap, env).jsonSchema, true, `${cap} cannot return a closed shape`);
    }
  }
});

test("every capability says why it gets what it gets", () => {
  /* The field is read by nothing and by everybody: the next person deciding
     whether to move one of these needs the argument, not the mapping. */
  for (const cap of ALL) {
    const spec = CAPABILITIES[cap];
    assert.ok(spec.why.length > 40, `${cap} has no reason written down`);
    assert.match(spec.why, /[.!]$/, `${cap}'s reason is not a sentence`);
  }
  /* And the two that name an invariant actually name it. */
  assert.match(CAPABILITIES.judge.why, /[Ii]nvariant 4/);
  assert.match(CAPABILITIES.classify.why, /[Ii]nvariant 8/);
});

test("the Anthropic model is the current family", () => {
  /*
   * It said claude-sonnet-5 and was a family behind. That mattered less when
   * nothing in the codebase could call Anthropic at all — src/llm.ts is the
   * first thing that can, which is what makes this worth pinning.
   */
  assert.match(ANTHROPIC_BEST, /^claude-opus-5-5$/);
});

test("nothing load-bearing is also long-context, because those pull apart", () => {
  /*
   * They want different models, so a capability claiming both would have to
   * pick one and the other flag would be a lie. If that combination is ever
   * needed it wants its own answer — windowed reads on the best model — and
   * somebody should have to write it.
   */
  for (const cap of ALL) {
    const s = CAPABILITIES[cap];
    assert.ok(!(s.loadBearing && s.longContext), `${cap} claims both and can only have one`);
  }
});
