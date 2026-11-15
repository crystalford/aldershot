/**
 * CUTTING FROM ONE OF YOUR VIDEOS, AND PUTTING THE REST BACK.
 *
 * The engine has filtered the candidate pool by source since the scope
 * column existed — `inScope` in src/assemble.ts, tested next door. There was
 * no way to ask for it: the only thing that ever wrote a scope was attach,
 * which APPENDS, so a cut could grow and never narrow.
 *
 * The failure this guards is not "the narrowing does not work". It is the
 * obvious implementation: writing one id into `scope`, which loses the list
 * of what the cut is made of and makes the control one-way. Invariant 6 is
 * that nothing is deleted, and a button that quietly throws away four
 * attachments is a delete with a friendly label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { attachedScope, scopeOf } from "../src/projects.ts";
import { renderCut, type CutData } from "../src/ui/pages/cut.ts";

const scoped = (ids: string[], only: string | null = null) => ({
  scope: JSON.stringify(ids),
  only_source_id: only,
});

test("with no narrowing, the cut is made of everything attached", () => {
  const p = scoped(["a", "b", "c"]);
  assert.deepEqual(scopeOf(p), ["a", "b", "c"]);
  assert.deepEqual(attachedScope(p), ["a", "b", "c"]);
});

test("a narrowing is what the engine cuts from, and attachment is untouched", () => {
  const p = scoped(["a", "b", "c"], "b");
  assert.deepEqual(scopeOf(p), ["b"]);
  /* The whole point: the record of what this cut is made of has not moved,
     so clearing the narrowing restores it without re-attaching anything. */
  assert.deepEqual(attachedScope(p), ["a", "b", "c"]);
  assert.deepEqual(scopeOf(scoped(["a", "b", "c"], null)), ["a", "b", "c"]);
});

test("a narrowing to a video that is not attached is ignored", () => {
  /*
   * It cannot happen through the route, which checks. A stale row after a
   * detach would otherwise cut from a video the project does not have —
   * producing an empty cut that looks like an engine fault.
   */
  assert.deepEqual(scopeOf(scoped(["a", "b"], "z")), ["a", "b"]);
});

test("a narrowing on a cut with no scope at all still narrows", () => {
  /* No scope means the whole library, and narrowing that to one video is
     exactly as meaningful as narrowing an attached set. */
  assert.deepEqual(scopeOf({ scope: null, only_source_id: "a" }), ["a"]);
  assert.equal(scopeOf({ scope: null, only_source_id: null }), null);
});

/* ── The tab that offers it ───────────────────────────────────────────── */

const base = (over: Partial<CutData> = {}): CutData =>
  ({
    projectId: "p1",
    title: "A cut",
    sourceId: "a",
    sourceTitle: "The kitchen",
    sourceKey: null,
    posterKey: null,
    view: "footage",
    footageTab: "videos",
    /* One block, because renderCut short-circuits a project with none:
       "This hasn't been transcribed yet". The Footage tab is behind that
       check, so a fixture with no blocks renders no tab at all. */
    blocks: [
      {
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
      },
    ],
    beats: [],
    cuts: [],
    windowSize: 60,
    keptCount: 0,
    runtimeMs: 0,
    cleanups: { fillers: { found: 0, savedMs: 0 }, pauses: { found: 0, savedMs: 0 } },
    renders: [],
    passes: [],
    rules: [],
    addable: [],
    moments: [],
    cutSources: [
      { id: "a", title: "The kitchen", duration_s: 120 },
      { id: "b", title: "The van", duration_s: 60 },
    ],
    sources: [],
    projects: [],
    job: null,
    blockRule: {},
    cutLine: "0:00",
    ...over,
  }) as unknown as CutData;

const moment = (id: string, sourceId: string, inCut: boolean) => ({
  id,
  quote: "a line",
  source_title: sourceId,
  in: inCut,
  note: inCut ? "in · rule 01" : "out · rule 02 · click to keep",
  sourceId,
});

test("each video says how many of its moments the rules are using", () => {
  const html = renderCut(
    base({
      moments: [
        moment("1", "a", true),
        moment("2", "a", true),
        moment("3", "a", false),
        moment("4", "b", false),
      ],
    }),
  );
  assert.match(html, /2 of 3 moments in this cut/);
  /*
   * THE ROW THIS TAB EXISTS FOR. A video attached and contributing nothing
   * is absent from the lettered chips, which list what the cut DRAWS ON — so
   * before this tab there was nowhere in the product that could tell you a
   * video you added is being ignored.
   */
  assert.match(html, /0 of 1 moment in this cut/);
});

test("a video with no moments at all is still listed", () => {
  const html = renderCut(base({ moments: [moment("1", "a", true)] }));
  assert.match(html, /0 of 0 moments in this cut/);
});

test("the control says which video the cut is narrowed to, and offers the way back", () => {
  const off = renderCut(base({ moments: [moment("1", "a", true)] }));
  assert.match(off, /class="only-source"[^>]*data-source="a"/);
  assert.ok(!/data-only/.test(off), "nothing is narrowed, so nothing claims to be");
  assert.match(off, /Press Only this to cut from one of them alone/);

  const on = renderCut(base({ onlySourceId: "b", moments: [moment("1", "a", true)] }));
  assert.match(on, /data-source="b" data-only/);
  assert.match(on, /The others are still attached/);
});

test("Footage's three tabs are all reachable, and the default is Highlights", () => {
  const html = renderCut(base({ footageTab: "videos" }));
  for (const tab of ["videos", "moments", "made"]) {
    assert.match(html, new RegExp(`/p/p1/footage\\?tab=${tab}`));
  }
  /* No tab in the URL is Highlights, which is what the tab showed before the
     other two existed — so an old link lands somewhere real. */
  const fallback = renderCut(base({ footageTab: undefined, moments: [moment("1", "a", false)] }));
  assert.match(fallback, /Every moment, through this project's rules/);
});

test("the crawl visits every one of the three tabs", () => {
  /*
   * scripts/surfaces.cjs reads the ProjFootTab union out of cut.ts. A tab
   * the crawl never visits is a tab no check has read a word of, which is
   * how ten surfaces in this product went unexamined for a month — and
   * these two are query parameters on a route the crawl already had, which
   * is the easiest kind to miss.
   */
  const surfaces = createRequire(import.meta.url)("../scripts/surfaces.cjs") as {
    enums(): { projFootTabs: string[] };
  };
  assert.deepEqual(surfaces.enums().projFootTabs, ["videos", "moments", "made"]);
});

test("the route and its client handler both exist, and nothing else writes the column", () => {
  const index = readFileSync("src/index.ts", "utf8");
  const client = readFileSync("src/ui/client.ts", "utf8");
  assert.match(index, /app\.post\("\/api\/projects\/:id\/only"/);
  assert.match(client, /\/only"/);

  /*
   * ATTACH MUST NOT READ THE NARROWED SCOPE. It appends, so reading the
   * narrowed set would write [the one video, the new one] into the project's
   * record of what it is made of and lose the rest — the exact delete this
   * whole design exists to avoid.
   */
  const attach = index.slice(index.indexOf('app.post("/api/projects/:id/attach"'));
  const upToBody = attach.slice(0, attach.indexOf("const next = ["));
  assert.ok(
    /attachedScope\(project\)/.test(upToBody),
    "attach must use attachedScope, not scopeOf",
  );
});
