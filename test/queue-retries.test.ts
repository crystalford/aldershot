/**
 * The retry count exists in two places and has to agree.
 *
 * src/queue.ts closes a job out honestly on its last allowed delivery;
 * wrangler.jsonc tells the platform how many deliveries that is. If the
 * platform's number is the SMALLER one, the message leaves the queue before
 * this code ever reaches its last attempt — and before the dead-letter queue
 * existed, that meant nothing marked the job failed and the row claimed
 * "running" until reapStaleJobs noticed twenty minutes to three hours later.
 * A user watching a progress bar saw it stop and was told nothing.
 *
 * That is a one-character edit away at all times, in a file nobody thinks of
 * as code, and no test anywhere would have caught it. Hence this one.
 *
 * The dead-letter queue now catches it, and the numbers still have to agree:
 * the DLQ reports that a job failed, and agreeing numbers are what let the
 * normal path report it with a REASON. The tests below cover both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEAD_LETTER_QUEUE, MAX_DELIVERIES, isLastDelivery, backoffSeconds } from "../src/queue.ts";

test("the consumer's last attempt is the platform's last delivery", () => {
  const raw = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");

  /*
   * READ BY REGEX, NOT BY STRIPPING COMMENTS AND PARSING.
   *
   * The obvious approach is to remove the comments and JSON.parse what is
   * left. It does not work on this file: `"globs": ["**\/*.woff2"]` contains a
   * comment opener INSIDE a string, so a comment stripper swallows everything
   * from there to the next close and the parse fails on the wreckage. A parser
   * that handles it correctly is a parser with its own bugs, in a test. This
   * asks the narrow question instead, and its failure mode is "did not find
   * it", which the assertions below catch.
   */
  /*
   * Anchored on "consumers", because the PRODUCER block names the same queue
   * and matching on the name alone found that one — which has no max_retries,
   * so the first version of this test asserted against undefined.
   *
   * AND IT PICKS THE ENTRY BY NAME RATHER THAN BY POSITION. An earlier version
   * took the first `{…}` after "consumers", which broke the day a comment was
   * written above that entry and again the day a second consumer was added.
   * Position in a hand-edited config file is not an identity.
   */
  const consumersBlock = raw.match(/"consumers"\s*:\s*\[([\s\S]*?)\n\s*\]/)?.[1];
  assert.ok(consumersBlock, "the consumers block must be declarable");
  const consumer = [...consumersBlock.matchAll(/\{[^{}]*\}/g)]
    .map((m) => m[0])
    .find((e) => /"queue"\s*:\s*"aldershot-jobs"/.test(e));
  assert.ok(consumer, "the jobs consumer must be declared, or no job runs on the queue at all");
  assert.match(consumer, /"queue"\s*:\s*"aldershot-jobs"/, "the consumer must be the jobs queue");

  const retries = consumer.match(/"max_retries"\s*:\s*(\d+)/)?.[1];
  assert.equal(
    Number(retries),
    MAX_DELIVERIES,
    "wrangler.jsonc and src/queue.ts disagree about how many deliveries a message gets",
  );

  /*
   * A DEAD-LETTER QUEUE NOW EXISTS, and the tripwire that used to stand here
   * asked for this reasoning to be re-read rather than quietly updated. It was
   * right to, because the claim has genuinely weakened.
   *
   * WHAT CHANGED. With a DLQ, the platform exhausting its retries before this
   * code reaches its last attempt is no longer destructive: the message lands
   * on the dead-letter queue and the job is closed out there. So equality is
   * no longer what stands between a job and a row claiming "running" forever.
   *
   * WHAT DID NOT. The dead-letter consumer can only say "That didn't finish,
   * and the retries ran out", because by the time a message reaches it the
   * error that caused the failure is three deliveries ago and was never
   * written down. The normal path says "That didn't finish: <what actually
   * went wrong>". So the numbers still have to agree — not to prevent silence
   * any more, but so the sentence the user reads is the true one rather than
   * the generic one.
   *
   * That is a smaller claim than this test used to make, and it is the claim
   * it now makes. The assertion is inverted: the DLQ must be THERE, and if it
   * is ever removed, equality goes back to being the only thing preventing a
   * silent partial failure — so read this again before deleting it.
   */
  assert.match(
    consumer,
    /"dead_letter_queue"\s*:\s*"[^"]+"/,
    "the jobs consumer must dead-letter, or whatever it cannot process is deleted",
  );
});

test("the last delivery closes the job out; the ones before it retry", () => {
  /* Off by one in either direction is silent. One too eager and jobs fail
     with retries unspent; one too patient and the platform deletes the message
     first, which marks nothing and leaves the row claiming "running". */
  assert.equal(isLastDelivery(1), false);
  assert.equal(isLastDelivery(MAX_DELIVERIES - 1), false);
  assert.equal(isLastDelivery(MAX_DELIVERIES), true);
  assert.equal(isLastDelivery(MAX_DELIVERIES + 1), true, "a redelivery past the limit still closes out");
});

test("the backoff grows and never collapses to zero", () => {
  /*
   * A backoff that silently becomes zero looks exactly like one that works,
   * until twenty videos uploaded together all retry in the same millisecond
   * into the same busy container pool.
   */
  assert.equal(backoffSeconds(1, () => 0), 20);
  assert.equal(backoffSeconds(2, () => 0), 60);
  assert.equal(backoffSeconds(3, () => 0), 180);
  assert.equal(backoffSeconds(9, () => 0), 180, "it plateaus rather than running off the end of the table");

  /* Jitter is up to 40% on top, never a reduction — the floor is the point. */
  for (const attempt of [1, 2, 3]) {
    const low = backoffSeconds(attempt, () => 0);
    const high = backoffSeconds(attempt, () => 0.999);
    assert.ok(high > low, "jitter must actually vary the delay");
    assert.ok(high <= low * 1.4, `attempt ${attempt} jittered past 40%`);
  }
});

/* ── The dead-letter queue ──────────────────────────────────────────────── */

test("ACCEPTANCE: a message the platform gave up on closes its job out", async () => {
  /*
   * labs/OPERATIONS.md: "Queues delete on retry exhaustion unless a
   * dead-letter queue exists — that is exactly how '300 processed, 200
   * didn't' happens."
   *
   * consume() already handles its OWN last delivery, and while the two retry
   * counts agree that covers the ordinary case. This covers the rest: a worker
   * evicted mid-message, a failJob that itself throws so the ack is never
   * reached, or the platform's number edited in a config file.
   */
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { fakeD1 } = await import("./helpers/fake-d1.ts");
  const { consumeDeadLetter, DEAD_LETTER_QUEUE } = await import("../src/queue.ts");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, "../migrations/schema.sql"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const ddl = sql.split(";").find((s) => /create table if not exists jobs/i.test(s));
  assert.ok(ddl, "migrations/schema.sql has no jobs table — run `npm run schema`");

  const db = new DatabaseSync(":memory:");
  db.exec(ddl + ";");
  const now = Date.now();
  /* The real columns, from the real DDL. A hand-written INSERT against a
     remembered schema is how this test first failed. */
  const insert = (id: string, state: string) =>
    db
      .prepare("INSERT INTO jobs (id, user_id, type, state, pct, created_at) VALUES (?, 'u1', 'render', ?, 10, ?)")
      .run(id, state, now);

  insert("running-job", "running");
  insert("already-ready", "ready");
  insert("already-failed", "failed");

  const acked: string[] = [];
  const retried: string[] = [];
  const msg = (id: string, jobId: unknown) => ({
    id,
    attempts: 1,
    body: jobId === undefined ? ({} as never) : ({ type: "render", jobId, userId: "u1" } as never),
    ack: () => acked.push(id),
    retry: () => retried.push(id),
  });

  const batch = {
    queue: DEAD_LETTER_QUEUE,
    messages: [
      msg("m1", "running-job"),
      msg("m2", "already-ready"),
      msg("m3", "already-failed"),
      msg("m4", undefined),
      msg("m5", "a-job-that-never-existed"),
    ],
  };

  await consumeDeadLetter(batch as never, { DB: fakeD1(db) } as never);

  const state = (id: string) =>
    (db.prepare("SELECT state, error FROM jobs WHERE id = ?").get(id) ?? {}) as { state?: string; error?: string };

  /* The running job is closed out, with a sentence a person reads. */
  assert.equal(state("running-job").state, "failed");
  assert.match(String(state("running-job").error), /retries ran out/);

  /*
   * A JOB THAT FINISHED IS NOT OVERWRITTEN. An earlier delivery can still be
   * in flight when a later one succeeds, so arriving here is not proof the
   * work failed — and turning a working job into a broken one on the strength
   * of an undeliverable message is worse than the problem.
   */
  assert.equal(state("already-ready").state, "ready");
  assert.equal(state("already-failed").state, "failed");

  /* Every message is acked. A dead-letter message left to retry forever is a
     queue that never drains. */
  assert.deepEqual(acked, ["m1", "m2", "m3", "m4", "m5"]);
  assert.deepEqual(retried, []);
});

test("ACCEPTANCE: the dead-letter queue does not re-run the work", async () => {
  /*
   * A message arrives there because the work failed three times. A fourth
   * attempt would spend money to reach the same place and delay the honest
   * answer by another four minutes — and the whole default export is one
   * handler, so without the queue-name check the DLQ would be consumed by
   * runJob and a message the platform gave up on would become attempt four.
   */
  const { DEAD_LETTER_QUEUE, consume } = await import("../src/queue.ts");
  const raw = readFileSync(join(import.meta.dirname, "..", "src", "queue.ts"), "utf8");
  assert.match(raw, /if \(batch\.queue === DEAD_LETTER_QUEUE\) return consumeDeadLetter\(batch, env\)/);

  /* And driven, with nothing else wired: a DLQ batch must not reach runJob,
     which would throw on the absent bindings rather than ack. */
  const acked: string[] = [];
  const batch = {
    queue: DEAD_LETTER_QUEUE,
    messages: [
      {
        id: "m1",
        attempts: 1,
        body: { type: "render", jobId: "nope", userId: "u1" } as never,
        ack: () => acked.push("m1"),
        retry: () => {
          throw new Error("the dead-letter queue must not retry the work");
        },
      },
    ],
  };
  await consume(batch as never, {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) },
  } as never);
  assert.deepEqual(acked, ["m1"]);
});

test("the dead-letter queue is named the same in the config and the code", () => {
  /*
   * Two places again, and a mismatch is silent in the worst way: messages pile
   * up on a queue nothing consumes, and the jobs they belong to say "running"
   * forever — exactly the failure the DLQ was added to prevent, wearing its
   * own coat.
   */
  const raw = readFileSync(join(import.meta.dirname, "..", "wrangler.jsonc"), "utf8");
  const consumers = raw.match(/"consumers"\s*:\s*\[([\s\S]*?)\n\s*\]/)?.[1];
  assert.ok(consumers, "the consumers block must be declarable");

  assert.ok(
    consumers.includes(`"dead_letter_queue": "${DEAD_LETTER_QUEUE}"`),
    `the jobs consumer must dead-letter to ${DEAD_LETTER_QUEUE}`,
  );
  assert.ok(
    new RegExp(`"queue"\\s*:\\s*"${DEAD_LETTER_QUEUE}"`).test(consumers),
    `${DEAD_LETTER_QUEUE} must itself have a consumer, or nothing reads it`,
  );
  /* And the DLQ has no DLQ of its own, because that is turtles. */
  const dlqEntry = [...consumers.matchAll(/\{[^{}]*\}/g)]
    .map((m) => m[0])
    .find((e) => new RegExp(`"queue"\\s*:\\s*"${DEAD_LETTER_QUEUE}"`).test(e));
  assert.ok(dlqEntry);
  assert.ok(!/"dead_letter_queue"/.test(dlqEntry), "a dead-letter queue with a dead-letter queue is turtles");
});

test("ACCEPTANCE: the normal consumer's last delivery closes the job out, with the real reason", async () => {
  /*
   * THE PATH THAT MATTERS MORE, and nothing pinned it. The dead-letter queue
   * is the backstop; this is the one that gets used, and it is the only one
   * that can say what actually went wrong.
   *
   * Two guards in here are written identically to the dead-letter consumer's,
   * which is how a break aimed at that one landed here instead and went
   * uncaught: a job that finished must not be overwritten, and a failure must
   * carry its reason rather than a generic sentence.
   */
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync: read } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { fakeD1 } = await import("./helpers/fake-d1.ts");
  const { consume, MAX_DELIVERIES: max } = await import("../src/queue.ts");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = read(path.join(here, "../migrations/schema.sql"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const ddl = sql.split(";").find((s) => /create table if not exists jobs/i.test(s))!;
  const db = new DatabaseSync(":memory:");
  db.exec(ddl + ";");
  const now = Date.now();
  for (const [id, state] of [["running-job", "running"], ["done-job", "ready"]]) {
    db.prepare("INSERT INTO jobs (id, user_id, type, state, pct, created_at) VALUES (?, 'u1', 'proxy', ?, 10, ?)")
      .run(id, state, now);
  }

  /*
   * A `proxy` job, and the type matters. Most handlers catch their own errors
   * and write their own failure, so they never reach the guards in `consume`
   * at all — `render`, `score`, `outline` and `reactions` all do. `proxy`,
   * `transcribe` and `short-render` throw straight out, which is the only
   * shape of failure these guards exist for: a job left saying "running" with
   * nobody having written anything.
   *
   * An env with a DB and nothing else makes it throw on the binding it needs.
   */
  const env = { DB: fakeD1(db) } as never;
  const acked: string[] = [];
  const retried: number[] = [];
  const msg = (id: string, jobId: string, attempts: number) => ({
    id,
    attempts,
    body: { type: "proxy", jobId, userId: "u1", sourceId: "s1" } as never,
    ack: () => acked.push(id),
    retry: (o: { delaySeconds: number }) => retried.push(o.delaySeconds),
  });

  /* Not the last delivery: retried with a backoff, and the job is untouched. */
  await consume({ queue: "aldershot-jobs", messages: [msg("m1", "running-job", 1)] } as never, env);
  assert.deepEqual(acked, []);
  assert.equal(retried.length, 1);
  assert.ok(retried[0] > 0, "a retry with no delay is a retry against something still busy");
  assert.equal(
    (db.prepare("SELECT state FROM jobs WHERE id = 'running-job'").get() as { state: string }).state,
    "running",
  );

  /* The last delivery: closed out, acked, and the error says what happened
     rather than "the retries ran out". */
  await consume({ queue: "aldershot-jobs", messages: [msg("m2", "running-job", max)] } as never, env);
  assert.deepEqual(acked, ["m2"]);
  assert.equal(retried.length, 1, "nothing is retried past the last delivery");
  const failed = db.prepare("SELECT state, error FROM jobs WHERE id = 'running-job'").get() as {
    state: string;
    error: string;
  };
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /That didn't finish: /);
  assert.ok(!/retries ran out/.test(failed.error), "this path knows the real reason and must give it");

  /* A job that finished is not overwritten, even on a last delivery. */
  await consume({ queue: "aldershot-jobs", messages: [msg("m3", "done-job", max)] } as never, env);
  assert.equal((db.prepare("SELECT state FROM jobs WHERE id = 'done-job'").get() as { state: string }).state, "ready");
  assert.deepEqual(acked, ["m2", "m3"]);
});

test("every dead-letter message is reported to the operator", async () => {
  /*
   * 10-OPERATIONS-AND-PRICING.md: "Page only on budget burn, ANY DLQ message,
   * or per-job cost > 2× estimate." The log line IS the alert, so a
   * dead-letter consumer that closes the row quietly satisfies the user and
   * leaves nobody knowing the queue is shedding work.
   */
  const { consumeDeadLetter, DEAD_LETTER_QUEUE: dlq } = await import("../src/queue.ts");

  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    await consumeDeadLetter(
      {
        queue: dlq,
        messages: [
          { id: "m1", attempts: 1, body: { type: "render", jobId: "j1", userId: "u1" } as never, ack: () => {}, retry: () => {} },
          { id: "m2", attempts: 1, body: {} as never, ack: () => {}, retry: () => {} },
        ],
      } as never,
      {
        DB: {
          prepare: () => ({
            bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 0 } }) }),
          }),
        },
      } as never,
    );
  } finally {
    console.error = realError;
  }

  /* The job id, so the alert points at something. */
  assert.ok(logged.some((l) => /dead-letter/.test(l) && /j1/.test(l)), JSON.stringify(logged));
  /* And a message too broken to identify is still reported — it is the only
     trace such a message can leave. */
  assert.ok(logged.some((l) => /no job id/.test(l)), JSON.stringify(logged));
});
