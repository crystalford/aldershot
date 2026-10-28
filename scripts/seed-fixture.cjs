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
