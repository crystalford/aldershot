/**
 * AN IMPORTED VIDEO NOBODY HAS READ.
 *
 * `unread` is the state an import lands in, and it is the right state:
 * connecting a bucket puts two hundred videos in the library and reading is
 * metered, so "pending" would be a lie that bills you (src/sources.ts).
 *
 * What was missing was any branch for it on the source page. An imported
 * video fell through to the editor's empty state and read "Nothing kept yet
 * — add a clip back", which says it was read and nothing was worth keeping
 * — the opposite of the truth. And nothing on any surface offered to read
 * it, although /api/sources/:id/retry has always been able to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSource } from "../src/ui/pages/source.ts";
import { ACCENT } from "../src/ui/tokens.ts";

const base = {
  id: "src1",
  title: "An archive video",
  filename: "archive.mp4",
  duration_s: 600,
  transcript_state: "unread",
} as never;

const page = (state: string, segments: unknown[] = []) =>
  renderSource({
    source: { ...(base as object), transcript_state: state } as never,
    segments: segments as never,
    cuts: [] as never,
    edits: [] as never,
    job: null as never,
  } as never);

test("ACCEPTANCE: an unread import says nobody has read it, not that nothing was kept", () => {
  const html = page("unread");
  assert.match(html, /Nobody has read this one yet/);
  assert.ok(
    !html.includes("Nothing kept yet"),
    "it still renders the editor's empty state, which says the opposite of the truth",
  );
});

test("ACCEPTANCE: and it offers the read, at the route that already existed", () => {
  const html = page("unread");
  assert.match(html, />Read it</);
  assert.match(html, /action="\/api\/sources\/src1\/retry"/);
  assert.match(html, /method="POST"/);
});

test("it says reading is charged once, because that is what the state is about", () => {
  /* Invariant 5. The whole reason an import is not read on arrival is that
     reading costs money per video, so the control must say so before it is
     pressed rather than after. */
  assert.match(page("unread"), /charged once/);
});

test("a read one does not offer to read it again", () => {
  const html = page("ready", [
    { id: "s1", source_id: "src1", idx: 0, start_ms: 0, end_ms: 5000, speaker: null, text: "Words.", words: null },
  ]);
  assert.ok(!html.includes("Nobody has read this one yet"));
  assert.ok(!html.includes(">Read it<"));
});

test("ACCEPTANCE: an unread import is not dressed as a failure", () => {
  /*
   * The distinction that matters to somebody who just connected a bucket.
   * "It broke" and "nobody has asked yet" are different facts, and only one
   * of them is their problem. An import rendered in the failed treatment —
   * red, the word Failed, a Retry button — would tell two hundred people
   * their archive had broken on arrival.
   *
   * Pinned from this side because branch ORDER is what keeps them apart, and
   * order is invisible: adding `|| unread` to the failed branch below the
   * unread one changes nothing and passes every other test here.
   */
  const html = page("unread");
  assert.ok(!html.includes(">Retry<"), "an unread import offered a retry");
  assert.ok(!/Failed/.test(html), "an unread import said Failed");
  assert.ok(!html.includes(ACCENT.red), "an unread import was rendered in the error colour");
});

test("a failed one still offers Retry, not Read it", () => {
  /* Two different states with two different sentences: "it broke, try again"
     and "nobody has asked yet". Collapsing them would tell somebody their
     import had failed. */
  const html = page("failed");
  assert.match(html, />Retry</);
  assert.ok(!html.includes("Nobody has read this one yet"));
});

test("one still reading says the stage, not either of those", () => {
  for (const state of ["pending", "running"]) {
    const html = page(state);
    assert.ok(!html.includes(">Read it<"), `${state} offered a read`);
    assert.ok(!html.includes(">Retry<"), `${state} offered a retry`);
  }
});

test("the copy is signed off, because no design draws importing", () => {
  /*
   * The `copy` rule caught the first version of this: I put data-content on
   * the sentence, which exempts text from the strings rule and is for text
   * the DATA wrote. Fixed copy gets checked, and checked copy needs a reason
   * recorded beside it.
   */
  const gate = readFileSync(join(import.meta.dirname, "..", "scripts", "check-fidelity.cjs"), "utf8");
  assert.match(gate, /Nobody has read this one yet\. Reading it writes down every word/);
  assert.match(gate, /An imported source in the `unread` state/);
});
