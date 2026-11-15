/**
 * THE SCAN PHASE, which had never run.
 *
 * scout-job.ts carried this since Scout was built: "none is reachable until a
 * source arrives with words in it." One had — the podcast adapter marks an
 * episode with a published transcript `native` — but scout_sources recorded
 * THAT a transcript existed and never WHERE. The run knew an episode was
 * readable and had no address to reach it with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLS_PER_PHASE, scanSource } from "../src/scout-scan-run.ts";
import type { Scannable } from "../src/scout-store.ts";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
We moved the launch before the review came in.

00:00:04.000 --> 00:00:08.000
Nobody wanted to be the one to say it out loud.

00:00:08.000 --> 00:00:12.000
So the slide went up and everybody nodded along.
`;

const SOURCE: Scannable = {
  id: "src1",
  url: "https://example.org/ep1",
  title: "Episode one",
  transcriptUrl: "https://example.org/ep1.vtt",
  durationS: 1200,
};

const BEATS = [
  { id: "b1", role: "subject", behaviour: "Does anyone admit the launch moved early?" },
  /* TWO, on purpose. With one beat the inner budget check is masked by the
     outer one and deleting it fails nothing — measured. */
  { id: "b2", role: "counter", behaviour: "Does anyone deny the launch moved early?" },
] as never;

/** Records what was written and what was fetched. */
function harness(opts: { body?: string; status?: number; answer?: "QUOTE" | "NONE" } = {}) {
  const ledger: Array<{ sql: string; bound: unknown[] }> = [];
  const scanned: Array<{ id: string; n: number }> = [];
  const fetched: string[] = [];
  const asked: string[] = [];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => opts.body ?? VTT,
    };
  }) as never;

  const env = {
    AI: {
      run: async (_m: string, input: Record<string, unknown>) => {
        asked.push(String((input.messages as Array<{ content: string }>)[1].content));
        return {
          response: JSON.stringify({
            answer: opts.answer ?? "QUOTE",
            quote: "We moved the launch before the review came in.",
            /*
             * THE MODEL'S HINT, AND IT TOOK THREE GOES TO MAKE IT COUNT.
             *
             * It has to be the field parseScan reads (`first_word_id`, not
             * `startWord`), inside the window (99 is outside, and parseScan
             * correctly nulls a hint about a different window), and not the
             * window's own first word (0 is indistinguishable from it). Each
             * of those three fixtures let the break pass, which is the test
             * agreeing with a bug.
             */
            first_word_id: "w7",
          }),
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    },
    DB: {
      prepare: (sql: string) => ({
        bind: (...b: unknown[]) => ({
          run: async () => undefined,
          all: async () => ({ results: [] }),
          __row: { sql, bound: b },
        }),
      }),
      batch: async (stmts: Array<{ __row?: { sql: string; bound: unknown[] } }>) => {
        for (const st of stmts) if (st.__row) ledger.push(st.__row);
        return [];
      },
    },
  } as never;

  return { env, ledger, scanned, fetched, asked, restore: () => { globalThis.fetch = realFetch; } };
}

test("ACCEPTANCE: a source with a published transcript is read", async () => {
  const h = harness();
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS });
    assert.equal(out.skipped, undefined, `it refused to read it: ${out.skipped}`);
    assert.ok(out.scanned > 0, "no window was read");
    assert.ok(out.found > 0, "a quote was found and not written");
    assert.deepEqual(h.fetched, ["https://example.org/ep1.vtt"]);
  } finally {
    h.restore();
  }
});

test("ACCEPTANCE: it fetches the transcript and nothing else", () => {
  /*
   * Invariant 9: "nothing in this codebase downloads audiovisual content from
   * platforms that forbid it." A published transcript is TEXT a feed offers
   * for reading. The audio beside it is not fetched here and must not be.
   */
  const h = harness();
  return scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS })
    .then(() => {
      assert.equal(h.fetched.length, 1);
      for (const u of h.fetched) {
        assert.doesNotMatch(u, /\.(mp3|mp4|m4a|wav|webm|mkv)(\?|$)/i, `it fetched media: ${u}`);
      }
    })
    .finally(h.restore);
});

test("one narrow question per window per beat, and the words come with it", async () => {
  /* doc 18's shape. "Does this passage contain the admission" and "does it
     contain the denial" are different questions over the same words. */
  const h = harness();
  try {
    await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS });
    assert.ok(h.asked.length > 0);
    assert.match(h.asked[0], /Does anyone admit the launch moved early\?/);
    assert.match(h.asked[0], /We moved the launch/, "the window's words were not in the prompt");
  } finally {
    h.restore();
  }
});

test("NONE is the common answer and writes nothing", async () => {
  /* "Most windows do not contain the thing" — scout-scan.ts. A run that
     wrote a row per window would be a run that found everything. */
  const h = harness({ answer: "NONE" });
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS });
    assert.ok(out.scanned > 0);
    assert.equal(out.found, 0);
    assert.equal(h.ledger.length, 0);
  } finally {
    h.restore();
  }
});

test("a transcript that is not VTT is said, not retried for ever", async () => {
  /* A feed that says text/vtt and sends HTML will keep saying it. */
  const h = harness({ body: "<html>sorry</html>" });
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS });
    assert.match(out.skipped ?? "", /not VTT/);
    assert.equal(out.scanned, 0);
  } finally {
    h.restore();
  }
});

test("a fetch that fails is a skipped source, not a dead run", async () => {
  /* One bad feed must not stop a run that has twenty other sources. */
  const h = harness({ status: 404 });
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS });
    assert.match(out.skipped ?? "", /404/);
    assert.equal(out.found, 0);
  } finally {
    h.restore();
  }
});

test("the call budget is a real ceiling, inside a window as well as between them", async () => {
  /*
   * Two beats and a budget of one: the ceiling has to stop the SECOND beat
   * of the FIRST window. With a single beat the outer check alone passes
   * this, which is why BEATS has two.
   */
  const h = harness();
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS, budget: 1 });
    assert.equal(out.scanned, 1, "it read past its budget");
    assert.equal(h.asked.length, 1, "it asked a second question it had no budget for");
    assert.ok(CALLS_PER_PHASE > 1, "the default budget would read exactly one window");
  } finally {
    h.restore();
  }
});

test("ACCEPTANCE: a found quote goes in unverified, with the window's span", async () => {
  /*
   * NOTHING HERE WAS CHECKED. Verification is the next phase and it is
   * deterministic — the quote is matched against the transcript word for
   * word — so writing anything but "rejected" would be the model's claim
   * recorded as a finding.
   *
   * And the span is the WINDOW's, not the model's hint. Invariant 2: the
   * model never outputs a timestamp. Its startWord is a hint for the
   * verifier to narrow a search; what is recorded is what was read.
   */
  const h = harness();
  try {
    await scanSource(h.env, { runId: "r1", source: SOURCE, beats: BEATS, budget: 2 });
    assert.ok(h.ledger.length > 0, "nothing reached the ledger");
    const row = h.ledger[0];
    assert.match(row.sql, /INSERT INTO scout_ledger/i);
    assert.ok(row.bound.includes("rejected"), `the row was written as ${JSON.stringify(row.bound)}`);
    assert.ok(!row.bound.includes("verified"), "a quote nobody checked was recorded as verified");

    /*
     * The span is the WINDOW's. The model was made to say 99 — which the
     * first window cannot contain — so 99 appearing anywhere in this row
     * means the hint became a fact.
     */
    const span = row.bound.find((v) => typeof v === "string" && v.includes("startWord"));
    assert.ok(span, "no word span was written");
    assert.equal((JSON.parse(String(span)) as { startWord: number }).startWord, 0, "the window's own span was not recorded");
  } finally {
    h.restore();
  }
});

test("a run with nothing to look for asks nothing", async () => {
  const h = harness();
  try {
    const out = await scanSource(h.env, { runId: "r1", source: SOURCE, beats: [] as never });
    assert.match(out.skipped ?? "", /no beats/);
    assert.equal(h.fetched.length, 0, "it fetched a transcript it had no question for");
  } finally {
    h.restore();
  }
});
