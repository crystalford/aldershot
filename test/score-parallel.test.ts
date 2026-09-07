/**
 * Reading the transcript in windows, at the same time.
 *
 * "when i try to do the edit part (keep only the strongest points, or
 * whatever) i get no progress update, just reading it for meaning, 4 minutes
 * now." Two things were wrong and only one of them was the bar.
 *
 * The windows were read one after another, though they have nothing to say to
 * each other — so a long transcript took as long as the sum of its parts when
 * it could take as long as the slowest four. And nothing bounded a call, so a
 * model that never answered was indistinguishable from one still thinking,
 * until the thirty-minute reaper noticed.
 *
 * What must NOT change is the answer: parallel windows have to produce exactly
 * the clips the sequential ones did, in transcript order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePass, windowSegments } from "../src/score.ts";

const seg = (idx: number, text: string) => ({
  id: `s${idx}`,
  source_id: "S1",
  idx,
  start_ms: idx * 10_000,
  end_ms: idx * 10_000 + 9_000,
  speaker: null,
  text,
  words: null,
});

/* Long enough lines that windowSegments has to divide them. */
const transcript = (n: number) => Array.from({ length: n }, (_, i) => seg(i, "word ".repeat(300)));

/** An AI binding that answers with one clip per window, from its own lines. */
function fakeAI(opts: { delayFor?: (n: number) => number; hangFor?: number[] } = {}) {
  let call = 0;
  const inFlight = { now: 0, peak: 0 };
  return {
    inFlight,
    calls: () => call,
    AI: {
      run: async (_model: string, input: Record<string, unknown>) => {
        const n = call++;
        inFlight.now++;
        inFlight.peak = Math.max(inFlight.peak, inFlight.now);

        /* The prompt carries the window's real timecodes; answer from them, so
           grounding cannot silently drop the clip. */
        const prompt = String((input.messages as Array<{ content: string }>)[1].content);
        const first = /\[(\d+)-(\d+)\]/.exec(prompt)!;

        if (opts.hangFor?.includes(n)) {
          /* Never resolves — exactly the failure the deadline is for. */
          await new Promise(() => {});
        }
        if (opts.delayFor) await new Promise((r) => setTimeout(r, opts.delayFor!(n)));

        inFlight.now--;
        return {
          response: JSON.stringify({
            clips: [{ start_ms: Number(first[1]), end_ms: Number(first[2]), why: "a reason", score: 80 }],
            action: "keep",
          }),
        };
      },
    },
  };
}

const env = (ai: unknown) => ({ AI: ai, MODEL_REASON: undefined }) as never;

/** How many windows a transcript of n lines divides into. */
const windowsIn = (n: number) => windowSegments(transcript(n)).length;

test("windows are read at the same time, not one after another", async () => {
  const ai = fakeAI({ delayFor: () => 60 });
  const t0 = Date.now();
  const out = await scorePass(env(ai.AI), transcript(120), "find the strong bits");
  const ms = Date.now() - t0;

  assert.ok(ai.calls() >= 3, `expected several windows, got ${ai.calls()}`);
  assert.ok(ai.inFlight.peak > 1, "the windows were still read one at a time");
  assert.ok(
    ms < ai.calls() * 60 * 0.75,
    `${ai.calls()} windows of 60ms took ${ms}ms — that is still serial`,
  );
  assert.ok(out.clips.length > 0);
});

test("the answer is in transcript order however the windows land", async () => {
  /* Later windows answer FIRST here, which is the whole risk of doing this in
     parallel: a merge that trusted arrival order would scramble the cut. */
  const ai = fakeAI({ delayFor: (n) => (10 - n) * 8 });
  const out = await scorePass(env(ai.AI), transcript(40), "find the strong bits");

  const starts = out.clips.map((c) => c.start_ms);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), "the moments came back out of order");
});

test("a window that never answers is retried before it is given up on", async () => {
  /*
   * It used to be that both attempts hanging failed the whole pass. That is
   * now only true when EVERY window fails — see the two tests at the bottom of
   * this file. What still has to hold is that a stretch gets a SECOND chance
   * before it is written off, because these fail when something is momentarily
   * busy and the retry is the thing that rescues them.
   */
  const ai = fakeAI({ hangFor: [0] });
  await scorePass(env(ai.AI), transcript(40), "find the strong bits", { windowTimeoutMs: 50 });
  assert.ok(ai.calls() > windowsIn(40), "the stalled window was never tried again");
});

test("one window hanging is survived by the retry", async () => {
  /* Only the FIRST attempt hangs. The retry answers, and the pass completes —
     which is the point of retrying rather than failing at the first stall. */
  const ai = fakeAI({ hangFor: [0] });
  const out = await scorePass(env(ai.AI), transcript(40), "find the strong bits", { windowTimeoutMs: 50 });
  assert.ok(out.clips.length > 0, "a single stalled call took the whole pass down");
});

test("progress is reported once per window, counting up", async () => {
  const ai = fakeAI();
  const seen: Array<[number, number]> = [];
  const out = await scorePass(env(ai.AI), transcript(40), "find the strong bits", {
    onProgress: (_f, done, total) => void seen.push([done, total]),
  });
  assert.equal(seen.length, ai.calls(), "a window finished without saying so");
  assert.deepEqual(seen.map((s) => s[0]), seen.map((_, i) => i + 1), "the count did not go up by one");
  assert.ok(out.clips.length > 0);
});

/**
 * One slow window must not throw the whole pass away.
 *
 * "Couldn't work out what to keep: the model didn't answer in time" — on a
 * 13:56 video with 116 lines. A window that timed out threw, the throw came
 * out of Promise.all, and everything the model HAD read was discarded with it.
 *
 * A stretch nobody could read is a stretch with no moments in it, which is a
 * true answer and a useful one. Only a pass where nothing at all came back has
 * really failed.
 */
test("a pass survives a window that never answers", async () => {
  const ai = fakeAI({ hangFor: [0] });
  const out = await scorePass(env(ai.AI), transcript(120), "find the strong bits", {
    windowTimeoutMs: 40,
  });
  assert.ok(out.clips.length > 0, "one slow stretch threw away every other one");
});

test("but a pass where nothing answered still fails, with its reason", async () => {
  const ai = fakeAI({ hangFor: Array.from({ length: 40 }, (_, i) => i) });
  await assert.rejects(
    () => scorePass(env(ai.AI), transcript(120), "find the strong bits", { windowTimeoutMs: 40 }),
    (e: Error) => /didn't answer/.test(e.message),
  );
});

test("progress still counts a lost window as done, or the bar would stall", async () => {
  const ai = fakeAI({ hangFor: [1] });
  const seen: number[] = [];
  await scorePass(env(ai.AI), transcript(120), "find the strong bits", {
    windowTimeoutMs: 40,
    onProgress: (_f, done) => void seen.push(done),
  });
  assert.deepEqual(seen, seen.map((_, i) => i + 1), "the count skipped the window that failed");
});

test("the deadline grows with the window, because a bigger prompt takes longer", async () => {
  const { windowTimeout } = await import("../src/score.ts");
  const small = windowTimeout(2_000);
  const big = windowTimeout(24_000);
  assert.ok(big > small, "one flat number is either too tight or useless");
  assert.ok(small >= 150_000, "a short window still gets a generous floor");
  assert.ok(big <= 420_000, "and nothing waits for ever");
});
