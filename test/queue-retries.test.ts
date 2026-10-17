/**
 * The retry count exists in two places and has to agree.
 *
 * src/queue.ts closes a job out honestly on its last allowed delivery;
 * wrangler.jsonc tells the platform how many deliveries that is. There is no
 * dead-letter queue, so if the platform's number is the SMALLER one it deletes
 * the message before this code ever reaches its last attempt: nothing marks
 * the job failed, and the row claims "running" until reapStaleJobs notices
 * twenty minutes to three hours later. A user watching a progress bar sees it
 * stop and is told nothing.
 *
 * That is a one-character edit away at all times, in a file nobody thinks of
 * as code, and no test anywhere would have caught it. Hence this one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_DELIVERIES, isLastDelivery, backoffSeconds } from "../src/queue.ts";

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
  /* Anchored on "consumers", because the PRODUCER block names the same queue
     and matching on the name alone found that one — which has no max_retries,
     so the first version of this test asserted against undefined. */
  const consumer = raw.match(/"consumers"\s*:\s*\[\s*\{[^}]*}/)?.[0];
  assert.ok(consumer, "the jobs consumer must be declared, or no job runs on the queue at all");
  assert.match(consumer, /"queue"\s*:\s*"aldershot-jobs"/, "the consumer must be the jobs queue");

  const retries = consumer.match(/"max_retries"\s*:\s*(\d+)/)?.[1];
  assert.equal(
    Number(retries),
    MAX_DELIVERIES,
    "wrangler.jsonc and src/queue.ts disagree about how many deliveries a message gets",
  );

  /*
   * And if a dead-letter queue is ever added, this test must be re-read rather
   * than quietly updated: with a DLQ the platform's exhaustion stops being
   * destructive, so the two numbers no longer have to be equal and the
   * reasoning above stops applying.
   */
  assert.ok(
    !/"dead_letter_queue"/.test(consumer),
    "a DLQ now exists — re-read this test's reasoning before changing it to match",
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
