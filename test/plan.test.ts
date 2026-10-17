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
   * is Scout's job, and Scout is not built. Searching their own library for
   * it would return their own voice and label it somebody else's — which is
   * the one failure a product built on receipts cannot have.
   */
  const asked: string[] = [];
  const found = await findForBeats(
    [
      { id: "b1", role: "subject" as Role, need: "every plan is a plan to be elsewhere" },
      { id: "b2", role: "outside" as Role, need: "someone else who made the same trade" },
    ],
    async (need) => {
      asked.push(need);
      return ["c1", "c2"];
    },
  );

  assert.deepEqual(asked, ["every plan is a plan to be elsewhere"], "the outside beat is never searched");
  assert.deepEqual(found[0], { beatId: "b1", clipIds: ["c1", "c2"], thin: false, gap: null });
  assert.equal(found[1].clipIds.length, 0);
  assert.match(found[1].gap ?? "", /isn't yours/);
  assert.equal(found[1].thin, true);
});

test("a beat that finds little is marked thin, never padded", async () => {
  /* A hole in the argument is worth showing. Widening the search until
     something turns up fills the beat with footage that does not meet it. */
  const found = await findForBeats(
    [
      { id: "a", role: "subject" as Role, need: "x" },
      { id: "b", role: "subject" as Role, need: "y" },
    ],
    async (need) => (need === "x" ? ["c1"] : ["c1", "c2", "c3"]),
  );
  assert.equal(found[0].thin, true, "one moment is thin");
  assert.equal(found[1].thin, false);
  assert.equal(THIN_BELOW, 2, "the threshold is the whole rule; changing it re-marks every plan");
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
      { id: "b1", role: "subject", name: "The archaeology", need: "every plan is elsewhere", kept: true, found: 0, gap: null },
      { id: "b2", role: "counter", name: "The deliberation defence", need: "the case for staying", kept: true, found: 0, gap: null },
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
      { id: "b1", role: "subject", name: "a", need: "n", kept: true, found: 0, gap: null },
      { id: "b2", role: "counter", name: "b", need: "n", kept: false, found: 0, gap: null },
      { id: "b3", role: "outside", name: "c", need: "n", kept: true, found: 0, gap: "a voice that isn't yours" },
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
  const src = readFileSync(join(import.meta.dirname, "..", "src", "index.ts"), "utf8");
  assert.match(
    src,
    /PAST THE STOP[\s\S]{0,2000}?out\.how === "recent" \? \[\] :/,
    "a beat's need is a search, not a brief",
  );
  assert.match(
    src,
    /PAST THE STOP[\s\S]{0,1200}?plan\.beats\.filter\(\(x\) => x\.kept\)/,
    "and only kept beats are searched",
  );
});
