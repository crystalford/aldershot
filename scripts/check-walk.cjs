#!/usr/bin/env node
/**
 * walk.cjs as a GATE STAGE, which means it has to skip rather than fail when
 * there is no dev server.
 *
 * scripts/walk.cjs is a report a person reads: it prints every surface, the
 * controls on it and every error, and it is run by hand when something looks
 * wrong. This runs it for the gate and translates the outcome into the three
 * answers check.sh understands — passed, failed, or 78 for "could not run".
 *
 * A wrapper rather than an argument to walk.cjs, because the two have
 * genuinely different jobs: a report that exits 78 is confusing to read by
 * hand, and a gate stage that prints 300 lines of inventory on a green run is
 * noise. The wrapper keeps walk.cjs's output for a failure and summarises it
 * otherwise.
 */
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const BASE = process.env.BASE || "http://localhost:8787";

(async () => {
  try {
    await fetch(BASE + "/api/health");
  } catch {
    console.log("⚠ walk — SKIPPED: no dev server at " + BASE + ".");
    console.log("    Run `npx wrangler dev --local --port 8787 --enable-containers=false` and re-run.");
    process.exit(78);
  }

  const run = spawnSync("node", [join(__dirname, "walk.cjs")], { encoding: "utf8" });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  if (run.status !== 0) {
    /* The whole report, because a failure is the one time every line of it is
       worth reading. */
    console.log(out.trimEnd());
    process.exit(1);
  }

  /* On a green run, the summary and nothing else. */
  const surfaces = (out.match(/^\s{3}\S.*\d+ controls$/gm) || []).length;
  const tolerated = (out.match(/^\s{3}404 GET \/media\//gm) || []).length;
  console.log(
    "✔ walk — " + surfaces + " surfaces walked, every one answered, nothing threw" +
      (tolerated ? " (" + tolerated + " fixture media object(s) absent, which is the fixture)" : ""),
  );

  /*
   * AND THE SAME WALK AS SOMEBODY WHO JUST SIGNED UP.
   *
   * Every stage above it runs as an account with footage already in it,
   * because the dev sign-in makes one user and the seeder fills it. The
   * first thing a stranger sees was the one path nothing drove, and the
   * first drive of it found the room claiming to have read a video whose
   * transcript had failed.
   *
   * It needs the empty account, which seed-fixture.cjs creates and empties.
   * No account, no stage — 78, like every other thing here that cannot run
   * rather than has run and failed.
   */
  const fresh = spawnSync("node", [join(__dirname, "walk.cjs"), "--fresh"], { encoding: "utf8" });
  const fout = `${fresh.stdout ?? ""}${fresh.stderr ?? ""}`;
  if (/could not sign in as the empty account/.test(fout)) {
    console.log("⚠ first run — SKIPPED: no empty fixture account.");
    console.log("    Run `node scripts/seed-fixture.cjs` and re-run.");
    process.exit(78);
  }
  if (fresh.status !== 0) {
    console.log(fout.trimEnd());
    process.exit(1);
  }
  const empties = (fout.match(/^\s{3}says: /gm) || []).length;
  /* What actually happened to the upload, in walk.cjs's own words — it is
     "uploaded" on a clean machine and "refused by the hourly limit" on one
     that has run this twenty times in an hour, and claiming the first when
     the second happened is the summary lying about its own run. */
  const how = (fout.match(/signed up, looked around, ([^;]+);/) || [])[1] || "ran";
  console.log(
    "✔ first run — " + how + "; " + empties + " empty surfaces, every one saying what to do next",
  );
})();
