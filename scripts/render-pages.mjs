/**
 * The pages that are pure functions, rendered with no server.
 *
 * The landing site, the sign-in confirmation and the public receipts page
 * take plain data and return a document — no database, no request, no
 * bindings. So their copy can be checked on any machine, and until now it
 * was only checked on one with a dev server running. Two red CI runs came
 * of that.
 *
 * Prints a JSON array of { label, html }. scripts/check-fidelity.cjs's
 * `copy` rule reads it; nothing else should.
 */
import { renderLanding, renderConfirm, renderSignIn } from "../src/ui/pages/landing.ts";
import { receiptsHtml, receiptsPage } from "../src/receipts.ts";
import { renderCut } from "../src/ui/pages/cut.ts";
import { renderSettings } from "../src/ui/pages/settings.ts";
import { renderSource } from "../src/ui/pages/source.ts";
import { exportPanel } from "../src/ui/pages/export.ts";
import { renderPlan } from "../src/ui/pages/plan.ts";
import { renderBoard } from "../src/ui/pages/board.ts";

/*
 * A CUT, MADE UP, FOR ITS COPY ONLY.
 *
 * renderCut is a pure function of its data too, so the editor's wording can
 * be checked here. What it CANNOT check is that the data is right — that
 * needs the crawl, which `strings` still owns. This fixture exists to make
 * the sentences reachable, and it is deliberately shaped to reach the
 * branches a crawl does not: Footage's Videos tab is a query parameter, and
 * its narrowed state needs a project somebody has narrowed.
 *
 * Nothing here is asserted as true of the product. If a branch is missing a
 * fixture the copy in it is simply unchecked here, exactly as it was before.
 */
const block = {
  id: "b:1",
  origin: "footage",
  start_ms: 0,
  end_ms: 6_000,
  text: "a line of it",
  words: [],
  struck: false,
  score: null,
  why: null,
  label: null,
  mediaKey: null,
  previewKey: null,
  voiceKey: null,
};

const cutData = (over = {}) => ({
  projectId: "p1",
  title: "whether to leave",
  sourceId: "a",
  sourceTitle: "The kitchen",
  sourceKey: null,
  posterKey: null,
  view: "footage",
  blocks: [block],
  beats: [],
  cuts: [],
  windowSize: 60,
  keptCount: 1,
  runtimeMs: 6_000,
  cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
  renders: [],
  passes: [],
  rules: [],
  addable: [],
  moments: [
    { id: "m1", quote: "a line", source_title: "a", in: true, note: "in · rule 01", sourceId: "a" },
    { id: "m2", quote: "another", source_title: "b", in: false, note: "out · rule 02 · click to keep", sourceId: "b" },
  ],
  cutSources: [
    { id: "a", title: "The kitchen", duration_s: 120 },
    { id: "b", title: "The van", duration_s: 60 },
  ],
  sources: [],
  projects: [
    { id: "p1", title: "whether to leave", runtime_s: 6, poster_r2_key: null, updated_at: 1 },
    { id: "p2", title: "the shorts", runtime_s: null, poster_r2_key: null, updated_at: 2 },
  ],
  job: null,
  blockRule: {},
  cutLine: "0:06 · 1 block",
  ...over,
});

/*
 * A READ VIDEO, with and without an edit made from it.
 *
 * The second state is the one CI found by accident: the fixture grew a
 * second video, the crawl picked it, and `/sources/:id` rendered a sentence
 * no browser had ever shown — "Nothing cut from this yet." The first source
 * has a project, so the empty half of that page was unreachable on every
 * machine that had ever run the gate.
 */
const sourceData = (over = {}) => ({
  source: {
    id: "s1",
    title: "The van, and what would not fit",
    filename: "van.mp4",
    duration_s: 60,
    transcript_state: "ready",
    poster_r2_key: null,
    created_at: 1,
    r2_key: "u/u1/sources/s1/original.mp4",
    proxy_r2_key: null,
    width: 1920,
    height: 1080,
  },
  segments: [
    { id: "s1:0", source_id: "s1", idx: 0, start_ms: 0, end_ms: 2_000, speaker: null, text: "a line of it", words: "[]" },
  ],
  job: null,
  edits: [],
  ...over,
});

const out = [
  {
    label: "renderLanding",
    html: renderLanding({ google: false, error: null, sentTo: null, devLink: null }),
  },
  {
    /* With Google configured and a link just sent — the two branches that
       add copy of their own. */
    label: "renderLanding (sent, google)",
    html: renderLanding({
      google: true,
      error: null,
      sentTo: "someone@example.com",
      devLink: null,
    }),
  },
  { label: "renderConfirm", html: renderConfirm("a-token") },
  {
    /*
     * THE SIGN-IN PAGE, in the state the live site is actually in.
     *
     * google:false is production — the two Google secrets are unset, so the
     * button and the "or use your email" line do not render and the page is
     * the email box alone. Checking only the google:true shape would check a
     * page nobody is being served.
     */
    label: "renderSignIn (email only, as deployed)",
    html: renderSignIn({ google: false, error: null, sentTo: null, devLink: null }),
  },
  {
    label: "renderSignIn (google configured)",
    html: renderSignIn({ google: true, error: null, sentTo: null, devLink: null }),
  },
  {
    /* The refusal a person meets today: delivery is not configured, said on
       the page they asked from rather than on the marketing page. */
    label: "renderSignIn (delivery not configured)",
    html: renderSignIn({ google: false, error: "nomail", sentTo: null, devLink: null }),
  },
  {
    /* Footage's three tabs, and the narrowed state of the first — none of
       which a crawl of `/p/:id/footage` has ever rendered. */
    label: "renderCut (footage · videos)",
    html: renderCut(cutData({ footageTab: "videos" })),
  },
  {
    label: "renderCut (footage · videos, narrowed)",
    html: renderCut(cutData({ footageTab: "videos", onlySourceId: "b" })),
  },
  { label: "renderCut (footage · made)", html: renderCut(cutData({ footageTab: "made" })) },
  {
    /*
     * A READ VIDEO WITH NOTHING CUT FROM IT. The state CI found by accident:
     * the fixture grew a second video, the crawl picked it, and
     * `/sources/:id` rendered a sentence no browser had ever shown. The
     * first source has a project, so the empty half of that page was
     * unreachable on every machine that had ever run the gate.
     */
    label: "renderSource (read, nothing cut from it)",
    html: renderSource(sourceData()),
  },
  {
    label: "renderSource (read, one edit)",
    html: renderSource(
      sourceData({
        edits: [{ id: "p1", title: "whether to leave", brief: "tighten it", cuts: "[]", updated_at: 2 }],
      }),
    ),
  },
  {
    /*
     * The Scout board with something verified, which is the only state the
     * revision control renders in — the question it asks is meaningless
     * against evidence that was never checked.
     */
    label: "renderBoard (something verified)",
    html: renderBoard({
      projectId: "p1",
      verifiedMoments: 4,
      crowdRows: 1,
      stopped: true,
      sourcesRead: 6,
      sourcesLinkOnly: 2,
      candidatesScanned: 30,
      label: "done",
      pct: 100,
      /* A beat, because renderBoard returns the "Nothing yet" branch
         without one — the first fixture had none, the control never
         rendered, and `copy` printed green over copy it had not seen. */
      beats: [
        {
          id: "sb1",
          name: "the claim as made",
          role: "subject",
          behaviour: "somebody stating it on camera",
          needMin: 2,
          queriesTried: 4,
          rows: [],
        },
      ],
    }),
  },
  {
    /*
     * The plan at the one stop, which is where the slate is offered. Its
     * copy reached the gate only through the crawl, and the control that
     * asks for other angles renders in this one state alone.
     */
    label: "renderPlan (the one stop)",
    html: renderPlan({
      id: "p1",
      topic: "whether the story was written before the rockets were",
      claim: "the account came first and the engineering was fitted to it",
      state: "beats",
      projectId: null,
      beats: [
        { id: "b1", role: "subject", name: "the claim as made", need: "the line itself", kept: true, found: 0, backed: null, gap: null },
        { id: "b2", role: "counter", name: "the best case against", need: "somebody answering it", kept: true, found: 0, backed: null, gap: null },
      ],
    }),
  },
  {
    /*
     * THE PLAN PAST THE STOP, WITH A SECTION ITS AUTHOR WROTE.
     *
     * The fixture above is state "beats" with only drafted beats, so none of
     * the growth loop's copy renders in it: not the YOURS mark, not the
     * per-section find, not the advice about somebody's wording. `copy`
     * reported exactly one new string and would have printed green over five.
     * The same shape as every other false green in this file's history.
     */
    label: "renderPlan (found, with a section the author wrote)",
    html: renderPlan({
      id: "p1",
      topic: "whether the story was written before the rockets were",
      claim: "the account came first and the engineering was fitted to it",
      state: "found",
      projectId: null,
      beats: [
        { id: "b1", role: "subject", name: "the claim as made", need: "the line itself", kept: true, found: 3, backed: 2, gap: null },
        {
          /* Theirs, empty, and worded in a way the stoplist has something to
             say about — the three states the new controls depend on. */
          id: "b2",
          role: "subject",
          name: "orbital mechanics",
          need: "he wants to look competent about the numbers",
          kept: true,
          found: 0,
          backed: null,
          gap: null,
          byUser: true,
          advice: "wants to",
        },
      ],
    }),
  },
  {
    /*
     * The export panel, a pure function of a project id and a plan.
     *
     * Its wording about what the timeline file carries and what stays behind
     * is read at the one moment somebody decides to take an edit elsewhere,
     * and the only check that had ever seen it was the crawl. Both plans,
     * because the panel's controls differ by plan and a sentence that only
     * appears on one of them is a sentence checked on neither otherwise.
     */
    label: "exportPanel (free)",
    html: exportPanel("p1", "free"),
  },
  {
    label: "exportPanel (studio)",
    html: exportPanel("p1", "pro"),
  },
  {
    /* Settings on a free account with nothing connected — the first thing
       anybody sees there, and the page whose plan hints were wrong until
       today. */
    label: "renderSettings (free)",
    html: renderSettings({
      name: "Someone",
      email: "someone@example.com",
      plan: "free",
      isOwner: false,
      connections: [],
      meters: [],
      limit: { usd: 50, chargedUsd: 0 },
      billingReady: true,
      trash: [],
      cost: null,
      slo: null,
    }),
  },
  {
    /*
     * The owner's cost panel, with spend that bought nothing.
     *
     * Owner-only AND conditional on there being waste, so it renders for one
     * account in the world and only in a bad month — two conditions no crawl
     * can satisfy. The line it carries is the figure decision 38 commits the
     * business to absorbing.
     */
    label: "renderSettings (owner, a month with waste)",
    html: renderSettings({
      name: "Someone",
      email: "someone@example.com",
      plan: "pro",
      isOwner: true,
      connections: [],
      meters: [],
      limit: { usd: 50, chargedUsd: 0 },
      billingReady: true,
      trash: [],
      slo: null,
      cost: {
        lines: [{ label: "Transcribe + align", amount: 1.2, color: "#5EB8C9", note: "per source minute" }],
        total: 1.2,
        finished: 2,
        dayOfMonth: 9,
        cache: { rows: 4, hits: 7 },
        wasted: { cost: 0.42, count: 31 },
      },
    }),
  },
  {
    label: "renderSettings (studio, one bucket connected)",
    html: renderSettings({
      name: "Someone",
      email: "someone@example.com",
      plan: "pro",
      isOwner: false,
      connections: [{ id: "c1", bucket: "a-bucket", last_import_at: null }],
      meters: [],
      limit: { usd: 50, chargedUsd: 0 },
      billingReady: true,
      trash: [],
      cost: null,
      slo: null,
    }),
  },
  {
    /* And the two empty states, which need a cut with nothing attached and
       an account with one project. */
    label: "renderCut (footage · videos, none attached)",
    html: renderCut(cutData({ footageTab: "videos", cutSources: [], sources: [] })),
  },
  {
    label: "renderCut (footage · made, only project)",
    html: renderCut(cutData({ footageTab: "made", projects: [] })),
  },
  {
    /*
     * A CUT WITH VIDEOS IT COULD STILL TAKE.
     *
     * `addToCut` returns "" without `addable`, and every fixture here had it
     * empty, so its label had never been rendered by this file. CI's seed
     * attaches everything it creates, so the crawl had never rendered it
     * either. It was found by running the gate against a database that had
     * drifted across sessions — which is luck, not a check.
     */
    label: "renderCut (footage · moments, more to add)",
    html: renderCut(
      cutData({
        /* The MOMENTS tab, which is where addToCut renders — footageSurface
           sends "videos" to videosInCut and never calls it. The first version
           of this fixture said "videos", rendered no add row, and `copy`
           printed green over a page that did not contain the label it was
           added for. */
        footageTab: "moments",
        addable: [
          { id: "b", title: "The van" },
          { id: "c", title: "The kitchen, second pass" },
        ],
      }),
    ),
  },
  {
    label: "receiptsPage",
    html: receiptsHtml(
      receiptsPage({
        title: "A cut",
        claim: null,
        external: [],
        pictures: [],
      }),
    ),
  },
];

/*
 * HOW MANY PAGES THIS FILE IS SUPPOSED TO PRODUCE.
 *
 * Declared, so adding one is a deliberate two-line edit and a page that
 * silently fails to arrive is an error rather than a smaller list. Both of
 * those have happened: two entries were added by an edit whose anchor did not
 * match, and `copy` printed ALL CLEAR over a page list two short, because
 * there is no copy to find in a page that was not rendered.
 *
 * The fidelity rule used to count `label:` in this file instead, which is
 * fragile for an obvious reason — the fixtures below have labels of their own,
 * and the count was wrong twice before this replaced it.
 */
const EXPECTED = 23;
if (out.length !== EXPECTED) {
  console.error(
    `render-pages: EXPECTED ${EXPECTED} pages and built ${out.length}. ` +
      `Either a page was not added where it was meant to be, or one of them threw. ` +
      `Built: ${out.map((p) => p.label).join(", ")}`,
  );
  process.exit(1);
}

/* Nothing may be empty either: a renderer that returns "" contributes no copy
   and would otherwise pass as a page that was checked. */
const empty = out.filter((p) => !p.html || p.html.length < 200);
if (empty.length) {
  console.error(`render-pages: these rendered nothing: ${empty.map((p) => p.label).join(", ")}`);
  process.exit(1);
}

console.log(JSON.stringify(out));
