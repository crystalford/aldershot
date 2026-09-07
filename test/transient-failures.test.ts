/**
 * A busy machine is not a broken video.
 *
 * Twenty videos uploaded at once failed six of them:
 *
 *   "Couldn't read that video: Failed to start container: Maximum number of
 *    running container instances exceeded. Try again later."
 *
 * Cloudflare asked us to try again later. readSource caught it, called
 * failJob, and returned normally — so nothing reached the queue consumer, the
 * message was acked, and the three retries the queue was configured with
 * never happened. The video sat permanently failed behind a Retry button for
 * a human to press.
 *
 * The risk in the other direction is real too: a wrong guess retries a job
 * that can never succeed, three times, and reports the same error later and
 * more confusingly. So the list is short and everything unrecognised still
 * fails at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransient } from "../src/jobs.ts";

test("the error that actually happened is retried", () => {
  assert.equal(
    isTransient(new Error("Failed to start container: Maximum number of running container instances exceeded. Try again later.")),
    true,
  );
});

test("busy, rate-limited and timed out are all worth another go", () => {
  for (const m of [
    "Too Many Requests",
    "rate limit exceeded",
    "upstream temporarily unavailable",
    "the request timed out",
    "network connection lost",
    "container instances exceeded",
    "returned 503",
    "429 from the model",
  ]) {
    assert.equal(isTransient(new Error(m)), true, m);
  }
});

test("a broken video is not retried three times to say the same thing", () => {
  for (const m of [
    "The upload didn't finish. Try adding the video again.",
    "that video hasn't been read yet",
    "the extractor produced no audio",
    "Unsupported file type",
    "no such source",
    "That video is 2674 minutes, and you have 1187 minutes left this month",
  ]) {
    assert.equal(isTransient(new Error(m)), false, m);
  }
});

test("it reads a plain string as well as an Error", () => {
  assert.equal(isTransient("Try again later"), true);
  assert.equal(isTransient("nope"), false);
});

test("case does not decide whether a video is recoverable", () => {
  assert.equal(isTransient(new Error("MAXIMUM NUMBER OF RUNNING CONTAINER INSTANCES EXCEEDED")), true);
});

test("a status code inside a longer sentence is not mistaken for a year", () => {
  /* Word-bounded, so a duration or an id containing 429 is not a retry. */
  assert.equal(isTransient(new Error("clip at 1429ms could not be found")), false);
  assert.equal(isTransient(new Error("source 5031 is missing")), false);
});
