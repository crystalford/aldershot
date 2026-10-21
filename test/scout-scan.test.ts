/**
 * SCAN: read a transcript in windows, one narrow question at a time.
 *
 * This is where a source stops being a title and starts being evidence, and
 * it is the step that costs real money — a small model over twelve hours of
 * transcript is most of a run's bill.
 *
 * Two of its rules come straight out of measurements and are the kind that
 * get optimised away by somebody who does not know why they are there. A
 * whole VOD in one long context stops finding things and starts agreeing that
 * things are probably in there. A combined question for six beats costs a
 * sixth as much and answers about whichever beat the model found most
 * interesting, leaving five paid-for beats empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IndexedWord } from "../src/align.ts";
import {
  OVERLAP,
  SCAN_PROMPT_VERSION,
  STRIDE,
  TOKENS_PER_WORD,
  WINDOW_TOKENS,
  WORDS_PER_WINDOW,
  parseScan,
  planWindows,
  questionFor,
  renderWindow,
  scanWindow,
  wordAtSecond,
  type Window,
} from "../src/scout-scan.ts";
import { CHAT_LAG_S, WINDOW_LEAD_S, type CrowdTimestamp } from "../src/scout-triage.ts";

/** A transcript of `n` words, 400ms each, so every time is arithmetic. */
function transcript(n: number, stepMs = 400): IndexedWord[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    text: "w" + i,
    startMs: i * stepMs,
    endMs: i * stepMs + stepMs - 1,
  }));
}

const ts = (tS: number, weight = 1): CrowdTimestamp => ({
  tS,
  lagCorrectedTS: Math.max(0, tS - CHAT_LAG_S),
  weight,
  text: `${tS} here`,
});

/* ── The window size ────────────────────────────────────────────────────── */

test("the window is well under where long-context matching collapses", () => {
  /*
   * Non-literal matching goes somewhere past 8K tokens. Two thousand leaves
   * room for the prompt around it and is nowhere near the cliff — this is the
   * number the whole design rests on, so it is pinned rather than derived.
   */
  assert.equal(WINDOW_TOKENS, 2000);
  assert.equal(OVERLAP, 0.15);
  assert.ok(WINDOW_TOKENS < 8000);
});

test("the token estimate errs high, because erring low overflows the context", () => {
  /*
   * There is no tokeniser in this runtime. Guessing high costs slightly
   * smaller windows; guessing low costs a window that overflows and takes the
   * collapse with it. Transcripts tokenise worse than prose — disfluencies
   * and proper names both do.
   */
  assert.ok(TOKENS_PER_WORD >= 1.3, `${TOKENS_PER_WORD} is not above ordinary prose`);
  assert.equal(WORDS_PER_WINDOW, Math.floor(WINDOW_TOKENS / TOKENS_PER_WORD));
  /* And the stride leaves the overlap. */
  assert.equal(STRIDE, Math.round(WORDS_PER_WINDOW * 0.85));
  assert.ok(STRIDE < WORDS_PER_WINDOW);
});

/* ── Tiling ─────────────────────────────────────────────────────────────── */

test("a transcript shorter than one window is one window", () => {
  const w = planWindows(transcript(100));
  assert.equal(w.length, 1);
  assert.equal(w[0].startWord, 0);
  assert.equal(w[0].endWord, 99);
  assert.equal(w[0].anchor, "tile");
});

test("an empty transcript is no windows, not one empty one", () => {
  /*
   * A source whose transcript row exists and holds nothing. A window with no
   * words in it would be a paid-for model call about nothing.
   *
   * THE SECOND LINE IS THE ONE THAT MATTERS. Three guards against this used
   * to stand in the way, and two of them could never run — the tiling and the
   * coverage pass both iterate over the words, so no words means no calls.
   * The crowd loop iterates over crowd SIGNALS, which is exactly the case of
   * a source nobody could read and four fans pointing into it, and it reached
   * the window builder with nothing to slice. One guard is left, and it is
   * this line that proves it is load-bearing.
   */
  assert.deepEqual(planWindows([]), []);
  assert.deepEqual(planWindows([], [ts(600, 4)]), []);
});

test("ACCEPTANCE: every word of an unindexed transcript is covered", () => {
  /*
   * The expensive case and the honest one: nobody has timestamped this, so
   * there is nowhere to start but the beginning. A tiling with a hole in it
   * would report a beat as a gap having never read the part it was in.
   */
  const words = transcript(9000);
  const windows = planWindows(words);
  const seen = new Set<number>();
  for (const w of windows) for (let i = w.startWord; i <= w.endWord; i++) seen.add(i);
  assert.equal(seen.size, 9000, `${9000 - seen.size} words were never read`);
  /* And the last word is in the last window, rather than falling off the end. */
  assert.equal(windows[windows.length - 1].endWord, 8999);
});

test("ACCEPTANCE: coverage survives the crowd windows and the slide-back", () => {
  /*
   * NEITHER THE DROP NOR THE SLIDE PRESERVES COVERAGE ON ITS OWN. A window is
   * 1428 words and a stride is 1214, so two windows reach 2642 while three
   * strides reach 3642 — dropping a near-duplicate leaves a hole the
   * remaining windows do not bridge. And the last window slides back off the
   * end, so the tile it replaced started later than it does.
   *
   * Both were real. A 9,000-word transcript lost its last 288 words, and a
   * beat in them would have come back a gap with those words never read.
   */
  for (const crowd of [
    [] as CrowdTimestamp[],
    [ts(600, 3)],
    [ts(600, 3), ts(1800, 5), ts(3600, 2)],
    [ts(0, 9), ts(3599, 1)],
  ]) {
    for (const n of [1, 1427, 1428, 1429, 2642, 2643, 9000]) {
      const words = transcript(n);
      const seen = new Set<number>();
      for (const w of planWindows(words, crowd)) {
        for (let i = w.startWord; i <= w.endWord; i++) seen.add(i);
      }
      assert.equal(seen.size, n, `${n} words, ${crowd.length} crowd signals: ${n - seen.size} never read`);
    }
  }
});

test("windows overlap, so a moment on a boundary is in both halves", () => {
  /*
   * A quote straddling a boundary is in neither window without the overlap,
   * and the verifier then rejects a quote that is really there — which is
   * counted as this model's hallucination rate.
   */
  const windows = planWindows(transcript(5000));
  for (let i = 1; i < windows.length; i++) {
    assert.ok(
      windows[i].startWord <= windows[i - 1].endWord,
      `a gap between window ${i - 1} and ${i}`,
    );
  }
  const gap = windows[1].startWord - windows[0].startWord;
  assert.equal(gap, STRIDE);
});

test("a window carries its word ids and its times, read off the words", () => {
  /* Invariant 2 and the timing contract: nothing here types a timestamp. */
  const words = transcript(3000);
  const [w] = planWindows(words);
  assert.equal(w.words.length, WORDS_PER_WINDOW);
  assert.equal(w.words[0].index, w.startWord);
  assert.equal(w.tStartS, words[w.startWord].startMs / 1000);
  assert.equal(w.tEndS, words[w.endWord].endMs / 1000);
});

/* ── Crowd anchoring ────────────────────────────────────────────────────── */

test("ACCEPTANCE: the places somebody already pointed at are read first", () => {
  /*
   * A run that tiles a three-hour VOD from the beginning spends forty windows
   * to reach a moment four people had already timestamped. A budget that runs
   * out should run out having read where it was told to look.
   */
  const words = transcript(30_000);
  /* 400ms a word, so 30,000 words is 200 minutes. Two hours in is word
     18,000. */
  const windows = planWindows(words, [ts(7200, 4)]);

  assert.equal(windows[0].anchor, "crowd");
  assert.equal(windows[0].weight, 4);
  /* The window opens before the corrected time, because the provocation is
     what makes the moment legible. */
  const expected = wordAtSecond(words, 7200 - CHAT_LAG_S - WINDOW_LEAD_S);
  assert.equal(windows[0].startWord, expected);
  /* And a tile would have been the fortieth-odd window. */
  assert.ok(windows.slice(1).every((w) => w.anchor === "tile"));
});

test("the heaviest crowd goes first", () => {
  /* The moment forty people timestamped before the one two people did. */
  const words = transcript(30_000);
  const windows = planWindows(words, [ts(600, 2), ts(7200, 40), ts(3600, 9)]);
  assert.deepEqual(
    windows.filter((w) => w.anchor === "crowd").map((w) => w.weight),
    [40, 9, 2],
  );
});

test("two clusters in the same window are one window", () => {
  /*
   * Clustering already merged timestamps twenty seconds apart, but two
   * clusters a minute apart still land inside the same two-thousand-token
   * window, and reading it twice is paying twice.
   */
  const words = transcript(30_000);
  const windows = planWindows(words, [ts(3600, 5), ts(3660, 3)]);
  assert.equal(windows.filter((w) => w.anchor === "crowd").length, 1);
  assert.equal(windows[0].weight, 5, "and the heavier one is the one kept");
});

test("a tile already inside a crowd window is dropped, not paid for twice", () => {
  const words = transcript(30_000);
  const withCrowd = planWindows(words, [ts(600, 3), ts(1800, 3), ts(3600, 3)]);
  const without = planWindows(words);
  assert.ok(withCrowd.length < without.length + 3, "the crowd windows replaced tiles rather than adding to them");
  /* No two windows in the plan start at the same word. */
  const starts = withCrowd.map((w) => w.startWord);
  assert.equal(new Set(starts).size, starts.length);
});

test("a crowd timestamp near the end still gets a whole window", () => {
  /* A window hanging off the end of the transcript would be shorter than the
     rest for no reason — it slides back instead. */
  const words = transcript(3000);
  const [w] = planWindows(words, [ts(1190, 7)]);
  assert.equal(w.anchor, "crowd");
  assert.equal(w.endWord, 2999);
  assert.equal(w.words.length, WORDS_PER_WINDOW);
});

test("a crowd timestamp in the first seconds starts at word zero", () => {
  const words = transcript(3000);
  const [w] = planWindows(words, [ts(2, 3)]);
  assert.equal(w.startWord, 0);
});

test("wordAtSecond finds the word a second lands in, and clamps", () => {
  const words = transcript(100);
  assert.equal(wordAtSecond(words, 0), 0);
  assert.equal(wordAtSecond(words, 4), 10);
  assert.equal(wordAtSecond(words, 9999), 99);
});

/* ── One question per window ────────────────────────────────────────────── */

test("ACCEPTANCE: the question is about one beat, and cannot be about two", () => {
  /*
   * Spec 3.5: "Several beats means several passes, never one combined
   * question." A combined question costs a sixth as much and answers about
   * whichever beat the model found most interesting; the other five come back
   * empty having been paid for. The signature is the enforcement — there is
   * no shape of call that takes a list of beats.
   */
  const q = questionFor({ behaviour: "Berates live chat during streams." });
  assert.equal(q, "Does this transcript show: Berates live chat during streams?");
  assert.ok(!/ and |;|\?.*\?/.test(q), q);

  /* Two beats is two questions, which is two calls. */
  const two = [{ behaviour: "Bans a viewer mid-sentence" }, { behaviour: "Reads out his chat rules" }].map(
    questionFor,
  );
  assert.equal(two.length, 2);
  assert.notEqual(two[0], two[1]);
  for (const one of two) assert.equal((one.match(/\?/g) ?? []).length, 1);
});

/* ── What the model sees ────────────────────────────────────────────────── */

test("every line carries a word id, because a model cannot count words", () => {
  /*
   * The model has to be able to say WHERE it found something. Marking the
   * lines gives it something to copy rather than something to calculate — the
   * same reason essay.ts used short clip ids: asked to reproduce a long
   * identifier, a model describes the right thing and mistypes the reference.
   */
  const words = transcript(40);
  const [w] = planWindows(words);
  const rendered = renderWindow(w, 10);
  const lines = rendered.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\[w0\] w0 w1 /);
  assert.match(lines[1], /^\[w10\] w10 /);
  assert.match(lines[3], /^\[w30\] w30 /);
  /* And every word is in there. */
  for (const word of words) assert.ok(rendered.includes(word.text), word.text);
});

/* ── Reading the answer ─────────────────────────────────────────────────── */

const win = (over: Partial<Window> = {}): Window => {
  const words = transcript(200);
  return {
    startWord: 0,
    endWord: 199,
    tStartS: 0,
    tEndS: 79.999,
    anchor: "tile",
    weight: 0,
    words,
    ...over,
  };
};

test("ACCEPTANCE: NONE is the expected answer, not a failure", () => {
  /*
   * Most windows do not contain the thing. A scan that treated NONE as a
   * failure would retry, log an error, or nudge the prompt until something
   * came back — which is how a fabricated quote is born.
   */
  const r = parseScan(JSON.stringify({ answer: "NONE", quote: "", first_word_id: "" }), win());
  assert.equal(r.answer, "NONE");
  assert.equal(r.quote, "");
  assert.equal(r.hintWordIndex, null);
});

test("NONE with a quote attached is still NONE", () => {
  /*
   * A model that answers NONE and fills the quote field in anyway — which
   * they do, because the field is required and an empty string looks like an
   * omission. Believed, it is a fabricated row with a real-looking quote in
   * it: the ANSWER is the claim, and the quote is only evidence for a claim
   * that was made.
   */
  const r = parseScan(
    JSON.stringify({ answer: "NONE", quote: "I hate my viewers", first_word_id: "w12" }),
    win(),
  );
  assert.equal(r.answer, "NONE");
  assert.equal(r.quote, "");
  assert.equal(r.hintWordIndex, null);

  /* And anything that is not the word QUOTE is NONE, rather than being read
     as a near-miss for it. */
  for (const answer of ["MAYBE", "PARTIAL", "yes", ""]) {
    assert.equal(
      parseScan(JSON.stringify({ answer, quote: "something", first_word_id: "w1" }), win()).answer,
      "NONE",
      answer,
    );
  }
  /* Case alone is not a difference — "quote" is the word. */
  assert.equal(
    parseScan(JSON.stringify({ answer: "quote", quote: "the words", first_word_id: "w1" }), win()).answer,
    "QUOTE",
  );
});

test("QUOTE with no quote in it is NONE", () => {
  /*
   * A row that claims evidence and carries none. The verifier would reject it
   * anyway — at the cost of a verification, and a hallucination counted
   * against this model's rejection rate, for something that was never a
   * claim.
   */
  for (const body of [
    { answer: "QUOTE", quote: "", first_word_id: "w12" },
    { answer: "QUOTE", quote: "   ", first_word_id: "w12" },
  ]) {
    assert.equal(parseScan(JSON.stringify(body), win()).answer, "NONE");
  }
});

test("the word id is read out of whatever shape it arrives in", () => {
  /* The prompt asks for "w1240" and models return "w1240", "1240", "[w1240]"
     and "word 1240" depending on mood. */
  for (const id of ["w120", "120", "[w120]", "word id 120"]) {
    const r = parseScan(JSON.stringify({ answer: "QUOTE", quote: "a quote", first_word_id: id }), win());
    assert.equal(r.hintWordIndex, 120, id);
  }
});

test("ACCEPTANCE: a hint outside the window is dropped, not clamped", () => {
  /*
   * A hint about a different window is not information about this one.
   * Dropped, the verifier searches the whole window; clamped, it searches
   * sixty seconds around a wrong answer and rejects a quote that is there.
   */
  const w = win({ startWord: 100, endWord: 299, words: transcript(400).slice(100, 300) });
  for (const id of ["w5", "w9999", "w99"]) {
    const r = parseScan(JSON.stringify({ answer: "QUOTE", quote: "a quote", first_word_id: id }), w);
    assert.equal(r.answer, "QUOTE", "the quote survives — only the hint is dropped");
    assert.equal(r.hintWordIndex, null, id);
  }
  /* Inside, it is kept. */
  assert.equal(
    parseScan(JSON.stringify({ answer: "QUOTE", quote: "a quote", first_word_id: "w150" }), w).hintWordIndex,
    150,
  );
});

test("a missing id is null, and changes nothing about the verdict", () => {
  const r = parseScan(JSON.stringify({ answer: "QUOTE", quote: "a real quote" }), win());
  assert.equal(r.answer, "QUOTE");
  assert.equal(r.quote, "a real quote");
  assert.equal(r.hintWordIndex, null);
});

test("prose instead of JSON is NONE, not a thrown workflow item", () => {
  /*
   * A scan that threw here would fail a workflow item over a window that
   * probably had nothing in it anyway, and invariant 7 makes a half-finished
   * job a P1.
   */
  assert.equal(parseScan("I could not find anything relevant.", win()).answer, "NONE");
  assert.equal(parseScan("", win()).answer, "NONE");
});

test("an answer in a code fence is still an answer", () => {
  const r = parseScan(
    '```json\n{"answer":"QUOTE","quote":"the words","first_word_id":"w7"}\n```',
    win(),
  );
  assert.equal(r.answer, "QUOTE");
  assert.equal(r.hintWordIndex, 7);
});

/* ── The call ───────────────────────────────────────────────────────────── */

function fakeAI(answer: unknown) {
  const asked: Array<{
    messages: Array<{ role: string; content: string }>;
    max_tokens: number;
    /* Kept because the closed schema, not the budget, is what bounds the
       answer — see the budget test below. */
    response_format?: { json_schema?: { properties?: Record<string, unknown> } };
  }> = [];
  const env = {
    AI: {
      run: async (
        _m: string,
        i: {
          messages: Array<{ role: string; content: string }>;
          max_tokens: number;
          response_format?: { json_schema?: { properties?: Record<string, unknown> } };
        },
      ) => {
        asked.push({
          messages: i.messages.map((m) => ({ ...m })),
          max_tokens: i.max_tokens,
          response_format: i.response_format,
        });
        return { response: JSON.stringify(answer), usage: { prompt_tokens: 1800, completion_tokens: 30 } };
      },
    },
  } as unknown as Parameters<typeof scanWindow>[0];
  return { env, asked };
}

test("the window, the question and the ids all reach the model", async () => {
  const { env, asked } = fakeAI({ answer: "NONE", quote: "", first_word_id: "" });
  const w = win();
  const r = await scanWindow(env, w, questionFor({ behaviour: "Bans a viewer mid-sentence" }));

  const user = asked[0].messages[1].content;
  assert.match(user, /Does this transcript show: Bans a viewer mid-sentence\?/);
  assert.match(user, /\[w0\] w0 /);
  assert.equal(r.answer, "NONE");
  assert.equal(r.promptVersion, SCAN_PROMPT_VERSION);
  assert.equal(r.tokensIn, 1800);
});

test("the prompt says NONE is expected and forbids reasoning from reputation", async () => {
  /*
   * Both halves are load-bearing and both look like padding. Without the
   * first, a model that has answered NONE forty times starts finding things.
   * Without the second, it answers from what it knows about a public figure,
   * which is not in the transcript and is not evidence.
   */
  const { env, asked } = fakeAI({ answer: "NONE", quote: "", first_word_id: "" });
  await scanWindow(env, win(), "Does this transcript show: anything?");

  const system = asked[0].messages[0].content;
  assert.match(system, /MOST\s*\n?WINDOWS DO NOT CONTAIN THE THING AND NONE IS THE EXPECTED ANSWER/);
  assert.match(system, /do not answer QUOTE because the/);
  assert.match(system, /nothing else you know about them is evidence/);
  /* And the quote has to be copied, not tidied — the verifier compares words. */
  assert.match(system, /AS THEY APPEAR, copied exactly/);
  assert.match(system, /not with the numbers turned into digits/);
});

test("the budget covers the thinking, and the SCHEMA is what keeps the answer short", async () => {
  /*
   * THIS TEST USED TO ASSERT THE OPPOSITE, at `max_tokens <= 600`, with the
   * reasoning "the answer is a quote and an id; a budget that allows an
   * essay gets one". The concern is real and the mechanism was wrong: the
   * cap does not bound the ANSWER, it bounds the answer plus everything the
   * model thinks first, and `assistantText` discards the thinking. What
   * actually stops an essay is the closed schema — three string fields and
   * nowhere for prose to go — and the parse that rejects anything else.
   *
   * At 400 a reading-comprehension question over two thousand tokens was
   * being cut off before the quote arrived, on every window, and arriving
   * as a window with nothing in it. src/naming.ts was found at 32 for this
   * reason and src/judge.ts at 2000 and again at 5300.
   */
  const { env, asked } = fakeAI({ answer: "NONE", quote: "", first_word_id: "" });
  await scanWindow(env, win(), "Does this transcript show: anything?");

  assert.ok(
    asked[0].max_tokens >= 2000,
    `max_tokens was ${asked[0].max_tokens} — a reasoning tier spends more than that before it answers`,
  );

  /* And the thing that does bound the answer. */
  const props = asked[0].response_format?.json_schema?.properties ?? {};
  assert.deepEqual(Object.keys(props).sort(), ["answer", "first_word_id", "quote"]);
});

test("a small model does the reading, not the frontier tier", async () => {
  /*
   * Spec 1: the frontier tier is for the two calls that DIRECT the run —
   * decompose and expand, once each per round. This is a reading-
   * comprehension question over two thousand tokens run thousands of times,
   * and putting it on the upgrade tier would be most of a run's bill for a
   * question a small model answers as well.
   */
  const { resolveModel } = await import("../src/models.ts");
  const { env } = fakeAI({ answer: "NONE", quote: "", first_word_id: "" });
  const r = await scanWindow(env, win(), "Does this transcript show: anything?");

  assert.equal(r.model, resolveModel("reason", env as never, "default").id);
  assert.notEqual(r.model, resolveModel("reason", env as never, "upgrade").id);
});

test("the result carries the model and the prompt version, for the rejection rate", async () => {
  /*
   * Spec 3.6: "log the rejection rate per model and prompt version from day
   * one. That rate is Scout's measured hallucination rate, and it gates model
   * swaps." It can only be grouped by things the scan recorded at the time.
   */
  const { env } = fakeAI({ answer: "QUOTE", quote: "the words", first_word_id: "w3" });
  const r = await scanWindow(env, win(), "Does this transcript show: anything?");
  assert.ok(r.model.length > 0);
  assert.equal(r.promptVersion, "scan-v1");
});
