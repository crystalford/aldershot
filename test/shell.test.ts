/**
 * THE SHELL KNOWS WHO IS SIGNED IN — ON EVERY PAGE, NOT MOST OF THEM.
 *
 * The avatar showed your initial on Home and a bare bullet the moment you
 * opened a video. Half the app knew who you were, and the half that did not
 * was the half you spend all your time in.
 *
 * The cause was a default. `email` was optional on PageOpts with a neutral
 * fallback, so "every authenticated route has the user in hand" held only as
 * long as every call site remembered — and the editor, which calls page()
 * directly rather than through the surface() helper, did not. Nothing failed.
 * It just rendered a plausible-looking wrong answer, which is the shape of bug
 * that spreads quietly through a codebase.
 *
 * So the fix is a type, not six edits: `email` is required, and forgetting it
 * stops the build. These hold the two halves of that — the rendering, and the
 * requirement itself, because a type that gets loosened back to optional would
 * bring the bullet back with it and no test of the OUTPUT would notice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { page } from "../src/ui/shell.ts";

const render = (email: string | null) =>
  page({ title: "t", view: "cut", screenLabel: "Cutting room", shortsCtx: "editor", email }, "<p>body</p>");

test("a signed-in page shows the signed-in initial", () => {
  const html = render("chris@example.com");
  /* The avatar is the last thing in the nav's right-hand group. Asserted on
     the link to Settings, so this cannot pass on a stray C elsewhere. */
  assert.match(html, /href="\/settings"[^>]*>C</, "the avatar must carry the initial");
  assert.match(html, /title="chris@example\.com"/, "and name the account it belongs to");
});

test("the initial comes from the address, whatever shape the address is", () => {
  /* The product never asks for a name, so the address is the only name it has.
     Leading digits and punctuation are not an initial. */
  assert.match(render("7hazel@example.com"), /href="\/settings"[^>]*>H</);
  assert.match(render("  Bea@Example.com "), /href="\/settings"[^>]*>B</);
});

test("signed out is a bullet, and that is the only time a bullet is right", () => {
  /* Passing null is a statement. The bug was reaching this state by omission,
     on pages where somebody WAS signed in. */
  assert.match(render(null), /href="\/settings"[^>]*>•</);
  assert.doesNotMatch(render(null), /title="[^"]+"/, "and it names nobody");
});

test("the page cannot be rendered without saying who is signed in", () => {
  /*
   * THE ACTUAL FIX, AND THE ONLY PART A TEST OF THE OUTPUT CANNOT SEE.
   *
   * Every assertion above still passes if `email` goes back to optional — they
   * all pass one. What broke the editor was a call site that passed NOTHING,
   * and the only thing standing between that and a bullet is the type.
   *
   * Read from the source because that is where the guarantee lives: a
   * questionable `email?:` would compile, ship, and quietly reintroduce the
   * exact bug this file is named after.
   */
  const shell = readFileSync(join(import.meta.dirname, "..", "src", "ui", "shell.ts"), "utf8");
  const opts = shell.slice(shell.indexOf("export interface PageOpts"));
  assert.match(opts.slice(0, opts.indexOf("}")), /\n\s*email: string \| null;/,
    "email must be required on PageOpts, or forgetting it is a bullet rather than a build error");
});
