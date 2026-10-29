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

/* The account with nothing in it. Fixed id so the drive can sign in as it
   without asking the database who it is. */
const EMPTY_USER = "fix-user-empty";
const EMPTY_EMAIL = "fix-empty@aldershot.test";

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
    console.log("    Run `npx wrangler dev --local --port 8787 --enable-containers=false` first.");
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

  /*
   * AND A SECOND ACCOUNT WITH NOTHING IN IT.
   *
   * Every check in this repo has only ever run against an account that
   * already has footage in it, because the dev sign-in makes exactly one
   * user and the seeder fills it. So the first thing anybody who signs up
   * will see — the room with no footage, the upload, the wait — is the one
   * path nothing has driven.
   *
   * It is a user row and nothing else, deliberately: the point is to meet
   * the product the way a stranger does. scripts/walk.cjs --fresh signs in
   * as it by minting the session cookie, which works because in development
   * the signing secret is a constant (src/auth.ts) and a cookie beats
   * DEV_LOGIN_EMAIL in currentUser.
   */
  sql.push(
    `INSERT OR REPLACE INTO v2_users (id,email,name,plan,spend_cap_usd,is_owner,created_at)
     VALUES (${q(EMPTY_USER)},${q(EMPTY_EMAIL)},${q("Nobody")},${q("free")},NULL,0,${now});`,
  );
  /*
   * AND IT IS EMPTIED EVERY RUN.
   *
   * The first-run drive uploads a file, which is the point of it — so after
   * one drive the empty account is not empty, and the second drive is a
   * walk of an account with a failed upload in it. An empty fixture that
   * stops being empty after one use is a fixture for one use.
   *
   * Hard DELETE rather than the product's soft one: invariant 6 is about
   * what a PERSON can lose, and nobody is attached to a 64KB file of
   * sevens. Scoped to this account, which owns nothing a person made.
   */
  sql.push(`DELETE FROM segments WHERE source_id IN (SELECT id FROM sources WHERE user_id=${q(EMPTY_USER)});`);
  sql.push(`DELETE FROM v2_clips WHERE user_id=${q(EMPTY_USER)};`);
  sql.push(`DELETE FROM jobs WHERE user_id=${q(EMPTY_USER)};`);
  sql.push(`DELETE FROM sources WHERE user_id=${q(EMPTY_USER)};`);

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
   * A PLAN, SO /plan/:id IS A PAGE ANY ACCOUNT CAN REACH.
   *
   * The `coverage` rule fails a route that renders a page the crawl could
   * not get to, and scripts/surfaces.cjs finds a plan by asking
   * /api/plans for one. There was never a plan in the fixture — so the
   * crawl only reached that page on a machine that happened to have an old
   * one lying around, which was the machine this was written on. CI said
   * "no plan in this account" and was right.
   *
   * It is the same fault as the archive's video count one commit ago: a
   * check resting on state the fixture does not create. The fixture creates
   * it now.
   *
   * `state: "beats"` is where the flow stops and shows you the beats before
   * anything is found — the one stop the build order asks for — so this is
   * the plan page at the moment it is worth looking at.
   */
  const PLAN_ID = "fix-plan-amazon";
  sql.push(
    `INSERT OR REPLACE INTO plans (id,user_id,topic,claim,state,project_id,created_at)
     VALUES (${q(PLAN_ID)},${q(userId)},
             ${q("Why the Amazon expedition did not turn back")},
             ${q("Orellana did not choose to go on — the river chose for him, and the record was written to make it look like a decision.")},
             ${q("beats")},NULL,${now});`,
  );
  sql.push(`DELETE FROM plan_beats WHERE plan_id=${q(PLAN_ID)};`);
  [
    ["subject", "The current took the choice away", "the moment the boat could not go back upstream"],
    ["counter", "They could have waited", "someone saying the camp could have held out longer"],
    ["outside", "What the chronicle says", "Carvajal's own account of the decision"],
  ].forEach(([role, name, need], i) => {
    sql.push(
      `INSERT OR REPLACE INTO plan_beats (id,plan_id,idx,role,name,need,kept,found)
       VALUES (${q("fix-beat-" + i)},${q(PLAN_ID)},${i},${q(role)},${q(name)},${q(need)},1,NULL);`,
    );
  });

  /*
   * TWO THREADS, NAMED IN THE SPEAKER'S OWN WORDS.
   *
   * Invariant 10 and src/threads.ts: a thread's name comes from the quotes,
   * not from a genre word. These are the two things this transcript is
   * actually about, and nothing had ever seeded one — so the archive
   * paragraph ("the threads running through the footage, and which one you
   * keep coming back to") had never rendered. The room fell back to the
   * COUNT, which is the exact failure CLAUDE.md names by name: "the archive
   * summary was a count where a paragraph goes".
   *
   * It also lights the thread chips above the project's Footage tab, which
   * only appear when there is more than one thread to choose between.
   */
  const THREADS = [
    /* Not the same size, on purpose: archiveSentence names the thread you
       come back to most only when one STRICTLY beats the second, and a tie
       would have left that clause — the one the paragraph exists for —
       unrendered again. */
    { key: "fix-thread-kettle", name: "the kettle", clips: [3, 5, 12, 13] },
    { key: "fix-thread-house", name: "whether to go back", clips: [6, 10] },
  ];
  /*
   * THE ONE TABLE INSERT OR REPLACE CANNOT KEEP IDEMPOTENT.
   *
   * v2_clip_threads is keyed on (clip_id, thread_id), so moving a clip from
   * one thread to another ADDS a row rather than replacing one, and the old
   * membership survives every re-run. It happened the first time this seed
   * was edited: a clip moved to "the kettle" and stayed in "whether to go
   * back" too, and the archive paragraph said 4 where the project's chip
   * said 3 — a count disagreeing with its list, which is the bug this file
   * exists to catch rather than cause.
   *
   * Scoped to the fixture's own clips, because the rule for everything here
   * is that a re-run touches nothing it does not own.
   */
  sql.push(
    `DELETE FROM v2_clip_threads WHERE thread_id IN (${THREADS.map((t) => q(t.key)).join(",")});`,
  );
  for (const t of THREADS) {
    sql.push(
      `INSERT OR REPLACE INTO v2_threads (id,user_id,name,summary,clip_count,created_at)
       VALUES (${q(t.key)},${q(userId)},${q(t.name)},NULL,${t.clips.length},${now});`,
    );
    for (const seg of t.clips) {
      sql.push(
        `INSERT OR REPLACE INTO v2_clip_threads (clip_id,thread_id,confidence)
         VALUES (${q("fix-clip-" + seg)},${q(t.key)},0.9);`,
      );
    }
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
    /*
     * 05 IS ON AND MATCHES NOTHING, which is its whole job.
     *
     * Nobody in this transcript mentions a sponsor. The pane renders a rule
     * like this identically to one holding the cut together, so the offer to
     * retire it — "Does nothing now — switch it off" — had no account in the
     * product that could produce it. Now one can.
     */
    {
      key: "r-dead",
      kind: "keep",
      on: 1,
      text: "Keep anything about the sponsor.",
      params: { words: ["sponsor", "patreon"] },
    },
  ];

  /*
   * AND ONE DECISION MADE BY HAND.
   *
   * A hand rule is how the engine makes "take this one out whatever the
   * rules say" survive a recompute, and it is the one rule shape the pane
   * draws differently: folded into "and 1 fix by hand" with an undo, rather
   * than given a number of its own. Nothing had ever rendered it.
   *
   * The key is what ruleKey() produces for the same decision, because the
   * undo posts to the MOMENT and the route finds the rule by recomputing
   * that key. A hand rule seeded under any other id would render an undo
   * that quietly did nothing.
   */
  const HAND_CLIP = "fix-clip-10";
  sql.push(
    `INSERT OR REPLACE INTO rules (id,project_id,key,idx,kind,on_,text,tag,clip_ids,ord,secs,params,hand,wins,created_at)
     VALUES (${q("fix-rule-hand")},${q(PROJECT_ID)},${q("r-drop-hand-" + HAND_CLIP)},${RULES.length},
             ${q("drop")},1,${q("Take this one out whatever the rules say.")},NULL,
             ${q(JSON.stringify([HAND_CLIP]))},NULL,NULL,NULL,1,0,${now});`,
  );

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
    [
      "and say what the call was, on the line itself",
      /Judgement call &mdash; rule 01 keeps it, rule 02 takes it out\. Rule 02 is winning\./,
    ],
    ["with both answers a press away", /class="judge-hand"[^>]*data-keep="0"/],
    ["the cut counts the judgement calls", /2 judgement calls/],
    ["a beat is still to record", /0 of 1 recorded/],
    ["the conversation has turns", /class="turn"/],
    ["a rule doing nothing offers to go off", /Does nothing now — switch it off/],
    ["the hand fix is folded, not numbered", /and 1 fix by hand/],
    ["and it can be undone", /class="fix-undo"[^>]*data-moment="fix-clip-10"/],
  ];

  /*
   * THE FOOTAGE TAB IS A SECOND PAGE, so it is a second fetch.
   *
   * Its rows are built by the same route and a different view, and the one
   * thing worth proving from outside is the sentence a unit test cannot see:
   * a moment nothing claims still offers the hand. It read "out · no rule
   * keeps it" and stopped, while the identical row above it said "click to
   * keep" — the same capability, offered on one row and not the other.
   */
  const footage = await (await fetch(BASE + "/p/" + PROJECT_ID + "/footage")).text();
  const room = await (await fetch(BASE + "/?tab=highlights")).text();
  const roomWant = [
    [
      /*
       * THE SHAPE OF THE SENTENCE, NOT A COUNT THIS FIXTURE DOES NOT OWN.
       *
       * This said "2 threads run through 2 videos", and the second 2 was not
       * the fixture's — it was a source left over from earlier work in the
       * account this was written in. CI has only what the seeder makes, so
       * it rendered "1 video" and the claim failed on a machine where
       * everything was correct.
       *
       * A fixture that is only deterministic on the machine it grew up on is
       * not a fixture. What it owns and can assert is the SHAPE: a paragraph
       * naming its two threads, in the speaker's own words. How many other
       * videos happen to be in the account is the account's business.
       */
      "the archive is a paragraph, not a count",
      /threads run through \d+ videos? — the kettle and whether to go back\./,
    ],
    /*
     * AND THE TWO SURFACES AGREE ABOUT IT. The room says the kettle is in 4
     * moments and the project's chip says "the kettle 4". They are counted in
     * different places from different queries, and a stale row in
     * v2_clip_threads made them disagree once already.
     */
    ["and it names the one you come back to most", /come back to most is the kettle, in 4 moments/],
  ];

  const footWant = [
    ["a moment nothing keeps still offers the hand", /no rule keeps it · click to keep/],
    ["the moments say where in the recording", /font-family:'IBM Plex Mono',monospace;color:[^"]*">0:\d\d</],
    ["the threads are chips with counts", />the kettle 4</],
  ];
  let bad = 0;
  for (const [name, re] of want) {
    const ok = re.test(cut);
    if (!ok) bad += 1;
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }
  for (const [name, re] of footWant) {
    const ok = re.test(footage);
    if (!ok) bad += 1;
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
  }
  for (const [name, re] of roomWant) {
    const ok = re.test(room);
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

  /*
   * THE PLAN PAGE, WHICH NOTHING COULD REACH WITHOUT ONE.
   *
   * scripts/surfaces.cjs finds a plan by asking /api/plans, and the
   * `coverage` rule fails a route that renders a page the crawl cannot get
   * to. The fixture never made a plan, so that page was only ever reached on
   * a machine with an old one lying around — this one. CI said "no plan in
   * this account" and was right.
   */
  const { plans } = await (await fetch(BASE + "/api/plans")).json();
  const planId = (plans || [])[0]?.id ?? null;
  const planPage = planId ? await (await fetch(BASE + "/plan/" + planId)).text() : "";
  for (const [name, ok] of [
    ["a plan exists for the crawl to reach", Boolean(planId)],
    ["and it stops on the beats", /The current took the choice away/.test(planPage)],
  ]) {
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
