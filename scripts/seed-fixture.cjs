#!/usr/bin/env node
/**
 * ONE TRANSCRIBED PROJECT, THE SAME ONE EVERY TIME.
 *
 * `scripts/check-editor.cjs` drives the real editor against a real project,
 * and it skips when the account it finds has no transcribed video to drive —
 * correctly, because the alternative is a page of failures about fixtures.
 * But that skip is what hid four wrong guarantees for weeks: the check was
 * green on a machine where it had never once run.
 *
 * `check.sh --strict` makes a skip a failure, which is only usable if a
 * strict run can be MADE to pass from nothing. That is this. It writes one
 * deterministic account state — a source with a transcript, and a project cut
 * from it — so a clean clone can run the full gate.
 *
 *   node scripts/seed-fixture.cjs        needs `npx wrangler dev` on 8787
 *
 * WHY IT WRITES SQL RATHER THAN USING THE PRODUCT. A transcript is the one
 * thing in this product that cannot be made without spending money: the real
 * path is upload → container → Transcribe, and invariant 5 charges for it. A
 * fixture that needed a paid call would be a fixture nobody runs. So the
 * words are hand-written and inserted, and everything the fixture touches is
 * a row this file owns by id.
 *
 * LOCAL ONLY. It writes with `wrangler d1 execute --local` and there is no
 * code path here that passes `--remote`. Against a real database it would be
 * writing somebody's library.
 *
 * IDEMPOTENT. Every id is fixed and every write is INSERT OR REPLACE, so
 * running it twice leaves exactly one fixture and never deletes a row it does
 * not own — invariant 6 applies to a fixture seeder too.
 */
const { execFileSync } = require("node:child_process");
const { writeFileSync, readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const BASE = process.env.BASE || "http://localhost:8787";

/* Fixed ids, so this file owns exactly these rows and no others. The `fix-`
   prefix is the whole reason a re-run is safe. */
const SOURCE_ID = "fix-source-kitchen";
const PROJECT_ID = "fix-project-kitchen";

const SOURCE_TITLE = "The kitchen, eleven days";
/*
 * A NAME SOMEBODY TYPED, which is not decoration.
 *
 * `listProjects` filters on TOUCHED (src/projects.ts), and an edit whose title
 * equals its source's title counts as UNNAMED — not made yet, so not listed.
 * That is right: it stops every video you merely opened appearing in Projects.
 * But the first version of this fixture named the project after the source, so
 * the cut page rendered all 163 words and `/api/projects` did not list it at
 * all — and check-editor reads the LIST. The fixture would have seeded a
 * project the check could not find and reported success.
 *
 * Caught by this file verifying through the product rather than by reading
 * back its own INSERTs, which is the whole argument for doing it that way.
 */
const PROJECT_TITLE = "The kitchen — the eleven-day cut";

/**
 * THE TRANSCRIPT.
 *
 * Fourteen lines, which is the shape `design/one-take/footage.js` works on —
 * the sample cut is 8 of 14 moments. The words are plain and the timings are
 * regular; what matters is that there are enough of them (check-editor wants
 * more than 40 rendered words before it will trust a project) and that the
 * gaps between lines vary, because the pause rules have nothing to find in an
 * evenly-spaced transcript.
 */
const LINES = [
  "So the thing nobody tells you about moving house is the kitchen",
  "Everything else you can live out of a box for a week",
  "Um, but you cannot live out of a box when you want a cup of tea",
  "I had four mugs and no kettle for the first three days",
  "And I kept thinking, this is fine, this is temporary",
  "You know, it was not temporary, it was eleven days",
  "The kettle was in a box marked books, which is the other thing",
  "Label the boxes by room and not by what you think is inside",
  "Because what you think is inside is wrong by the second box",
  "I found the kettle looking for a passport",
  "The passport turned up in a saucepan a fortnight later",
  "So now I label everything twice and photograph the open box",
  "It takes an extra hour and it saves you the eleven days",
  "That is the whole lesson and it cost me one house move",
];

/* Line n starts at START_S + n*(spoken + gap). The gaps alternate so the
   pause rules have something to find; a flat cadence hides them. */
const GAPS_MS = [220, 180, 640, 240, 900, 200, 260, 1400, 210, 300, 180, 520, 240, 0];

function buildSegments() {
  let t = 1_200; // ms — a beat of room tone before the first word
  const segs = [];
  LINES.forEach((text, idx) => {
    const tokens = text.split(" ");
    /* 340ms a word is close to unhurried speech, and the exact figure does
       not matter: nothing asserts a duration, several things assert that one
       word ends before the next begins. */
    const per = 340;
    const words = tokens.map((w, i) => ({
      w,
      s: +((t + i * per) / 1000).toFixed(3),
      e: +((t + i * per + per - 40) / 1000).toFixed(3),
    }));
    const start_ms = Math.round(words[0].s * 1000);
    const end_ms = Math.round(words[words.length - 1].e * 1000);
    segs.push({ idx, start_ms, end_ms, text, words });
    t = end_ms + GAPS_MS[idx];
  });
  return segs;
}

const SEGMENTS = buildSegments();
const DURATION_S = Math.ceil(SEGMENTS[SEGMENTS.length - 1].end_ms / 1000) + 2;

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function d1(sql) {
  const file = join(tmpdir(), "aldershot-seed-" + process.pid + ".sql");
  writeFileSync(file, sql);
  /* No --remote, ever: see the header. */
  return execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file=" + file], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function d1Rows(command) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command=" + command], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  /* wrangler prints its banner before the JSON on some versions, so take from
     the first bracket rather than trusting the whole of stdout to parse. */
  const at = out.indexOf("[");
  return JSON.parse(out.slice(at))[0].results;
}

function devEmail() {
  if (process.env.DEV_LOGIN_EMAIL) return process.env.DEV_LOGIN_EMAIL;
  const vars = join(__dirname, "..", ".dev.vars");
  if (!existsSync(vars)) return null;
  const m = readFileSync(vars, "utf8").match(/^DEV_LOGIN_EMAIL=(.*)$/m);
  return m ? m[1].trim() : null;
}

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
    console.log("✘ refusing to seed against " + BASE + " — localhost only.");
    process.exit(1);
  }

  /*
   * THE USER ROW HAS TO EXIST FIRST, and the app is what creates it: the dev
   * sign-in makes it lazily on the first request. Asking the server for it is
   * also the only honest way to learn WHICH user the checks will run as.
   */
  try {
    await fetch(BASE + "/api/projects");
  } catch {
    console.log("✘ no dev server at " + BASE + ".");
    console.log("    Run `npx wrangler dev --port 8787 --enable-containers=false` first.");
    process.exit(1);
  }

  const email = devEmail();
  if (!email) {
    console.log("✘ no DEV_LOGIN_EMAIL in the environment or in .dev.vars.");
    console.log("    Without it every page is a 302 and there is no account to seed.");
    process.exit(1);
  }

  const users = d1Rows("SELECT id FROM v2_users WHERE email=" + q(email));
  if (!users.length) {
    console.log("✘ no user row for " + email + " yet.");
    console.log("    Open " + BASE + "/ once so the dev sign-in creates it, then re-run.");
    process.exit(1);
  }
  const userId = users[0].id;

  const now = Date.now();
  const sql = [];

  sql.push(
    `INSERT OR REPLACE INTO sources
       (id,user_id,title,filename,origin,r2_key,duration_s,width,height,transcript_state,created_at,deleted_at)
     VALUES (${q(SOURCE_ID)},${q(userId)},${q(SOURCE_TITLE)},${q("kitchen.mp4")},${q("upload")},
             ${q(`u/${userId}/sources/${SOURCE_ID}/original.mp4`)},${DURATION_S},1920,1080,${q("ready")},${now},NULL);`,
  );

  for (const s of SEGMENTS) {
    sql.push(
      `INSERT OR REPLACE INTO segments (id,source_id,idx,start_ms,end_ms,speaker,text,words)
       VALUES (${q(SOURCE_ID + ":" + s.idx)},${q(SOURCE_ID)},${s.idx},${s.start_ms},${s.end_ms},NULL,
               ${q(s.text)},${q(JSON.stringify(s.words))});`,
    );
  }

  sql.push(
    `INSERT OR REPLACE INTO v2_projects
       (id,user_id,title,kind,source_id,runtime_s,pct,created_at,updated_at,deleted_at)
     VALUES (${q(PROJECT_ID)},${q(userId)},${q(PROJECT_TITLE)},${q("cut")},${q(SOURCE_ID)},
             ${DURATION_S},100,${now},${now},NULL);`,
  );

  /*
   * ── A WORKED ACCOUNT, not just a transcribed one ─────────────────────
   *
   * Everything above makes a transcript and a project. That was enough to
   * drive the editor, and it left every surface that depends on a cut
   * somebody has ACTUALLY WORKED ON renderable only in its empty state —
   * which is how the whole rules pane, the conflicts panel, the cut notes,
   * the Footage tab's verdict badges, Shorts' Value band and the entire
   * Scout board came to be crawled, walked and screenshotted with nothing in
   * them.
   *
   * So the fixture now also carries scored moments, four rules that argue
   * with each other on purpose, a conversation, an unrecorded voice beat and
   * a finished Scout run. All hand-written, for the same reason the
   * transcript is: the real versions cost money, and a fixture nobody can
   * afford to run is a fixture nobody runs.
   */

  /*
   * MOMENTS, with the scorer's opinion on most of them.
   *
   * One unscored on purpose. `reads()` in src/shorts.ts omits the Value
   * dimension entirely when a moment was never rated — "absent rather than
   * guessed" — and that branch had nothing to render it from.
   */
  const MOMENTS = [
    { seg: 3, score: 88, why: "the admission the whole thing turns on", heat: 3 },
    { seg: 6, score: 81, why: "names the mistake plainly", heat: 2 },
    { seg: 5, score: 74, why: "the turn from excuse to fact", heat: 2 },
    { seg: 10, score: 62, why: "funny, and it carries the point", heat: 1 },
    { seg: 12, score: 55, why: "useful but it restates", heat: 1 },
    /* Never rated. Shorts must show Hook and Flow and NO Value for this one. */
    { seg: 13, score: null, why: null, heat: null },
  ];

  for (const m of MOMENTS) {
    const seg = SEGMENTS[m.seg];
    sql.push(
      `INSERT OR REPLACE INTO v2_clips
         (id,user_id,source_id,start_ms,end_ms,quote,why,score,heat,frame_r2_key,kept,origin,used_count,created_at,deleted_at)
       VALUES (${q("fix-clip-" + m.seg)},${q(userId)},${q(SOURCE_ID)},${seg.start_ms},${seg.end_ms},
               ${q(seg.text)},${m.why === null ? "NULL" : q(m.why)},${m.score === null ? "NULL" : m.score},
               ${m.heat === null ? "NULL" : m.heat},
               ${q(`u/${userId}/frames/${SOURCE_ID}/${m.seg}.jpg`)},1,${q("editor")},0,${now + m.seg},NULL);`,
    );
  }

  /*
   * FOUR RULES, AND TWO OF THEM DISAGREE ON PURPOSE.
   *
   * src/rules.ts records a `contest` whenever a keep rule and a drop rule
   * both match a moment, and until this fixture existed nothing had ever
   * rendered one: the conflicts panel, the gold edge on a contested block and
   * the "2 judgement calls" note were all built and tested against unit
   * fixtures alone.
   *
   * 01 keeps five of the six moments. 02 takes out the two that mention a
   * kettle. Both match by WORDS, which is the matcher's `saysAny` path, so
   * the overlap is a property of the transcript rather than of a list of ids
   * that would drift the moment the transcript changed.
   *
   * 04 is switched off, because an off rule renders struck through with its
   * knob to the left and that path had never been rendered by a crawl either.
   */
  const RULES = [
    {
      key: "r-keep",
      kind: "keep",
      on: 1,
      text: "Keep the parts where you are working something out.",
      params: { words: ["kettle", "boxes", "passport", "lesson", "temporary"] },
    },
    {
      key: "r-drop",
      kind: "drop",
      on: 1,
      text: "Take out the bits that only restate the kettle.",
      params: { words: ["kettle"] },
    },
    { key: "r-order", kind: "order", on: 1, text: "Run it one thread at a time.", ord: "strand" },
    {
      key: "r-off",
      kind: "drop",
      on: 0,
      text: "Lose the hedging.",
      params: { words: ["maybe", "sort of"] },
    },
  ];

  RULES.forEach((r, i) => {
    sql.push(
      `INSERT OR REPLACE INTO rules (id,project_id,key,idx,kind,on_,text,tag,clip_ids,ord,secs,params,hand,wins,created_at)
       VALUES (${q("fix-rule-" + r.key)},${q(PROJECT_ID)},${q(r.key)},${i},${q(r.kind)},${r.on},
               ${q(r.text)},NULL,NULL,${r.ord ? q(r.ord) : "NULL"},NULL,
               ${r.params ? q(JSON.stringify(r.params)) : "NULL"},0,0,${now});`,
    );
  });

  /* The conversation. Two turns, so the rail is not an empty box and the
     Show me / Undo controls have something to sit on. */
  const PASSES = [
    ["keep the parts where I'm working something out", "6 of 14 moments · 0:24 · one thread at a time · from 1 video"],
    ["take out the bits that only restate the kettle", "4 of 14 moments · 0:16 — 2 judgement calls"],
  ];
  PASSES.forEach(([instruction, result], i) => {
    sql.push(
      `INSERT OR REPLACE INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
       VALUES (${q("fix-pass-" + i)},${q(PROJECT_ID)},NULL,${i + 1},${q(instruction)},${q(result)},NULL,NULL,NULL,${now + i});`,
    );
  });

  /*
   * ONE BEAT TO CAMERA, UNRECORDED.
   *
   * So "0 of 1 recorded — next: …" renders — the cut note that counts what
   * you still owe — and so the recorder bar appears on a block at all. Both
   * were built and neither had ever been drawn by a crawl, because no fixture
   * had a voice beat in it.
   */
  sql.push(
    `INSERT OR REPLACE INTO beats (id,project_id,idx,kind,act,clip_id,text,struck,dur_ms,media_r2_key,recorded_at)
     VALUES (${q("fix-beat-vo")},${q(PROJECT_ID)},99,${q("vo")},NULL,NULL,
             ${q("What the eleven days actually cost — twelve seconds, you, to camera.")},NULL,12000,NULL,NULL);`,
  );

  /*
   * ── A FINISHED SCOUT RUN ──────────────────────────────────────────────
   *
   * src/ui/pages/board.ts is 510 lines and NOTHING HAS EVER RENDERED IT WITH
   * ROWS IN IT. It was tested as a function, it answered at an /api/ URL no
   * crawl reached until this week, and the only state anybody has ever seen
   * is its empty one — because a real run needs YouTube quota and a string of
   * model calls, which a fixture cannot spend.
   *
   * So the rows are written the way the transcript is. This does NOT prove an
   * adapter works or that the run loop terminates; the tests do that. What it
   * buys is that the board can finally be LOOKED AT, which is the only thing
   * that has ever found a defect on a surface in this repo.
   *
   * THE THREE VERDICTS ARE ALL PRESENT ON PURPOSE. A verified quote, a
   * paraphrase and a rejection have to read as three different things —
   * invariant 4 is that "nothing backs this" stays reachable — and a fixture
   * carrying only successes would make the board look right while hiding the
   * state that matters most.
   */
  const RUN_ID = "fix-scout-run";
  sql.push(
    `INSERT OR REPLACE INTO scout_runs (id,project_id,trigger,brief,status,stop_reason,rounds,spend_usd,model_versions_json,created_at,finished_at)
     VALUES (${q(RUN_ID)},${q(PROJECT_ID)},${q("ask")},${q("what moving house actually costs people")},
             ${q("done")},${q("knee_and_coverage")},2,0.42,NULL,${now - 3600_000},${now - 1800_000});`,
  );

  /* Three beats: one covered, one thin, one an honest gap. The board leads
     with the gaps, so a fixture with none of them would hide its first
     section. */
  const SBEATS = [
    { idx: 0, role: "subject", name: "The kettle in the wrong box", behaviour: "Says the kettle was in a box marked books", status: "covered", need: 2 },
    { idx: 1, role: "counter", name: "Moving is just logistics", behaviour: "Someone saying a move was genuinely nothing", status: "thin", need: 1 },
    { idx: 2, role: "outside", name: "The person who carried the boxes", behaviour: "A helper describing the day from outside it", status: "gap", need: 1 },
  ];
  for (const b of SBEATS) {
    sql.push(
      `INSERT OR REPLACE INTO scout_beats (id,run_id,project_id,plan_beat_id,idx,role,name,behaviour,inverts,need_min,counter_gap,status,queries_tried_json)
       VALUES (${q(RUN_ID + ":" + b.idx)},${q(RUN_ID)},${q(PROJECT_ID)},NULL,${b.idx},${q(b.role)},${q(b.name)},
               ${q(b.behaviour)},NULL,${b.need},0,${q(b.status)},NULL);`,
    );
  }

  /* Searches, including one REFUSED. "ok with results_n 0" and "we never
     looked" are completely different sentences to put in front of a person,
     and the quota row is the only thing that tells them apart. */
  const SEARCHES = [
    { beat: 0, family: "direct", query: "kettle box marked books moving", n: 6, outcome: "ok", fail: null },
    { beat: 0, family: "crowd", query: "moving house kettle reddit", n: 3, outcome: "ok", fail: null },
    { beat: 1, family: "counter", query: "moving house was easy no stress", n: 1, outcome: "ok", fail: null },
    { beat: 2, family: "direct", query: "helped a friend move interview", n: 0, outcome: "quota_exhausted", fail: "out of units for today" },
  ];
  SEARCHES.forEach((x, i) => {
    sql.push(
      `INSERT OR REPLACE INTO scout_searches (id,run_id,beat_id,family,adapter,query,hyde,issued_at,results_n,new_verified_n,quota_units,cost_usd,outcome,fail_reason)
       VALUES (${q("fix-search-" + i)},${q(RUN_ID)},${q(RUN_ID + ":" + x.beat)},${q(x.family)},${q("youtube")},
               ${q(x.query)},NULL,${now - 3000_000 + i * 1000},${x.n},0,100,0.105,${q(x.outcome)},
               ${x.fail === null ? "NULL" : q(x.fail)});`,
    );
  });

  /* Two sources found. One read, one link-only — invariant 9 is that Scout
     finds and LINKS, and the board has to show the difference. */
  const SSOURCES = [
    { id: "fix-ssrc-1", ext: "vid_moving_1", title: "We moved house and it broke us", channel: "Two Rooms", transcript: "native", scanned: 1, yield: 2 },
    { id: "fix-ssrc-2", ext: "vid_moving_2", title: "Moving day, start to finish", channel: "Quiet Hours", transcript: "none", scanned: 0, yield: 0 },
  ];
  for (const x of SSOURCES) {
    sql.push(
      `INSERT OR REPLACE INTO scout_sources (id,run_id,adapter,external_id,url,title,channel,published_at,duration_s,kind,transcript,transcript_url,licence,triage_score,scanned,yield_n,dead_end,fetched_at,expires_at)
       VALUES (${q(x.id)},${q(RUN_ID)},${q("youtube")},${q(x.ext)},${q("https://www.youtube.com/watch?v=" + x.ext)},
               ${q(x.title)},${q(x.channel)},${now - 90 * 86400_000},1840,${q("video")},${q(x.transcript)},NULL,NULL,0.82,
               ${x.scanned},${x.yield},0,${now - 2900_000},NULL);`,
    );
  }

  /*
   * THE LEDGER: one verified, one paraphrase, one rejection.
   *
   * verified_at is set on all three, because the column means "the verifier
   * LOOKED" and not "the verifier agreed" — a rejected row that has been
   * checked and one that has not are different states, and conflating them is
   * the bug that made every Scout find a permanent rejection.
   */
  const LEDGER = [
    { id: "fix-led-1", beat: 0, verify: "verified", score: 1.0, quote: "the kettle was in the box marked books, obviously", t: 412 },
    { id: "fix-led-2", beat: 0, verify: "paraphrase", score: 0.71, quote: "the kettle ended up with the books somehow", t: 905 },
    { id: "fix-led-3", beat: 1, verify: "rejected", score: 0.12, quote: "moving was the easiest week of my life", t: 61 },
  ];
  for (const x of LEDGER) {
    sql.push(
      `INSERT OR REPLACE INTO scout_ledger (id,run_id,beat_id,role,source_id,quote_exact,quote_norm,word_span_json,t_start_s,t_end_s,context_before,context_after,found_by_family,verify,match_score,crowd_signals_n,original_of,is_compilation_only,model_version,verified_at,created_at)
       VALUES (${q(x.id)},${q(RUN_ID)},${q(RUN_ID + ":" + x.beat)},${q(x.beat === 1 ? "counter" : "subject")},
               ${q("fix-ssrc-1")},${q(x.quote)},${q(x.quote.toLowerCase())},${q(JSON.stringify({ startWord: 40, endWord: 48 }))},
               ${x.t},${x.t + 6},NULL,NULL,NULL,${q(x.verify)},${x.score},
               ${x.verify === "verified" ? 2 : 0},NULL,0,NULL,${now - 2000_000},${now - 2100_000});`,
    );
  }

  /* Where viewers already pointed at it. The lag correction is the point:
     somebody types the time they NOTICED, which is after it happened. */
  sql.push(
    `INSERT OR REPLACE INTO scout_crowd (id,source_id,kind,t_s,lag_corrected_t_s,weight,text)
     VALUES (${q("fix-crowd-1")},${q("fix-ssrc-1")},${q("comment")},418,409,1.0,${q("6:58 the box marked books 😭")});`,
  );

  d1(sql.join("\n"));
  console.log("  seeded " + SEGMENTS.length + " lines, " + SEGMENTS.reduce((n, s) => n + s.words.length, 0) + " words");

  /*
   * NOW PROVE IT, through the product rather than by reading back the rows we
   * just wrote. A seeder that asserts its own INSERTs tells you the database
   * works; what the gate needs to know is whether the EDITOR can see this.
   * check-editor's own bar is more than 40 rendered words on the cut page, so
   * that is the bar here.
   */
  const html = await (await fetch(BASE + "/p/" + PROJECT_ID + "/cut")).text();
  const words = (html.match(/class="w"/g) || []).length;
  const ok = words > 40;
  console.log((ok ? "  ✓ " : "  ✗ ") + PROJECT_ID + " renders " + words + " words (check-editor needs > 40)");
  if (!ok) {
    console.log("    The rows are in but the cut page does not show them — read the page, not this script.");
    process.exit(1);
  }

  /*
   * AND THE WORKED-ON HALF, each proved through a PAGE.
   *
   * Reading these back out of D1 would prove the INSERTs ran. What has to be
   * true is that the product renders them — which is the whole reason this
   * fixture exists, and which is how the first version of it discovered that
   * a named project did not appear in Projects at all.
   */
  const cut = await (await fetch(BASE + "/p/" + PROJECT_ID + "/cut")).text();
  const want = [
    ["the rules pane is numbered", /THE RULES/],
    ["four rules render", /rule-toggle/],
    ["two rules disagree, and it says so", /disagree on 2 moments/],
    ["the contested blocks carry the mark", /data-contested="1"/],
    ["the cut counts the judgement calls", /2 judgement calls/],
    ["a beat is still to record", /0 of 1 recorded/],
    ["the conversation has turns", /class="turn"/],
  ];
  let bad = 0;
  for (const [name, re] of want) {
    const ok = re.test(cut);
    if (!ok) bad += 1;
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }

  const board = await (await fetch(BASE + "/p/" + PROJECT_ID + "/scout")).text();
  for (const [name, re] of [
    ["the Scout board has rows", /the box marked books/],
    ["and shows the gap it did not fill", /gap|Gap/],
  ]) {
    const ok = re.test(board);
    if (!ok) bad += 1;
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }

  if (bad) {
    console.log("\n    " + bad + " of the worked-on fixture did not reach the page.");
    console.log("    Read the page, not this script.");
    process.exit(1);
  }

  const { projects } = await (await fetch(BASE + "/api/projects")).json();
  const listed = (projects || []).find((p) => p.id === PROJECT_ID);
  console.log(
    (listed && listed.source_id ? "  ✓ " : "  ✗ ") +
      "listed in /api/projects with a source of its own" +
      (listed && listed.source_id ? "" : " — check-editor skips projects without one"),
  );
  if (!listed || !listed.source_id) process.exit(1);

  console.log("\nFIXTURE READY — `npm run check -- --strict` can run the editor now.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
