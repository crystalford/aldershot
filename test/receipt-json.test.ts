/**
 * THE RECEIPT, AS DATA.
 *
 * A published receipt now has two readers: a person who followed a link from a
 * video description, and a machine handed the same link. The whole value of
 * the second one is that the evidence stays attached to the maker — it is a
 * URL they can switch off, not a payload somebody keeps — and that the data
 * says exactly what the page says and nothing more.
 *
 * So these tests are about three things, in order of how badly they would hurt:
 * that the JSON cannot carry a field nobody chose to publish, that a revoked
 * or unknown token is indistinguishable from outside, and that the route which
 * serves the JSON actually matches the URL it claims to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { publishedReceipt, receiptsHtml, receiptsPage, verifiedSays, type ReceiptsPage } from "../src/receipts.ts";
import { disputeEntries, type DisputeClip } from "../src/dispute.ts";
import { fakeD1, schema } from "./helpers/fake-d1.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const clip = (over: Partial<DisputeClip> = {}): DisputeClip => ({
  ledgerId: "l1",
  channel: "Council Live",
  sourceTitle: "Full council meeting",
  platform: "youtube",
  url: "https://example.org/watch?v=abc",
  inS: 1200,
  outS: 1214,
  originalS: 4800,
  credit: "Source: Council Live",
  creditRemoved: false,
  verify: "verified",
  quote: "We moved the launch before the review came in.",
  ...over,
});

const page = (): ReceiptsPage =>
  receiptsPage({
    title: "Whether to leave",
    claim: "the account came first and the engineering was fitted to it",
    external: disputeEntries([clip()]),
    pictures: [{ label: "A diagram", what: "the orbit, drawn", how: "drawn from the numbers in the quote" }] as never,
  });

/*
 * EVERY FIELD IN THE DATA IS A FIELD ON THE PAGE.
 *
 * This is the whole reason the JSON is `receiptsPage`'s own return value and
 * not a second query. A key that reaches the data and never reaches the page
 * is a field nobody decided to publish — it got there because it was in a row
 * somebody selected. Walk the object and find each value in the rendered HTML.
 */
test("the data carries nothing the page does not show", () => {
  const p = page();
  const html = receiptsHtml(p);
  const seen: string[] = [];

  /*
   * ONE FIELD IS DISCLOSED IN DERIVED FORM, DELIBERATELY.
   *
   * `verify` is the raw state — "verified", "paraphrase", "rejected", null —
   * and the page never prints it. What the page prints is verifiedSays() of
   * it, plus a class from isChecked() of it. So it discloses nothing the
   * reader cannot already see; it is the same fact in the form a machine wants
   * instead of the form a person wants, which is the entire point of serving
   * data at all.
   *
   * Named here with its derivation rather than skipped, because "this field is
   * fine" is the sentence that lets the next one through. A field is allowed
   * only if something computed FROM it is on the page.
   */
  /* Optional in the value type: without it TypeScript reads a miss as a hit
     and the branch below as dead code. */
  const derived: Record<string, ((v: unknown) => string) | undefined> = {
    verify: (v) => verifiedSays(v as string | null),
  };

  const walk = (v: unknown, path: string): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        walk(inner, path ? `${path}.${k}` : k);
      }
      return;
    }
    seen.push(path);
    const leaf = path.split(".").pop() as string;
    const show = derived[leaf];
    /* Numbers appear in prose ("1 of 1 have been checked"), strings appear
       escaped. Both must be findable in the page somewhere. */
    const needle = show ? show(v) : typeof v === "number" ? String(v) : String(v).slice(0, 40);
    assert.ok(
      html.includes(needle) || html.includes(needle.replace(/&/g, "&amp;")),
      show
        ? `${path} = ${JSON.stringify(v)} is disclosed as ${JSON.stringify(needle)}, which is not on the page`
        : `${path} = ${JSON.stringify(v)} is in the data and nowhere on the page`,
    );
  };
  walk(p, "");

  /* And the walk actually walked: an assertion that visits nothing passes. */
  assert.ok(seen.length >= 10, `only ${seen.length} values were checked: ${seen.join(", ")}`);
});

/*
 * NO SCORE, EVER (invariant 3).
 *
 * The page has never shown one and the data must not either. These are the
 * column names that would carry one if a future query reached for them, which
 * is the realistic way this breaks: not somebody adding `score` to the public
 * page, but somebody widening the SELECT behind it.
 */
test("no score, heat or percentage reaches the data", () => {
  const json = JSON.stringify(page());
  for (const banned of ["score", "heat", "match_score", "triage_score", "coverage", "pct"]) {
    assert.ok(!json.includes(banned), `the receipt data mentions ${banned}`);
  }
  assert.ok(!/\d+(\.\d+)?%/.test(json), "the receipt data contains a percentage");
});

/* ---- publishedReceipt, against the real SQL ---- */

const seeded = (over: { revoked?: number | null } = {}) => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.exec(`INSERT INTO v2_projects (id, user_id, title, created_at, updated_at)
           VALUES ('p1', 'u1', 'Whether to leave', 1, 1)`);
  db.exec(`INSERT INTO plans (id, user_id, topic, claim, state, project_id, created_at)
           VALUES ('pl1', 'u1', 'the rockets', 'the account came first', 'beats', 'p1', 1)`);
  db.exec(`INSERT INTO receipt_pages (project_id, user_id, token, published_at, revoked_at)
           VALUES ('p1', 'u1', 'livetoken', 1, ${over.revoked === undefined ? "NULL" : over.revoked})`);
  return fakeD1(db) as never;
};

test("a live token builds the receipt, claim and all", async () => {
  const got = await publishedReceipt(seeded(), "livetoken");
  assert.ok(got, "a published token returned nothing");
  assert.equal(got.title, "Whether to leave");
  assert.equal(got.claim, "the account came first");
});

/*
 * THE THREE WAYS OF HAVING NOTHING LOOK THE SAME.
 *
 * Somebody guessing tokens must not be able to tell a token that never existed
 * from one that was taken down — otherwise the guessing tells them which
 * makers published and changed their minds. All three return the same null,
 * and the callers turn that into the same 404.
 */
test("unknown, revoked and orphaned tokens are all simply nothing", async () => {
  assert.equal(await publishedReceipt(seeded(), "nosuchtoken"), null);
  assert.equal(await publishedReceipt(seeded({ revoked: 99 }), "livetoken"), null);

  const orphaned = new DatabaseSync(":memory:");
  schema(orphaned);
  orphaned.exec(`INSERT INTO receipt_pages (project_id, user_id, token, published_at, revoked_at)
                 VALUES ('gone', 'u1', 'livetoken', 1, NULL)`);
  assert.equal(await publishedReceipt(fakeD1(orphaned) as never, "livetoken"), null);
});

/*
 * THE ROUTE PATTERN, READ OUT OF THE ROUTE.
 *
 * src/index.ts cannot be imported by a test — its import graph reaches a
 * .woff2 and node's type stripper refuses the file — so the pattern is lifted
 * out of the source and mounted on a bare Hono app. Retyping it here would
 * test a copy, and a copy stays green while the route it describes changes.
 */
test("the json route matches a token with .json and the page route does not", async () => {
  const src = readFileSync(join(root, "src/index.ts"), "utf8");
  const found = src.match(/app\.get\("(\/r\/:file\{[^"]*\})"/);
  assert.ok(found, "no .json receipts route found in src/index.ts");

  const app = new Hono();
  app.get(found[1].replace(/\\\\/g, "\\"), (c) => c.text("json"));
  app.get("/r/:token", (c) => c.text("html"));

  assert.equal(await (await app.request("/r/livetoken.json")).text(), "json");
  assert.equal(await (await app.request("/r/livetoken")).text(), "html");
  /* A token is lowercase alphanumeric, so nothing else should reach the json
     route — least of all a path that climbs out of /r/. */
  assert.equal(await (await app.request("/r/UPPER.json")).text(), "html");
});
