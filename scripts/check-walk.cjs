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
    console.log("    Run `npx wrangler dev --port 8787 --enable-containers=false` and re-run.");
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
})();
