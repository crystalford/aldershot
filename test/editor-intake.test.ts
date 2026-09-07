/**
 * The editor with nothing open.
 *
 * /editor now opens the edit you were last in, so this surface is only ever
 * reached by an account with no edits at all — which means the fidelity
 * strings check, run against a populated account, stops covering it. It is
 * also the first screen a new user sees. So it is tested here instead, where
 * having no edits is a fact rather than an accident of whose database it is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEditorIntake } from "../src/ui/pages/editor-intake.ts";

const source = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  title: "Kino Casino #372",
  duration_s: 2880,
  poster_r2_key: "poster.jpg",
  clip_count: 11,
  transcript_state: "ready",
  ...over,
});

test("the way in is the composer, with somewhere to drop a file", () => {
  const html = renderEditorIntake({ sources: [] });
  assert.match(html, /id="composer"/);
  assert.match(html, /id="filePick"/);
  assert.match(html, /Drop a video file or paste a link/);
  assert.match(html, /Start cutting/);
});

test("footage already here is offered, with its length and its clips", () => {
  const html = renderEditorIntake({ sources: [source()] });
  assert.match(html, /Or open something already here/);
  assert.match(html, /Kino Casino #372/);
  assert.match(html, /48:00 · 11 clips found/);
});

test("a video still being read is not offered as something to open", () => {
  /* Opening it would make a cut of a transcript that does not exist yet. */
  const html = renderEditorIntake({ sources: [source({ transcript_state: "running" })] });
  assert.doesNotMatch(html, /Kino Casino #372/);
});

test("it no longer lists edits — that was Home with different words", () => {
  const html = renderEditorIntake({ sources: [source()] });
  assert.doesNotMatch(html, /Pick up an edit/);
});

test("with nothing at all it still says what to do, rather than going blank", () => {
  const html = renderEditorIntake({ sources: [] });
  assert.match(html, /Give it a video and say what you want out of it/);
  assert.ok(html.length > 1000, "an empty account got an empty page");
});
