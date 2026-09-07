/**
 * Talking to the encoder.
 *
 * This exists because of one sentence from the owner: "that one is still stuck
 * at 30%… you never really solved this for me you just said it was probably
 * because the deploy." It was not the deploy. The render held ONE fetch open
 * for the whole encode, so the job advanced to 30, called the container, and
 * had nothing further to say for as long as the container took — which, with
 * the source being re-downloaded once per cut on a sixteenth of a vCPU, was
 * hours.
 *
 * So the conversation is a poll now, and these are the properties that make it
 * worth having: it reports what the encoder actually measured, it gives up
 * with a sentence rather than hanging, and it survives the container being
 * recycled underneath it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, EncodeError, encoderFor } from "../src/encode.ts";

/** A container that answers a scripted sequence of statuses. */
function fakeEncoder(statuses: Array<Record<string, unknown>>, opts: { body?: string } = {}) {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      if (url.endsWith("/render")) {
        return new Response(JSON.stringify({ id: "r1" }), { status: 202 });
      }
      if (url.includes("/render/status")) {
        const s = statuses[Math.min(i++, statuses.length - 1)];
        if (s.__status) return new Response("", { status: s.__status as number });
        return new Response(JSON.stringify(s), { status: 200 });
      }
      return new Response(opts.body ?? "mp4-bytes", { status: 200 });
    },
  };
}

const now = () => Promise.resolve();

test("the percentage that reaches the job is the encoder's own count", async () => {
  const seen: Array<{ pct: number; done: number }> = [];
  const enc = fakeEncoder([
    { stage: "cutting", pct: 20, done: 1, total: 5, error: null, ready: false },
    { stage: "cutting", pct: 60, done: 3, total: 5, error: null, ready: false },
    { stage: "ready", pct: 100, done: 5, total: 5, error: null, ready: true },
  ]);
  const res = await encode(enc, { cuts: [] }, {
    deadlineMs: 60_000,
    sleep: now,
    onProgress: (s) => void seen.push({ pct: s.pct, done: s.done }),
  });

  assert.deepEqual(seen, [
    { pct: 20, done: 1 },
    { pct: 60, done: 3 },
    { pct: 100, done: 5 },
  ]);
  assert.equal(await res.text(), "mp4-bytes");
});

test("the same percentage twice is written down once", async () => {
  /* This runs against D1 on every poll, and a long export polls a lot. */
  let writes = 0;
  const enc = fakeEncoder([
    { stage: "cutting", pct: 40, done: 2, total: 5, error: null, ready: false },
    { stage: "cutting", pct: 40, done: 2, total: 5, error: null, ready: false },
    { stage: "cutting", pct: 40, done: 2, total: 5, error: null, ready: false },
    { stage: "ready", pct: 100, done: 5, total: 5, error: null, ready: true },
  ]);
  await encode(enc, {}, { deadlineMs: 60_000, sleep: now, onProgress: () => void writes++ });
  assert.equal(writes, 2, "an unchanged percentage was rewritten");
});

test("an encoder that fails says why, in a sentence", async () => {
  const enc = fakeEncoder([
    { stage: "failed", pct: 30, done: 1, total: 5, error: "no such file or directory", ready: false },
  ]);
  await assert.rejects(
    () => encode(enc, {}, { deadlineMs: 60_000, sleep: now }),
    (e: Error) => e instanceof EncodeError && /no such file/.test(e.message),
  );
});

test("a container recycled mid-render is a failure you can retry, not a hang", async () => {
  /* Without this the poll would 404 in a loop until the deadline, which is
     twenty-five minutes of the user watching a bar that will never move. */
  const enc = fakeEncoder([{ __status: 404 }]);
  await assert.rejects(
    () => encode(enc, {}, { deadlineMs: 60_000, sleep: now }),
    (e: Error) => e instanceof EncodeError && /restarted/.test(e.message),
  );
});

test("the deadline is on the whole conversation, not on one call", async () => {
  /*
   * The old code put an AbortSignal on a single long fetch, which could only
   * fire if the container never answered AT ALL. A container that answers and
   * then wedges mid-encode was invisible to it — and that is the failure that
   * actually happened.
   */
  let clock = 0;
  const enc = fakeEncoder([{ stage: "cutting", pct: 30, done: 1, total: 9, error: null, ready: false }]);
  await assert.rejects(
    () =>
      encode(enc, {}, {
        deadlineMs: 10_000,
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
      }),
    (e: Error) => e instanceof EncodeError && /didn't finish in time/.test(e.message),
  );
});

test("two exports of one project get two containers", async () => {
  /*
   * "one at 30% the others just i guess queued". The name was keyed by
   * project, so a second export of the same edit landed on the instance the
   * first was already using.
   */
  const names: string[] = [];
  const env = {
    RENDER: {
      idFromName: (n: string) => { names.push(n); return n as never; },
      get: () => ({ fetch: async () => new Response("") }),
    },
  };
  encoderFor(env, "render-A");
  encoderFor(env, "render-B");
  assert.deepEqual(names, ["render-A", "render-B"]);
});

test("RENDER_URL wins, because a declared binding can still not work", async () => {
  /* wrangler dev declares RENDER whether or not containers are enabled. */
  const env = {
    RENDER_URL: "http://127.0.0.1:9",
    RENDER: { idFromName: () => { throw new Error("the binding was used"); }, get: () => ({}) },
  };
  const enc = encoderFor(env, "render-A");
  assert.ok(enc, "no encoder was built");
});

test("no encoder at all is null, not a crash", () => {
  assert.equal(encoderFor({}, "render-A"), null);
});
