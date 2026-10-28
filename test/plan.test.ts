/**
 * The plan: a claim, the beats that argue it, and the one stop between them
 * and any footage.
 *
 * The thing this flow gets wrong quietly is the stop. Run the search before
 * the beats are answered and the product has spent retrieval over the whole
 * library on beats the user was about to cut — and worse, has shown them a
 * cut they never approved the shape of. Phase 3's acceptance names it: it
 * stops exactly once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlan, findForBeats, ROLE_NAME, THIN_BELOW, type Role } from "../src/plan.ts";
import { renderPlan, type PlanData } from "../src/ui/pages/plan.ts";
import { DatabaseSync } from "node:sqlite";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { getPlan, setFound } from "../src/plan-store.ts";


const answer = (body: unknown) => JSON.stringify(body);

test("a beat with nothing to find is not a beat", () => {
  /*
   * `need` is the retrieval query. A beat without one searches for nothing,
   * finds nothing, and reads on screen as a library with no footage in it —
   * so it is dropped rather than carried as a permanent empty row.
   */
  const { claim, beats } = parsePlan(
    answer({
      claim: "Leaving is noticed, not decided.",
      beats: [
        { role: "subject", name: "The archaeology", need: "every plan is a plan to be elsewhere" },
        { role: "subject", name: "No need here", need: "   " },
        { role: "counter", name: "", need: "the case for staying" },
        { role: "nonsense", name: "Odd role", need: "something" },
      ],
    }),
  );
  assert.equal(claim, "Leaving is noticed, not decided.");
  assert.deepEqual(beats.map((b) => b.name), ["The archaeology", "Odd role"]);
  /* An unrecognised role reads as the case being made rather than as a label
     nobody wrote. */
  assert.equal(beats[1].role, "subject");
});

test("a model answer that is not an answer produces nothing, not a crash", () => {
  assert.deepEqual(parsePlan("sorry, I can't do that"), { claim: "", beats: [] });
  assert.deepEqual(parsePlan(null), { claim: "", beats: [] });
  assert.deepEqual(parsePlan(answer({ beats: "not a list" })), { claim: "", beats: [] });
});

test("an outside voice is an honest gap, not a search of your own footage", async () => {
  /*
   * "One voice that isn't yours" means footage the user did not shoot, which
   * is Scout's job, and Scout runs per project — a plan is not one until Cut
   * it. Searching their own library for it would return their own voice and
   * label it somebody else's, which is the one failure a product built on
   * receipts cannot have.
   */
  const asked: string[] = [];
  const found = await findForBeats(
    [
      { id: "b1", role: "subject" as Role, need: "every plan is a plan to be elsewhere" },
      { id: "b2", role: "outside" as Role, need: "someone else who made the same trade" },
    ],
    async (need) => {
      asked.push(need);
      return [
        { id: "c1", backs: true },
        { id: "c2", backs: true },
      ];
    },
  );

  assert.deepEqual(asked, ["every plan is a plan to be elsewhere"], "the outside beat is never searched");
  assert.deepEqual(found[0], { beatId: "b1", clipIds: ["c1", "c2"], thin: false, backed: 2, gap: null });
  assert.equal(found[1].clipIds.length, 0);
  assert.match(found[1].gap ?? "", /isn't yours/);
  assert.equal(found[1].thin, true);
});

test("a beat that finds little is marked thin, never padded", async () => {
  /* A hole in the argument is worth showing. Widening the search until
     something turns up fills the beat with footage that does not meet it. */
  const un = (ids: string[]) => ids.map((id) => ({ id, backs: null }));
  const found = await findForBeats(
    [
      { id: "a", role: "subject" as Role, need: "x" },
      { id: "b", role: "subject" as Role, need: "y" },
    ],
    async (need) => (need === "x" ? un(["c1"]) : un(["c1", "c2", "c3"])),
  );
  assert.equal(found[0].thin, true, "one moment is thin");
  assert.equal(found[1].thin, false);
  assert.equal(THIN_BELOW, 2, "the threshold is the whole rule; changing it re-marks every plan");
});

test("thin means little that BACKS it, not few results", async () => {
  /*
   * Retrieval returns six moments for any beat with words in it, so counting
   * them measured whether the search box worked rather than whether the beat
   * has an argument under it. Six moments about the same evening, none of
   * which say the thing, is exactly the hole this is for — and it read as a
   * well-stocked beat.
   */
  const found = await findForBeats(
    [{ id: "a", role: "subject" as Role, need: "x" }],
    async () => [
      { id: "c1", backs: false },
      { id: "c2", backs: false },
      { id: "c3", backs: false },
      { id: "c4", backs: true },
    ],
  );
  assert.equal(found[0].backed, 1);
  assert.equal(found[0].thin, true, "one backing moment out of four is a thin beat");
  assert.equal(found[0].clipIds.length, 4, "and the others are still there to look at");
});

test("found something, and none of it says the thing, is its own kind of hole", async () => {
  /* The only one a person can act on without shooting anything: the words
     are wrong, not the footage. */
  const found = await findForBeats(
    [{ id: "a", role: "subject" as Role, need: "x" }],
    async () => [
      { id: "c1", backs: false },
      { id: "c2", backs: false },
    ],
  );
  assert.equal(found[0].backed, 0);
  assert.match(found[0].gap ?? "", /nothing here says it/);
});

test("nobody checked is not nothing backs it", async () => {
  /*
   * When the judge was not run, or its call failed, this counts results as
   * it always did. A beat marked thin because a model call failed would
   * send somebody to reshoot footage they already have.
   */
  const found = await findForBeats(
    [{ id: "a", role: "subject" as Role, need: "x" }],
    async () => [
      { id: "c1", backs: null },
      { id: "c2", backs: null },
    ],
  );
  assert.equal(found[0].backed, null, "and it says so rather than reporting zero");
  assert.equal(found[0].thin, false);
  assert.equal(found[0].gap, null);
});

test("an empty beat is thin without claiming nothing said it", async () => {
  /* Nothing was retrieved, so there is nothing to have failed to back. */
  const found = await findForBeats([{ id: "a", role: "subject" as Role, need: "x" }], async () => []);
  assert.equal(found[0].thin, true);
  assert.equal(found[0].gap, null, "an empty library is not a wording problem");
});

test("the flow stops exactly once, and the page offers only the step it is on", () => {
  /*
   * PHASE 3'S ACCEPTANCE. Offering both buttons would let somebody cut a plan
   * that has found nothing, and a control that cannot act is what the
   * conventions check exists to stop.
   */
  const base: PlanData = {
    id: "p1",
    topic: "why leaving is noticed",
    claim: "Leaving is noticed, not decided.",
    state: "beats",
    projectId: null,
    beats: [
      { id: "b1", role: "subject", name: "The archaeology", need: "every plan is elsewhere", kept: true, found: 0, backed: null, gap: null },
      { id: "b2", role: "counter", name: "The deliberation defence", need: "the case for staying", kept: true, found: 0, backed: null, gap: null },
    ],
  };

  const atStop = renderPlan(base);
  assert.match(atStop, /class="plan-find"/);
  assert.ok(!/class="plan-cut"/.test(atStop), "nothing to cut until something is found");
  assert.ok(!/· thin/.test(atStop), "before searching, every beat has nothing and none of it is news");

  const found = renderPlan({ ...base, state: "found", beats: base.beats.map((b, i) => ({ ...b, found: i ? 4 : 1 })) });
  assert.ok(!/class="plan-find"/.test(found));
  assert.match(found, /class="plan-cut"/);
  assert.match(found, /· thin/, "and the one with a single moment says so");

  const cut = renderPlan({ ...base, state: "cut", projectId: "proj1" });
  assert.match(cut, /href="\/p\/proj1\/cut"[^>]*>Open the cut</);
  assert.ok(!/class="plan-(find|cut)"/.test(cut), "a plan that has been cut offers neither again");
});

test("every beat is keepable, and the role is named the prototype's way", () => {
  const html = renderPlan({
    id: "p1",
    topic: "t",
    claim: "c",
    state: "beats",
    projectId: null,
    beats: [
      { id: "b1", role: "subject", name: "a", need: "n", kept: true, found: 0, backed: null, gap: null },
      { id: "b2", role: "counter", name: "b", need: "n", kept: false, found: 0, backed: null, gap: null },
      { id: "b3", role: "outside", name: "c", need: "n", kept: true, found: 0, backed: null, gap: "a voice that isn't yours" },
    ],
  });
  assert.equal((html.match(/class="beat-keep"/g) ?? []).length, 3);
  /* data-BEAT, not data-plan: the container carries data-plan, so a button
     carrying it too made closest("[data-plan]") return the button itself and
     the beat id went out as the plan id. */
  assert.match(html, /class="beat-keep"[^>]*data-beat="b1"/);
  assert.ok(!/class="beat-keep"[^>]*data-plan=/.test(html));
  for (const label of Object.values(ROLE_NAME)) assert.ok(html.includes(label), `missing ${label}`);
});

test("the search runs only after the stop, and never on a brief's fallback", () => {
  /*
   * findMaterial answers a brief that matched nothing with "your most
   * recent", which is right for "eight minutes on whatever I have" and a lie
   * for a beat's need — it would fill a beat with footage that has nothing to
   * do with it and mark the beat healthy.
   */
  /* The rule moved to src/beat-find.ts when the compose came out of the
     route — the route is three lines now, and this reads where the rule
     actually is rather than where it used to be. */
  assert.match(
    readFileSync(join(import.meta.dirname, "..", "src", "beat-find.ts"), "utf8"),
    /if \(out\.how === "recent" \|\| !out\.moments\.length\) return \[\];/,
    "a beat's need is a search, not a brief",
  );
  assert.match(
    readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8"),
    /PAST THE STOP[\s\S]{0,1200}?plan\.beats\.filter\(\(x\) => x\.kept\)/,
    "and only kept beats are searched",
  );
});

test("the page says how many back it, and only when somebody checked", () => {
  /*
   * "3 of 6 back it" and "6 moments" are different facts and only one is
   * about the argument. Claiming a coverage nobody measured would be worse
   * than saying less, so the unchecked case keeps the sentence it had
   * before the judge existed.
   */
  const beat = (over: Record<string, unknown>) => ({
    id: "b1",
    role: "subject" as const,
    name: "The archaeology",
    need: "n",
    kept: true,
    found: 6,
    backed: null as number | null,
    gap: null as string | null,
    ...over,
  });
  const page = (over: Record<string, unknown>) =>
    renderPlan({
      id: "p1",
      topic: "t",
      claim: "c",
      state: "found",
      projectId: null,
      beats: [beat(over)],
    });

  /*
   * Scoped to the BEAT ROW. The footer says "6 moments" too when nothing
   * was checked, so asserting over the whole page passed with the row
   * rendering "0 of 6 back it" — a coverage figure for a beat nobody
   * covered, which is the exact claim this guards against.
   */
  const row = (html: string) => html.slice(html.indexOf("The archaeology"), html.indexOf("beat-keep"));
  assert.match(row(page({ backed: 3 })), /3 of 6 back it/);
  assert.doesNotMatch(row(page({ backed: 3 })), /6 moments/);
  assert.match(row(page({ backed: null })), /6 moments/, "nobody checked, so the count is all there is");
  assert.doesNotMatch(row(page({ backed: null })), /back it/, "and it never says 0 of 6");
});

test("thin is about what backs it, and falls back to the count when nobody checked", () => {
  const beat = (backed: number | null, found: number) => ({
    id: "b1",
    role: "subject" as const,
    name: "n",
    need: "n",
    kept: true,
    found,
    backed,
    gap: null,
  });
  const page = (backed: number | null, found: number) =>
    renderPlan({ id: "p1", topic: "t", claim: "c", state: "found", projectId: null, beats: [beat(backed, found)] });

  assert.match(page(1, 6), /thin/, "one backing moment out of six is a thin beat");
  assert.doesNotMatch(page(4, 6), /thin/);
  /* And the old behaviour where nothing checked. */
  assert.doesNotMatch(page(null, 6), /thin/);
  assert.match(page(null, 1), /thin/);
});

test("the summary follows the rows, and only claims coverage when everything was checked", () => {
  /*
   * A total mixing checked and unchecked beats would be a coverage figure
   * for a set nobody covered — the exact shape of claim this product
   * exists to refuse.
   */
  const b = (over: Record<string, unknown>) => ({
    id: "b",
    role: "subject" as const,
    name: "n",
    need: "n",
    kept: true,
    found: 3,
    backed: null as number | null,
    gap: null as string | null,
    ...over,
  });
  const page = (beats: PlanData["beats"]) =>
    renderPlan({ id: "p1", topic: "t", claim: "c", state: "found", projectId: null, beats });

  assert.match(page([b({ id: "1", backed: 2 }), b({ id: "2", backed: 1 })]), /3 of 6 back them/);
  /* One unchecked beat and the claim is withdrawn, not averaged. */
  assert.match(page([b({ id: "1", backed: 2 }), b({ id: "2", backed: null })]), /6 moments/);
  /* An outside beat is never searched, so it cannot make the rest unchecked. */
  assert.match(
    page([b({ id: "1", backed: 2 }), b({ id: "2", role: "outside", found: 0, backed: null })]),
    /2 of 3 back them/,
  );
});

/* ── The store ──────────────────────────────────────────────────────────── */

test("the coverage survives a reload, and null survives as null", async () => {
  /*
   * The whole point of storing it: a beat marked thin on the page has to
   * still be thin after a refresh. And a zero written where nobody checked
   * would mark a beat as a hole because a model call did not answer.
   *
   * Against the real DDL, including the columns added after the fact —
   * `backed` is one of them, and a fixture built from the CREATE alone
   * answers "no such column" from inside whatever is really being tested.
   */
  const SCHEMA = readFileSync(join(import.meta.dirname, "..", "migrations", "schema.sql"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const d = new DatabaseSync(":memory:");
  /* v2_projects because plans references it, and node:sqlite enforces
     foreign keys. */
  for (const name of ["v2_users", "sources", "v2_projects", "plans", "plan_beats"]) {
    const ddl = SCHEMA.split(";").find((x) =>
      new RegExp(`create table if not exists ${name}\\s*\\(`, "i").test(x),
    );
    assert.ok(ddl, `migrations/schema.sql has no ${name} — run \`npm run schema\``);
    d.exec(ddl + ";");
    for (const m of SCHEMA.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+) .*?;/gi)) {
      if (m[1].toLowerCase() !== name) continue;
      /*
       * The same PRAGMA guard ensureV2Schema uses, for the same reason.
       *
       * A column lives in BOTH the CREATE and ADDED_COLUMNS on purpose —
       * there is no migration runner, so a database that already has the
       * table only ever gains it through the ALTER. Replaying the ALTER
       * against a table that was just created with the column fails on
       * "duplicate column name", and that is a bug in the fixture rather
       * than in the schema: `renders.lufs` broke four tests this way, and
       * `rules.params` would have, had `rules` been in this list.
       */
      const has = d.prepare(`PRAGMA table_info(${name})`).all().some((c) => c.name === m[2]);
      if (!has) d.exec(m[0]);
    }
  }
  d.prepare("INSERT INTO v2_users (id,email,created_at) VALUES ('u1','a@b.c',1)").run();
  d.prepare("INSERT INTO plans (id,user_id,topic,claim,state,created_at) VALUES ('p1','u1','t','c','beats',1)").run();
  for (const [id, idx] of [["b1", 0], ["b2", 1]] as Array<[string, number]>) {
    d.prepare(
      "INSERT INTO plan_beats (id,plan_id,idx,role,name,need,kept) VALUES (?,?,?,'subject','n','n',1)",
    ).run(id, "p1", idx);
  }

  const db = fakeD1(d) as unknown as D1Database;
  await setFound(
    db,
    "p1",
    new Map([
      ["b1", { ids: ["c1", "c2", "c3"], backed: 1 }],
      ["b2", { ids: ["c4", "c5"], backed: null }],
    ]),
  );

  const plan = await getPlan(db, "p1", "u1");
  assert.equal(plan?.beats[0].backed, 1);
  assert.equal(plan?.beats[1].backed, null, "nobody checked is not nobody backed it");
  assert.deepEqual(plan?.beats[0].found, ["c1", "c2", "c3"]);
  assert.equal(plan?.state, "found");
});

/* ── The door in ────────────────────────────────────────────────────────── */

/**
 * /plan/:id WAS REACHABLE FROM NOWHERE.
 *
 * The whole flow was built and tested and nothing in the product pointed at
 * it: no href in src/ui/ contained /plan/, and POST /api/plans had no caller
 * anywhere in src/. A sentence asking for a video that argues something went
 * to assembleFromLibrary instead and was cut before anyone had agreed what it
 * was saying.
 *
 * The prototype puts the door in /api/begin's no-video branch and tests the
 * sentence before anything else happens:
 *
 *   if (/essay|video about|argue|make the case|explain|plan it/.test(L))
 *     { this.startPlan(t); return; }
 *
 * This reads the shipped source rather than driving a model, for the reason
 * test/intent-dispatch.test.ts gives about the same route: the thing that was
 * wrong was which arm the code took, and that is visible in the code.
 */
const beginSource = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");

test("a sentence that reads as an essay starts a plan, and lands on it", () => {
  const branch = beginSource.slice(beginSource.indexOf('app.post("/api/begin"'));
  const body = branch.slice(0, branch.indexOf("const src = await getSource"));

  assert.match(body, /readIntent\(brief\) === "essay"/, "the sentence is read before anything is made");
  assert.match(
    body,
    /readIntent\(brief\) === "essay"[\s\S]{0,900}createPlan\(/,
    "an essay sentence creates a plan",
  );
  assert.match(
    body,
    /createPlan\([\s\S]{0,400}href: `\/plan\/\$\{planId\}`/,
    "and the user lands on the plan, which is the page nothing linked to",
  );

  /*
   * Before the assembly, not after it. The order IS the behaviour: running the
   * assembly first spends retrieval over the whole library and produces a cut
   * of an argument nobody has agreed to.
   *
   * Anchored on the CALL rather than the name. The first version searched for
   * "assembleFromLibrary" and found it in the comment above the branch, which
   * explains what the old behaviour was — so the assertion compared a line of
   * prose against the code and went red for the wrong reason.
   */
  assert.ok(
    body.indexOf('readIntent(brief) === "essay"') < body.indexOf("await assembleFromLibrary("),
    "the plan is offered before the library is assembled",
  );

  /* And a sentence it cannot find an argument in still gets the assembly it
     would have had, rather than a refusal for work nobody asked for by name. */
  assert.match(body, /if \(draft\.beats\.length\)/, "no beats means fall through, not dead-end");
});
