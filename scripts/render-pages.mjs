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
import { renderLanding, renderConfirm } from "../src/ui/pages/landing.ts";
import { receiptsHtml, receiptsPage } from "../src/receipts.ts";
import { renderCut } from "../src/ui/pages/cut.ts";

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

console.log(JSON.stringify(out));
