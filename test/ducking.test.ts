/**
 * DUCK BY WORD TIMINGS, which is Phase 5's sound rule and not a compressor.
 *
 * The container ducks a clip under a voice-over with `sidechaincompress`,
 * which is how it is done when you do not know where the words are. A take
 * is force-aligned, so we do — and a computed envelope fixes three things a
 * sidechain cannot: it ducks for a cough, it does not duck for a quiet word,
 * and it pumps between sentences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUCK_DB,
  GAP_S,
  LEAD_S,
  MAX_RUNS,
  SHOULDERS_FIT,
  TAIL_S,
  envelope,
  gainOf,
  plan,
  speechRuns,
  volumeExpr,
} from "../src/ducking.ts";

const w = (s: number, e: number) => ({ w: "x", s, e });

test("ACCEPTANCE: a gap shorter than the rule does not bring the bed back", () => {
  /*
   * THE PUMPING FIX. Two sentences 0.3s apart are one run, so the bed stays
   * down across the pause instead of rising for 300ms and dropping again —
   * which is the artefact a listener hears as "edited" and the reason this
   * is computed rather than reacted to.
   */
  const runs = speechRuns([w(1.0, 2.0), w(2.3, 3.0)]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], { startS: 1.0, endS: 3.0 });
});

test("ACCEPTANCE: a real pause does bring it back", () => {
  /* Or the rule would be "duck for the whole take", which is a fader. */
  const runs = speechRuns([w(1.0, 2.0), w(4.0, 5.0)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((r) => r.startS), [1.0, 4.0]);
});

test("ACCEPTANCE: the bed is down before the first syllable", () => {
  /*
   * A duck that begins ON the word clips its attack, and the attack is
   * where the consonant is — so the word arrives soft and the listener
   * hears the edit instead of the sentence.
   */
  const pts = envelope(speechRuns([w(2.0, 3.0)]), { durationS: 6 });
  const atWordStart = pts.find((p) => Math.abs(p.tS - 2.0) < 1e-9);
  assert.ok(atWordStart, "no point at the word's start");
  assert.ok(atWordStart.gain < 1, "the bed was still at full level when the word began");

  /* And the ramp starts a lead-time earlier, at full level. */
  const rampStart = pts.find((p) => Math.abs(p.tS - (2.0 - LEAD_S)) < 1e-9);
  assert.ok(rampStart, `no ramp start at ${2 - LEAD_S}`);
  assert.equal(rampStart.gain, 1);
});

test("ACCEPTANCE: the anti-pump gap must exceed the shoulders it closes", () => {
  /*
   * THE CONSTRAINT THE EXPRESSION RESTS ON. `volumeExpr` sums one trapezoid
   * per run, which is only safe while no two are non-zero at once. Two runs
   * closer than lead + tail would overlap, the sum would pass 1, and the bed
   * would duck further than asked for no reason anybody could point at.
   *
   * Asserted rather than left as an arithmetic coincidence a later tweak
   * could break — which is exactly what a change to LEAD_S or TAIL_S is.
   */
  assert.ok(SHOULDERS_FIT, `GAP_S ${GAP_S} must exceed LEAD_S ${LEAD_S} + TAIL_S ${TAIL_S}`);
  assert.ok(GAP_S > LEAD_S + TAIL_S);
});

test("the trapezoids never overlap, so the sum never passes 1", () => {
  /* The consequence, measured over the actual expression's geometry rather
     than argued from the constants. */
  const runs = speechRuns([w(1, 1.4), w(1.9, 2.3), w(2.8, 3.2)]);
  const f = (t: number, r: { startS: number; endS: number }) => {
    const a = Math.max(0, r.startS - LEAD_S);
    const b = r.endS + TAIL_S;
    return Math.min(Math.max(Math.min((t - a) / LEAD_S, (b - t) / TAIL_S), 0), 1);
  };
  for (let t = 0; t <= 5; t += 0.01) {
    const sum = runs.reduce((n, r) => n + f(t, r), 0);
    assert.ok(sum <= 1 + 1e-9, `at t=${t.toFixed(2)} the trapezoids summed to ${sum}`);
  }
});

test("a word at the very start still gets a duck, not a ramp from before zero", () => {
  const pts = envelope(speechRuns([w(0, 1)]), { durationS: 4 });
  assert.ok(pts.every((p) => p.tS >= 0), "a point before time zero");
  const first = pts[0];
  assert.equal(first.tS, 0);
  assert.ok(first.gain < 1, "the bed was at full level over a word at 0:00");
});

test("the envelope is monotonic in time and ends at full level", () => {
  const pts = envelope(speechRuns([w(1, 2), w(5, 6)]), { durationS: 8 });
  for (let i = 1; i < pts.length; i += 1) {
    assert.ok(pts[i].tS >= pts[i - 1].tS, `point ${i} goes backwards in time`);
  }
  assert.equal(pts[pts.length - 1].gain, 1, "the bed never came back up");
  assert.equal(pts[pts.length - 1].tS, 8);
});

test("words out of order, reversed or zero-length do not move the bed", () => {
  /*
   * A word the aligner could not place is not a reason to touch the mix, and
   * an unsorted list would otherwise produce overlapping runs and an
   * expression that over-ducks.
   */
  const runs = speechRuns([w(4, 5), w(1, 2), { s: 3, e: 3 }, { s: 9, e: 8 }, { s: NaN, e: 1 }]);
  assert.deepEqual(runs, [
    { startS: 1, endS: 2 },
    { startS: 4, endS: 5 },
  ]);
});

test("the expression is one volume term, with the duck as a declared multiplier", () => {
  const expr = volumeExpr(speechRuns([w(1, 2)]));
  assert.match(expr, /^1-/);
  /*
   * −12 dB IS PINNED HERE AS A LITERAL, on purpose.
   *
   * scripts/check-duck.cjs measures the attenuation against `DUCK_DB`, so
   * it proves the expression computes what the constant declares and cannot
   * notice the constant changing — broken to −3 dB, every measurement still
   * passed. This is the other half: −12 dB is 0.2512 as a multiplier, so
   * the term subtracts 0.749, and a casual change to the depth fails here.
   */
  assert.match(expr, /^1-0\.749\*/);
  assert.equal(DUCK_DB, -12);
  assert.ok(Math.abs(gainOf(DUCK_DB) - 0.2512) < 0.001);

  /*
   * The commas are escaped, and that is DEFENSIVE rather than required —
   * measured, both ways, through real ffmpeg: quoted and passed as one argv
   * element, `\,` and `,` duck the bed to the same level at the same
   * instant. The escape is free and is correct if the quoting is ever lost,
   * so it stays; what is not asserted is that ffmpeg needs it.
   */
  assert.ok(expr.includes("\\,"), "the defensive escape went missing");
});

test("no words is not no ducking — it is the sidechain's job", () => {
  /*
   * "We do not know where the speech is" and "there is no speech" are
   * different, and the sidechain is the honest answer to the first: worse
   * than an envelope, better than a bed at full level under somebody
   * talking. A take whose alignment failed is exactly this case.
   */
  const p = plan([], 10);
  assert.equal(p.expr, null);
  assert.match(p.why, /sidechain/);
});

test("too many runs falls back rather than building an expression nobody can parse", () => {
  const many = Array.from({ length: MAX_RUNS + 1 }, (_, i) => w(i * 2, i * 2 + 0.5));
  const p = plan(many, 400);
  assert.equal(p.expr, null);
  assert.match(p.why, new RegExp(String(MAX_RUNS)));
  /* The runs are still reported, so the log can say how far past it was. */
  assert.ok(p.runs.length > MAX_RUNS);
});

test("a normal take gets an expression and says what it did", () => {
  const p = plan([w(1, 2), w(2.2, 3), w(6, 7)], 9);
  assert.ok(p.expr);
  assert.equal(p.runs.length, 2, "the 0.2s gap closed, the 3s one did not");
  assert.match(p.why, /-12 dB/);
});
