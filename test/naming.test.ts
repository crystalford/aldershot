/**
 * Naming a cut.
 *
 * The model half cannot run here, which is the point of the split: the
 * deterministic title and the cleaner are pure, so the behaviour the user
 * actually sees when the model is slow, unavailable, or chatty is testable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { titleFromTranscript, cleanModelTitle, MAX_TITLE } from "../src/naming.ts";

test("strips the throat-clearing people open with", () => {
  assert.equal(
    titleFromTranscript("So, um, okay — today we're quartering the north field before the rain"),
    "We're quartering the north field before the rain",
  );
  assert.equal(titleFromTranscript("Hey guys, welcome back. Let's talk about lens choice"), "Let's talk about lens choice");
});

test("takes one clause, not the whole paragraph", () => {
  const t = titleFromTranscript("The drone handles wind badly, which is why we fly at dawn, and that means an early start.");
  assert.equal(t, "The drone handles wind badly");
});

test("never ends a title on a dangling word", () => {
  assert.ok(!/\b(the|of|and|to|a)$/i.test(titleFromTranscript("Looking at the shape of the")));
});

test("gives nothing back for nothing", () => {
  assert.equal(titleFromTranscript(""), "");
  assert.equal(titleFromTranscript("   "), "");
  // A transcript that is ONLY filler has no subject to name.
  assert.equal(titleFromTranscript("um, uh, so, okay"), "");
});

test("keeps a title short enough to be a title", () => {
  const long = titleFromTranscript(
    "Reconstructing the irrigation channels along the eastern boundary, which took all week.",
  );
  assert.ok(long.length > 0 && long.length <= MAX_TITLE, `${long.length} chars: ${long}`);
});

/*
 * The one that matters. Spoken transcripts often arrive with no punctuation at
 * all, and the first eight words of running speech is not a title — the local
 * pass named a real video "It confirmed so went to gym finally i'm". Refusing
 * leaves the filename, which is worse than a good name and much better than a
 * bad one.
 */
test("refuses to name running speech that has no clause in it", () => {
  assert.equal(
    titleFromTranscript("it confirmed so went to gym finally i'm about a week let's say two weeks in to the job"),
    "",
  );
});

test("still names a short complete thought", () => {
  assert.equal(titleFromTranscript("We rebuilt the fence line. Took two days."), "We rebuilt the fence line");
});

test("leaves proper nouns and acronyms alone", () => {
  assert.equal(titleFromTranscript("so the DJI Mavic beat the GoPro here"), "The DJI Mavic beat the GoPro here");
});

test("unwraps what small models put around a title", () => {
  assert.equal(cleanModelTitle('"Quartering the north field"'), "Quartering the north field");
  assert.equal(cleanModelTitle("Title: Quartering the north field."), "Quartering the north field");
  assert.equal(cleanModelTitle("  \n Quartering  the north   field \n "), "Quartering the north field");
});

test("refuses a paragraph, so the caller can fall back", () => {
  assert.equal(
    cleanModelTitle("I'm sorry, but I can't determine a title from this transcript because it is too short."),
    "",
  );
  assert.equal(cleanModelTitle("ok"), "");
  assert.equal(cleanModelTitle(""), "");
});
