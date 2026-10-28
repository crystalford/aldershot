/**
 * A ROUTE A CATCH-ALL HAS ALREADY SWALLOWED.
 *
 * Hono matches in registration order. `/p/:id/:stagePath` matches
 * `/p/<id>/receipts` too, and answers notFound for anything not in
 * EDITOR_PATHS — so a literal sibling registered AFTER it 404s on every
 * request while looking completely correct where it is written.
 *
 * It happened twice in a week: the receipts admin page and the Before you
 * post sheet, both found only by driving a browser at them. /p/:id/scout
 * escaped it by being declared further up the file, which is not a thing to
 * rely on.
 *
 * Tested on a synthetic source rather than on src/index.ts, for two reasons:
 * a rule that only passes because the repo currently happens to be in order
 * proves nothing, and the first attempt to break the real file moved the
 * catch-all along with the route — so the "break" preserved the order it was
 * meant to destroy and the rule looked broken when it was not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/*
 * createRequire rather than an import: surfaces.cjs is a CommonJS gate script
 * with no types, and `import` of it fails the typecheck the gate runs first.
 * The scripts stay plain .cjs deliberately — they have to run with no build
 * step — so the test reaches them the way node does.
 */
const { declared } = createRequire(import.meta.url)("../scripts/surfaces.cjs") as {
  declared: (source?: string) => { shadowed: Array<{ route: string; by: string }> };
};

const route = (path: string) => [`app.get("${path}", async (c) => {`, '  return c.html("x");', "});"].join("\n");

test("a literal sibling after the catch-all is reported", () => {
  const { shadowed } = declared([route("/p/:id/:stagePath"), route("/p/:id/receipts")].join("\n"));
  assert.deepEqual(shadowed, [{ route: "/p/:id/receipts", by: "/p/:id/:stagePath" }]);
});

test("the same two in the right order are not", () => {
  const { shadowed } = declared([route("/p/:id/receipts"), route("/p/:id/:stagePath")].join("\n"));
  assert.deepEqual(shadowed, []);
});

test("every literal after it is reported, not just the first", () => {
  const { shadowed } = declared(
    [route("/p/:id/:stagePath"), route("/p/:id/receipts"), route("/p/:id/before-post")].join("\n"),
  );
  assert.deepEqual(
    shadowed.map((s) => s.route),
    ["/p/:id/receipts", "/p/:id/before-post"],
  );
});

test("a different prefix is not shadowed by it", () => {
  /* /sources/:id/edit is not matched by /p/:id/:stagePath, and reporting it
     would be a rule that cries wolf — which is how a rule gets switched off. */
  const { shadowed } = declared([route("/p/:id/:stagePath"), route("/sources/:id/edit")].join("\n"));
  assert.deepEqual(shadowed, []);
});

test("two parameters after the prefix are not a literal, so not shadowed", () => {
  /* `/p/:id/:view` is another catch-all, not a page hiding behind one. */
  const { shadowed } = declared([route("/p/:id/:stagePath"), route("/p/:id/:view")].join("\n"));
  assert.deepEqual(shadowed, []);
});

test("ACCEPTANCE: this repo has none", () => {
  /* The rule running on the real file, which is the other half: the synthetic
     cases prove it CAN fire, this proves it is satisfied here. */
  assert.deepEqual(declared().shadowed, []);
});
