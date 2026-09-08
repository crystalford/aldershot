/**
 * What "strong" means, and why it is spelled out.
 *
 * "Find the strong bits" sent the model the word "strongest" and asked it to
 * score 0-100 "how strongly it matches what they asked for" — a word matched
 * against itself, with nothing anywhere saying what makes a moment good. The
 * owner's verdict was that the feature "could be improved", and the reason it
 * was weak was that we never explained the job.
 *
 * The fix is not a better model. Spotify replaced a multi-expert pipeline
 * (topic analysis, sentiment intensity, sound-event detection) with an LLM
 * given STRUCTURAL criteria and it won 81% of head-to-heads and +4.6%
 * engagement online — "starts and concludes with complete thoughts",
 * "self-contained", "excludes ad content". Audio energy and sentiment lost.
 * arXiv 2505.23908.
 *
 * So the prompt states the rules and orders them, and these hold it there.
 * They read the source rather than call the model: what is being protected is
 * that the instruction still SAYS this, which is the whole intervention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prompt = () => readFileSync(join(import.meta.dirname, "..", "src", "score.ts"), "utf8");

test("a moment has to be a complete thought", () => {
  /* The single most common reason people throw an auto-made clip away is that
     it starts or ends mid-sentence. It is also the cheapest thing to ask for. */
  const src = prompt();
  assert.match(src, /COMPLETE THOUGHT/);
  assert.match(src, /Never begin or end mid-sentence/);
});

test("and has to stand on its own", () => {
  /* Self-containment is the other criterion Spotify's raters responded to:
     a moment that opens on "that" or "like I said" points at something the
     viewer was never shown. */
  const src = prompt();
  assert.match(src, /SELF-CONTAINED/);
  assert.match(src, /like I said/, "the prompt should name the actual words that give it away");
});

test("housekeeping is never the moment", () => {
  /* Named explicitly in the study's criteria — excluding ads mattered enough
     to be one of the five things it asked for. */
  const src = prompt();
  assert.match(src, /NOT HOUSEKEEPING/);
  assert.match(src, /[Ss]ponsor/);
});

test("and it is not judged on how excited the speaker sounds", () => {
  /*
   * THE FINDING, STATED AS A RULE.
   *
   * Audio energy and sentiment intensity were the legacy pipeline's primary
   * signals and they were beaten by structural criteria. Products still sell
   * "speech energy" as the thing behind a virality score. The prompt says not
   * to, so that a loud sentence does not outrank a good one.
   */
  const src = prompt();
  assert.match(src, /Do not judge it on how loud, fast or\s*",\s*"excited/);
});

test("the rules are ordered, not a list of nice-to-haves", () => {
  /* Order is the point: a moment that breaks the first three is not a good
     moment however interesting it is. Without that, a model hands back the
     funniest half-sentence in the video. */
  const src = prompt();
  assert.match(src, /in order/);
  assert.match(src, /THEN interesting/, "interest is fourth, and only fourth");
});

test("the score is not asked to match a word against itself", () => {
  /* What it used to say: "score: 0-100, how strongly it matches what they
     asked for" — with "strong" undefined anywhere. */
  const src = prompt();
  assert.ok(
    !/how strongly it matches what they asked for/.test(src),
    "scoring 'strength' against the word 'strong' is what made this weak",
  );
});
