/**
 * EXTERNAL MOMENTS IN THE ROOM, AND THE GHOSTS THEY BECOME.
 *
 * The chain this file pins, end to end: a verified ledger row is a moment in
 * the Highlights list → attaching it puts its ledger id in `ext` rather than
 * `attach` → /api/begin turns that into a mission → the badge changes because
 * the mission exists → the board lists it as a ghost with a link.
 *
 * WHY THE DDL IS LOADED RATHER THAN RETYPED: the upsert in openMissions
 * conflicts on a UNIQUE INDEX, so a test that created the table by hand
 * without the index would pass while the real thing wrote duplicate rows.
 * The index itself was invisible to both the generator and the gate until
 * this landed — see the note in scripts/schema-doc.cjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import {
  acqOf,
  countExternal,
  externalMoments,
  ghostsFor,
  minesOwn,
  openMissions,
} from "../src/scout-external.ts";
import { clock, momentsShown, renderRoom, type RoomData } from "../src/ui/pages/room.ts";
import { boardFor } from "../src/scout-board-data.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function statement(kind: "table" | "index", name: string): string {
  const re = new RegExp(`create (?:unique )?${kind} if not exists ${name}\\b`, "i");
  const ddl = SCHEMA.split(";").find((s) => re.test(s));
  assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
  return ddl + ";";
}

function db() {
  const d = new DatabaseSync(":memory:");
  for (const name of [
    "v2_users",
    "sources",
    "v2_projects",
    "scout_runs",
    "scout_beats",
    "scout_searches",
    "scout_sources",
    "scout_ledger",
    "scout_missions",
    "plans",
    "plan_beats",
  ]) {
    d.exec(statement("table", name));
  }
  d.exec(statement("index", "scout_missions_one_per_cut"));

  d.prepare("INSERT INTO v2_users (id, email, created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare("INSERT INTO v2_users (id, email, created_at) VALUES ('u2','c@d.e',1)").run();
  d.prepare(
    "INSERT INTO v2_projects (id, user_id, title, kind, created_at, updated_at) VALUES ('p1','u1','P','cut',1,1)",
  ).run();
  d.prepare(
    "INSERT INTO v2_projects (id, user_id, title, kind, created_at, updated_at) VALUES ('p2','u2','Q','cut',1,1)",
  ).run();
  for (const [run, project] of [
    ["r1", "p1"],
    ["r2", "p2"],
  ]) {
    d.prepare(
      "INSERT INTO scout_runs (id, project_id, trigger, status, created_at) VALUES (?,?,'brief','done',1)",
    ).run(run, project);
  }
  d.prepare(
    "INSERT INTO scout_sources (id, run_id, adapter, external_id, url, title, transcript, fetched_at, expires_at) " +
      "VALUES ('s1','r1','youtube','v1','https://www.youtube.com/watch?v=v1','A stream','native',1,99)",
  ).run();
  d.prepare(
    "INSERT INTO scout_sources (id, run_id, adapter, external_id, url, title, transcript, fetched_at) " +
      "VALUES ('s2','r2','twitch','v2','https://www.twitch.tv/videos/2','Theirs','none',1)",
  ).run();
  return d;
}

const ledger = (
  d: ReturnType<typeof db>,
  id: string,
  over: { run?: string; source?: string; verify?: string; quote?: string; t?: number } = {},
) => {
  d.prepare(
    "INSERT INTO scout_ledger (id, run_id, role, source_id, quote_exact, quote_norm, word_span_json, " +
      "t_start_s, t_end_s, verify, created_at) VALUES (?,?,?,?,?,?,'[]',?,?,?,?)",
  ).run(
    id,
    over.run ?? "r1",
    "subject",
    over.source ?? "s1",
    over.quote ?? "give me five dollars",
    (over.quote ?? "give me five dollars").toLowerCase(),
    over.t ?? 754,
    (over.t ?? 754) + 6,
    over.verify ?? "verified",
    1,
  );
  return id;
};

/* ── acq ────────────────────────────────────────────────────────────────── */

test("a mission in hand is acquired; every other mission is still open", () => {
  assert.equal(acqOf("matched"), "verified");
  assert.equal(acqOf("scouted"), "mission");
  assert.equal(acqOf("requested"), "mission");
  /* A failed grab is a thing to do again, not a thing that has been done. */
  assert.equal(acqOf("failed"), "mission");
  assert.equal(acqOf(null), "linked");
  /* Detaching does not delete the row (invariant 6), so a dropped mission
     has to read as linked or a detached moment would keep its gold badge. */
  assert.equal(acqOf("dropped"), "linked");
});

/* ── the reader ─────────────────────────────────────────────────────────── */

test("only verified rows are moments, and only the user's own", async () => {
  const d = db();
  ledger(d, "L1");
  ledger(d, "L2", { verify: "paraphrase" });
  ledger(d, "L3", { verify: "rejected" });
  /* Somebody else's run, through somebody else's project. */
  ledger(d, "L9", { run: "r2", source: "s2" });

  const got = await externalMoments(fakeD1(d) as unknown as D1Database, "u1");
  assert.deepEqual(
    got.map((m) => m.id),
    ["L1"],
    "a paraphrase is not a quote, a rejection is not a find, and r2 is not theirs",
  );
  assert.equal(await countExternal(fakeD1(d) as unknown as D1Database, "u1"), 1);
  assert.equal(await countExternal(fakeD1(d) as unknown as D1Database, "u2"), 1);
});

test("an external moment carries its host and its time, and never a frame", async () => {
  const d = db();
  ledger(d, "L1", { t: 754 });
  const [m] = await externalMoments(fakeD1(d) as unknown as D1Database, "u1");
  assert.equal(m.host, "youtube");
  assert.equal(m.t_start_s, 754);
  /*
   * INVARIANT 9. A frame would be a still we had to fetch and store. There
   * is no column that could hold one and this asserts there is no value
   * either: an empty key is what makes the card render its own empty box.
   */
  assert.equal(m.frame_r2_key, "");
});

test("a find with no mission reads as linked; one with a mission does not", async () => {
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  ledger(d, "L1");

  assert.equal((await externalMoments(api(d), "u1"))[0].acq, "linked");

  await openMissions(api(d), "p1", ["L1"]);
  assert.equal((await externalMoments(api(d), "u1"))[0].acq, "mission");

  d.prepare("UPDATE scout_missions SET state='matched'").run();
  assert.equal((await externalMoments(api(d), "u1"))[0].acq, "verified");
});

test("an id off a form is a claim until it is joined back to the user", async () => {
  const d = db();
  ledger(d, "L1");
  ledger(d, "L9", { run: "r2", source: "s2" });
  const got = await minesOwn(fakeD1(d) as unknown as D1Database, "u1", ["L1", "L9", "nope"]);
  assert.deepEqual([...got], ["L1"]);
});

/* ── the ghosts ─────────────────────────────────────────────────────────── */

test("attaching the same find twice is one mission, and it keeps its link", async () => {
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  ledger(d, "L1", { t: 754 });

  await openMissions(api(d), "p1", ["L1"]);
  await openMissions(api(d), "p1", ["L1"]);

  const rows = await ghostsFor(api(d), "p1");
  assert.equal(rows.length, 1, "the unique index is what makes the second call an update");
  /* The deep link at the in-point, which is the only thing invariant 9
     positively requires Scout to produce. */
  assert.match(rows[0].url ?? "", /t=754s/);
  assert.equal(rows[0].inS, 754);
});

test("a dropped mission comes back when the find is attached again", async () => {
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  ledger(d, "L1");
  await openMissions(api(d), "p1", ["L1"]);
  d.prepare("UPDATE scout_missions SET state='dropped'").run();
  assert.equal((await ghostsFor(api(d), "p1")).length, 0, "a dropped ghost is not in the cut");

  await openMissions(api(d), "p1", ["L1"]);
  const rows = await ghostsFor(api(d), "p1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "scouted");
});

test("a mission already in hand is not reset by attaching again", async () => {
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  ledger(d, "L1");
  await openMissions(api(d), "p1", ["L1"]);
  d.prepare("UPDATE scout_missions SET state='matched'").run();
  await openMissions(api(d), "p1", ["L1"]);
  const row = d.prepare("SELECT state FROM scout_missions").get() as { state: string };
  assert.equal(row.state, "matched", "a grab that happened does not un-happen");
});

test("a find that is not verified cannot become a ghost", async () => {
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  ledger(d, "L2", { verify: "paraphrase" });
  assert.equal(await openMissions(api(d), "p1", ["L2"]), 0);
  assert.equal((await ghostsFor(api(d), "p1")).length, 0);
});

/* ── the room ───────────────────────────────────────────────────────────── */

const base: RoomData = {
  tab: "highlights",
  outsidePref: "ask",
  askMode: "rec",
  attached: [],
  ext: [],
  who: "all",
  threads: [],
  mode: "meaning",
  q: "",
  meaningUnavailable: false,
  working: [],
  finished: [],
  sources: [],
  moments: [],
  projects: [],
  switch: [],
  counts: { sources: 0, moments: 0, external: 0 },
};

const ext = (over: Partial<RoomData["moments"][number]> = {}): RoomData["moments"][number] => ({
  id: "L1",
  quote: "give me five dollars",
  frame_r2_key: "",
  source_title: "A stream",
  thread_name: null,
  provenance: "external",
  acq: "linked",
  host: "youtube",
  ...over,
});

test("Mine · External · All sits on Highlights and nowhere else", () => {
  const on = renderRoom({ ...base, counts: { ...base.counts, external: 3 } });
  assert.match(on, /External · 3/, "the chip carries the count, so nobody has to click to find out");
  /* The prototype's sentence, word for word. It is the only place invariant
     9 is explained to a person at the moment it matters. */
  assert.match(on, /linked, never downloaded/);

  /*
   * THE COUNT HAS TO BE ON THE OTHER TABS TOO.
   *
   * The first version of this spread `base`, whose external count is 0, so
   * it looked for "External · 3" on a page that could only ever have said
   * "External · 0" — it passed whether or not the filter was rendered.
   * Caught by rendering the filter on every tab and watching the test stay
   * green.
   */
  for (const tab of ["videos", "projects"] as const) {
    const off = renderRoom({ ...base, tab, counts: { ...base.counts, external: 3 } });
    assert.doesNotMatch(off, /External · 3/, `${tab} has no who filter`);
  }
});

test("the badge says where an external moment is, not what it is worth", () => {
  const say = (m: Partial<RoomData["moments"][number]>) => renderRoom({ ...base, moments: [ext(m)] });
  assert.match(say({ acq: "linked" }), /External · linked/);
  assert.match(say({ acq: "mission" }), /External · mission open/);
  assert.match(say({ acq: "verified" }), /External · acquired/);
  assert.match(say({ attached: true }), /Attached/);
  /*
   * INVARIANT 3, checked on the badge rather than on the page.
   *
   * The first version of this asserted no /\d+%/ anywhere in the output and
   * failed on `width:100%` in a style attribute — a test that would have
   * gone off for ever over CSS while saying nothing about what a person
   * reads. The badge is the claim; it carries no number of any kind.
   */
  const badge = /<span data-content [^>]*>(External · [^<]+)</.exec(say({ acq: "verified" }));
  assert.ok(badge, "the badge renders");
  assert.doesNotMatch(badge[1], /\d/, "Strong / Worth a look / Long shot — never a score");
});

test("a moment of your own wears no badge at all", () => {
  const html = renderRoom({
    ...base,
    moments: [{ id: "c1", quote: "mine", frame_r2_key: "f/1", source_title: "Tuesday", thread_name: null, provenance: "mine" }],
  });
  /*
   * The card, not the page: the who filter is on Highlights whatever the
   * count is, which is the prototype's `showWho`, so "External" appears in
   * the tab bar of a library with nothing external in it. The badge is what
   * must not be there.
   */
  const card = /<a data-moment="c1"[\s\S]*?<\/a>/.exec(html);
  assert.ok(card, "the card renders");
  assert.doesNotMatch(card[0], /External|Attached/);
});

test("the platform comes first in an external moment's note", () => {
  const html = renderRoom({ ...base, moments: [ext({ host: "twitch", source_title: "A stream" })] });
  assert.match(html, /twitch · A stream/);
  /* And "outside" when we do not know, which is still true. */
  assert.match(renderRoom({ ...base, moments: [ext({ host: null })] }), /outside · A stream/);
});

test("an external card attaches into ext; a card of your own into attach", () => {
  const html = renderRoom({
    ...base,
    moments: [
      ext(),
      { id: "c1", quote: "mine", frame_r2_key: "f/1", source_title: "Tuesday", thread_name: null, provenance: "mine" },
    ],
  });
  /* &amp; because the href is escaped, which is correct and is the thing a
     test written against the source rather than the output gets wrong. */
  assert.match(html, /href="\/\?tab=highlights&amp;ext=L1"/, "a ledger id goes in ext");
  assert.match(html, /href="\/\?tab=highlights&amp;attach=c1"/, "a source id goes in attach");
  /* A ledger id in `attach` would be dropped by the ownership check in
     /api/begin and the cut would come back without it, silently. */
  assert.doesNotMatch(html, /attach=L1/);
});

test("switching who keeps what is attached", () => {
  const html = renderRoom({
    ...base,
    attached: ["srcA"],
    ext: ["L1"],
    q: "money",
    counts: { ...base.counts, external: 1 },
  });
  assert.match(
    html,
    /href="\/\?tab=highlights&amp;attach=srcA&amp;ext=L1&amp;who=mine&amp;q=money"/,
    "every link in the room carries the whole room",
  );
});

test("an attached ghost rides into the cut as a hidden field, not as a source", () => {
  const html = renderRoom({ ...base, tab: "videos", attached: ["srcA"], ext: ["L1"] });
  assert.match(html, /name="sourceIds" value="srcA"/);
  assert.match(html, /name="ledgerIds" value="L1"/);
  assert.doesNotMatch(html, /name="sourceIds" value="L1"/);
});

test("the empty line under External is not the one about your own footage", () => {
  const mine = renderRoom({ ...base, who: "mine" });
  assert.match(mine, /add a clip back/);
  const outside = renderRoom({ ...base, who: "external" });
  assert.doesNotMatch(outside, /add a clip back/, "there is nothing to add back that was never yours");
  assert.match(outside, /finds and links/);
});

/* ── The board reads them back ──────────────────────────────────────────── */

test("the board gets this cut's ghosts from the rows, not from a fixture", async () => {
  /*
   * scout-board.test.ts tests the renderer with fixtures on purpose — its
   * own header says why. That leaves the join untested, and a boardFor that
   * returned [] would render a page with no ghost panel and no complaint.
   * Caught exactly that way: removing the read from boardFor left every
   * board test green.
   */
  const api = (d: ReturnType<typeof db>) => fakeD1(d) as unknown as D1Database;
  const d = db();
  d.prepare(
    "INSERT INTO scout_beats (id, run_id, project_id, idx, role, name, behaviour, status) " +
      "VALUES ('b1','r1','p1',0,'subject','The pattern','Berates live chat','met')",
  ).run();
  ledger(d, "L1", { t: 754 });
  await openMissions(api(d), "p1", ["L1"]);

  const board = await boardFor(api(d), "p1");
  assert.equal(board.ghosts?.length, 1);
  assert.equal(board.ghosts?.[0].ledgerId, "L1");
  assert.equal(board.ghosts?.[0].inS, 754);
  assert.match(board.ghosts?.[0].url ?? "", /t=754s/);

  /* And a cut that carries none says so, rather than undefined. */
  assert.deepEqual((await boardFor(api(d), "p2")).ghosts, []);
});

/* ── The card, against the rendered prototype ───────────────────────────── */

test("a frameless card says where the moment is instead of showing a hole", () => {
  /*
   * RENDERING IT IS WHAT FOUND THIS. An external moment has no frame and
   * must not — a still would be a thing fetched and stored, which is the
   * line invariant 9 draws — and the first version rendered the empty box:
   * three black rectangles down a grid of your own footage, which reads as
   * broken rather than as linked.
   */
  const html = renderRoom({ ...base, moments: [ext({ at_s: 754 })] });
  assert.doesNotMatch(html, /<img/, "nothing was downloaded, so there is nothing to show");
  assert.match(html, /youtube/);
  assert.match(html, /at 12:34/);
});

test("the badge is top right, where the prototype puts it", () => {
  /* It was top LEFT first, which is where the prototype puts the source
     letter. Found by putting the two side by side. */
  const html = renderRoom({ ...base, moments: [ext()] });
  assert.match(html, /position:absolute;right:6px;top:6px;[^>]*>External · linked/);
});

test("a moment's timecode sits at the end of its note row", () => {
  const html = renderRoom({
    ...base,
    moments: [
      { id: "c1", quote: "mine", frame_r2_key: "f/1", source_title: "Tuesday", thread_name: "why leave", provenance: "mine", at_s: 400, dur_s: 38 },
    ],
  });
  assert.match(html, /why leave<\/span>\s*<span data-content [^>]*>6:40</);
  /* And the length, bottom right of the frame — the prototype's `dur`. */
  assert.match(html, /bottom:6px;[^>]*>0:38</);
});

test("the clock keeps hours past the hour and drops them before it", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(59.4), "0:59");
  assert.equal(clock(754), "12:34");
  /* 2:13:58 is a Twitch VOD timestamp; 133:58 would be read as wrong. */
  assert.equal(clock(8038), "2:13:58");
  assert.equal(clock(undefined), "", "a moment with no time says nothing, not 0:00");
});

test("the tab's count is the length of the list under it", () => {
  /*
   * The rule used to be an inline ternary in the route handler, where no
   * test could reach it — removing it left every test green while the tab
   * read 0 over three cards. It is a function now for that reason.
   */
  assert.equal(momentsShown("mine", 14, 3), 14);
  assert.equal(momentsShown("external", 14, 3), 3);
  assert.equal(momentsShown("all", 14, 3), 17);
  assert.equal(momentsShown("external", 0, 0), 0);
});
