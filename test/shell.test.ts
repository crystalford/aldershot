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
  page({ title: "t", view: "cut", screenLabel: "Cutting room", email }, "<p>body</p>");

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
  /*
   * ON THE AVATAR'S OWN TITLE, not on the page having no titles at all.
   *
   * It used to assert that nothing anywhere carried a title, which was true
   * only because nothing else did. The wordmark now carries the prototype's
   * — "Close the project — back to your footage" — and that assertion went
   * red for a reason that has nothing to do with what it was protecting.
   * The claim is that a signed-out page does not name an account.
   */
  const anon = render(null).match(/href="\/settings"[^>]*title="([^"]*)"/);
  assert.ok(anon, "the avatar must still say what it is");
  assert.equal(anon[1], "Settings", "and name nobody");
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

/**
 * THE BAR IS THE WORDMARK AND THE AVATAR.
 *
 * One Take's header carries two things. The build carried seven: Home,
 * Editor and Footage, a search chip, a "?", a bell and the avatar — a nav
 * describing a product with several places to go, on a product with one
 * room and two states.
 *
 * Noticed by the owner from a screenshot, and confirmed against the
 * prototype's own markup, which is a 52px row holding the mark on the left
 * and one circle on the right.
 */
test("the bar carries the mark and the initial, and nothing else", () => {
  const html = render("chris@example.com");
  /* FROM <body>, not from the start of the document — data-screen-label
     also appears up in the stylesheet, so slicing to its first occurrence
     took a window that ended before the bar began and the assertions all
     failed on an empty string. */
  const from = html.indexOf("<body>");
  const bar = html.slice(from, html.indexOf("data-screen-label", from));

  assert.match(bar, /aldershot/, "the mark");
  assert.match(bar, /href="\/settings"/, "the initial");

  for (const gone of [">Home<", ">Editor<", ">Footage<", "navSearch", "navKeys", "navNotif"]) {
    assert.ok(!bar.includes(gone), `the bar must not carry ${gone}`);
  }
  /* Exactly two links in it. A third is a nav item growing back. */
  assert.equal((bar.match(/<a /g) ?? []).length, 2, "two controls, not three");
});

test("the wordmark says what pressing it does", () => {
  /*
   * In One Take it is not a logo that happens to link home — it is the way
   * OUT of a project, and the prototype's title says exactly that. There is
   * one room and two states, so leaving the project is the only navigation
   * the product has.
   */
  const html = render("chris@example.com");
  assert.match(html, /data-mark="true"[^>]*title="Close the project &mdash; back to your footage"/);
  assert.match(html, /<a href="\/" data-mark="true"/, "and it goes to the room");
});

test("the mark's bars start on the palette's first colour, not on a surface's", () => {
  /*
   * They used to be a lookup from the view — gold on Home, green on a cut —
   * which was right for the retired design's several surfaces and wrong for
   * one room. The prototype cycles four colours per visit and steps them on
   * hover; the server paints the first and client.ts moves it on.
   *
   * The owner spotted the difference from a screenshot: gold in the build
   * where the prototype was teal.
   */
  const html = render("chris@example.com");
  const bars = html.match(/class="mark-bar"[^>]*/g) ?? [];
  assert.equal(bars.length, 3, "three bars");
  for (const b of bars) assert.match(b, /background:#5EB8C9/, "the palette's first colour");

  const client = readFileSync(join(import.meta.dirname, "..", "src", "ui", "client.ts"), "utf8");
  assert.match(client, /localStorage\.getItem\("aldershot\.mark"\)/, "the prototype's own key");
  assert.match(client, /addEventListener\("mouseenter"/, "and it steps on hover");
  const tokens = readFileSync(join(import.meta.dirname, "..", "src", "ui", "tokens.ts"), "utf8");
  assert.ok(!/MARK_LEAD:/.test(tokens), "the per-surface lookup must not come back");
});
