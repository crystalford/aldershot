/**
 * The tags a rule can match, derived from the moment rather than typed on it.
 *
 * The seed rules name `core`, `housekeeping`, `hedge` and `strong`. On the
 * reference's fourteen sample clips those are hand-written; on a real library
 * they have to be derived, and these are the derivations.
 *
 * The failure that matters is NOT a missed tag. It is `core` — the tag the
 * keep rule asks for. Get that wrong and moments silently vanish from every
 * cut with no rule to blame, which is the one outcome a product built on
 * visible rules cannot survive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { momentTags, HEDGE_PER_100 } from "../src/moment-tags.ts";

const tags = (quote: string, heat: number | null = 1) => momentTags({ quote, heat }).sort();

test("core is the complement, so the keep rule fails open", () => {
  /*
   * THE ONE THAT MATTERS.
   *
   * If `core` were its own positive test — a list of phrases that sound like
   * someone working something out — every moment the list failed to recognise
   * would drop out of every cut, with no rule to point at and nothing on
   * screen to explain it. So it is defined as "not housekeeping and not
   * hedging", and anything unrecognised is kept.
   */
  assert.ok(tags("something nobody wrote a pattern for").includes("core"));
  assert.ok(tags("").includes("core"), "even an empty quote is not silently dropped");
  assert.ok(tags("¿qué pasa con las ruedas?").includes("core"), "and neither is another language");
});

test("housekeeping is the scoring prompt's own rule 3, made checkable", () => {
  /* "Sponsor and ad reads, 'like and subscribe', mic checks, 'can you hear
     me', agenda recaps and sign-offs are never the moment." That was written
     for a model to follow; this is the same rule written to be verified. */
  for (const q of [
    "Okay is this— yeah it's recording. Hi. Give me a second, where was I.",
    "Can you hear me okay at the back?",
    "Don't forget to like and subscribe before we get into it.",
    "This episode is sponsored by a company that makes socks.",
    "Thanks for watching, see you next time.",
    "Hey everyone, welcome back to the channel.",
  ]) {
    assert.ok(tags(q).includes("housekeeping"), `missed: ${q}`);
    assert.ok(!tags(q).includes("core"), "and housekeeping is never also core");
  }
});

test("a moment that merely mentions recording is not housekeeping", () => {
  /*
   * The half of this worth testing. A pattern list that fires on the word
   * "sponsor" anywhere would take out the best moment in a video about
   * sponsorship, and the rule would be blamed for it.
   */
  for (const q of [
    "The sponsor read is the only honest part of most of these videos.",
    "I think the honest version is I don't like who I am here.",
    "You can't keep a version of yourself alive by visiting it twice a year.",
    "We started recording everything after that, which changed how people talked.",
  ]) {
    assert.ok(!tags(q).includes("housekeeping"), `false positive: ${q}`);
    assert.ok(tags(q).includes("core") || tags(q).includes("hedge"));
  }
});

test("hedging is counted, not spotted — everybody says 'I think' once", () => {
  /*
   * Presence would tag almost every honest sentence in a personal video.
   * The sample's tag means the moment IS the hedging, so it is a rate.
   */
  const hedging = "I don't know. I don't know. This is probably a bad idea to think about on camera.";
  assert.ok(tags(hedging).includes("hedge"));
  assert.ok(!tags(hedging).includes("core"));

  /*
   * ONE hedge in forty words. The first version of this fixture opened "I
   * think…" and contained no hedge from the list at all, so it passed whether
   * hedging was counted or merely spotted — it was pinning nothing.
   *
   * "I think" is deliberately NOT a hedge, and the reference proves the point:
   * its clip 2 is tagged `core` and `strong` and opens "I think the honest
   * version is I don't like who I am here." A list that treats that as
   * hedging throws away the best line in the sample.
   */
  const once =
    "The first four weeks are not about strength at all, they are about turning " +
    "up on the days you do not want to, and maybe that is the whole of it really";
  assert.equal((once.match(/\bmaybe\b/gi) ?? []).length, 1, "exactly one, or this tests nothing");
  assert.ok(!tags(once).includes("hedge"), "one hedge in twenty-eight words is just speech");
  assert.ok(tags(once).includes("core"));
  assert.equal(HEDGE_PER_100, 6, "the rate is the whole rule; changing it re-tags the library");
});

test("strong comes from heat, and a missing heat is not evidence of dullness", () => {
  /*
   * `strong` is the tag with teeth: the cap rule may never drop one. So the
   * absent case decides whether an old library is safe. Treating a null heat
   * as 0 would make every clip written before the column was populated the
   * first thing any cap throws away.
   */
  assert.ok(tags("So I'm going. Because staying is the only decision I never made.", 2).includes("strong"));
  assert.ok(!tags("a perfectly fine line", 1).includes("strong"));
  assert.ok(!tags("a perfectly fine line", 0).includes("strong"));
  assert.ok(!tags("a perfectly fine line", null).includes("strong"), "absent reads as ordinary, not as weak");
  assert.ok(momentTags({ quote: "a line" }).includes("core"), "and heat is optional at the type level too");
});
