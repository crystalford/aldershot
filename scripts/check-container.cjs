#!/usr/bin/env node
/**
 * Does the container start, and does every route still exist?
 *
 * This exists because of a near-miss. Removing one function took `readJson`,
 * `jsonError` and `extractFull` out with it — the deletion walked back to the
 * wrong doc comment. `node --check` passed, because those are runtime
 * references and not syntax. 434 tests passed. All nine fidelity checks
 * passed. The only thing that found it was starting the container by hand,
 * after the commit, and it would have broken transcription for every video.
 *
 * The `wired` check cannot see this either: those functions WERE referenced —
 * by callers that no longer existed. Every check in this repo proves things
 * are CONNECTED. None of them proved the process runs.
 *
 * So this starts the real server and asks every route a real question. It
 * deliberately does NO ffmpeg work: every request below answers instantly, so
 * this belongs in the always-on gate rather than beside check-render.cjs,
 * which needs ffmpeg, fixtures and a dev server.
 *
 *   node scripts/check-container.cjs
 *
 * Exits non-zero on any finding.
 */

const { spawn } = require("node:child_process");
const path = require("path");

const PORT = Number(process.env.CONTAINER_CHECK_PORT || 8079);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Nothing listens on port 1, so ffmpeg gives up on it immediately. */
const DEAD_URL = "http://127.0.0.1:1/none.mp4";

/* Every route the container serves, and what it must say when asked without
   any work to do. A route that has been deleted answers 404 and fails here. */
const ASKS = [
  {
    name: "POST /render with nothing to cut",
    go: () => post("/render", { cuts: [] }),
    want: (r) => r.status === 400 && /nothing to render/.test(r.body),
  },
  {
    name: "GET /render/status for an unknown id",
    go: () => fetch(`${BASE}/render/status?id=nope`).then(read),
    want: (r) => r.status === 404,
  },
  {
    name: "GET /render/result for an unknown id",
    go: () => fetch(`${BASE}/render/result?id=nope`).then(read),
    want: (r) => r.status === 404,
  },
  {
    name: "DELETE /render with nothing running",
    go: () => fetch(`${BASE}/render`, { method: "DELETE" }).then(read),
    want: (r) => r.status === 200,
  },
  {
    /*
     * The poster the proxy pass leaves behind, collected on the same instance.
     * Six of nine videos had none, because the only thing that ever made one
     * was the browser at upload time — and a 404 here is the difference
     * between a black rectangle and a picture.
     */
    name: "GET /poster for an unknown id",
    go: () => fetch(`${BASE}/poster?id=nope`).then(read),
    /* The BODY, not just the status. Asserting 404 alone passed while this
       route did not exist at all — the GET branch 404s anything it does not
       recognise, so "not found" and "no such endpoint" were the same answer.
       Only the handler says why. */
    want: (r) => r.status === 404 && /no poster for that id/.test(r.body),
  },
  {
    name: "POST with no url is refused before any work",
    go: () => post("/extract-full", {}),
    want: (r) => r.status === 400 && /missing url/.test(r.body),
  },

  /*
   * THE ROUTES THAT TAKE A URL MUST BE ASKED WITH ONE.
   *
   * The first version of this file sent {} to /extract-full and /proxy and
   * called a 400 a pass. But the server refuses a missing url BEFORE it
   * dispatches, so those asks proved the shared guard existed and never
   * reached the route at all — deleting the whole /proxy line still passed.
   *
   * That was not hypothetical. `proxy` had been deleted along with
   * enhanceAudio in the commit before this one, the dispatch line was still
   * there pointing at nothing, and this check went green on it. Every editing
   * copy would have thrown ReferenceError in production.
   *
   * So they are asked with a url that cannot resolve. The route runs, ffmpeg
   * fails against a dead address in milliseconds, and the answer is anything
   * except 404 — which is what a route that no longer exists returns.
   */
  {
    name: "POST /extract-full is really dispatched",
    go: () => post("/extract-full", { url: DEAD_URL }),
    want: (r) => r.status !== 404,
  },
  {
    name: "POST /proxy is really dispatched",
    go: () => post("/proxy", { url: DEAD_URL }),
    want: (r) => r.status !== 404,
  },
  {
    name: "an unknown path is a 404, not a crash",
    go: () => post("/nonsense", { url: DEAD_URL }),
    want: (r) => r.status === 404,
  },
];

const read = async (r) => ({ status: r.status, body: await r.text().catch(() => "") });
const post = (p, body) =>
  fetch(BASE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(read);

async function main() {
  const server = spawn("node", [path.join(__dirname, "..", "container", "render.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  server.stderr.on("data", (d) => (err += d));
  server.stdout.on("data", () => {});

  let dead = false;
  server.on("exit", () => (dead = true));

  /* Boot. A container that cannot start is the whole reason this file is
     here, so say so with its own stderr rather than a timeout. */
  let up = false;
  for (let i = 0; i < 40 && !dead; i++) {
    try {
      await fetch(`${BASE}/render/status?id=boot`);
      up = true;
      break;
    } catch {
      await sleep(150);
    }
  }
  if (!up) {
    console.log("\n✘ container — it does not start.");
    console.log((err || "(no output)").split("\n").map((l) => "    " + l).join("\n"));
    server.kill();
    process.exit(1);
  }

  const bad = [];
  for (const ask of ASKS) {
    try {
      const got = await ask.go();
      if (!ask.want(got)) bad.push(`${ask.name} — got ${got.status} ${got.body.slice(0, 80)}`);
    } catch (e) {
      bad.push(`${ask.name} — ${e.message}`);
    }
  }

  /* Still alive? A crash on one route must not read as a pass on the next. */
  if (dead) bad.push("the container exited while being asked");

  server.kill();

  if (bad.length) {
    console.log("\n✘ container — it starts, but a route is gone or broken.");
    console.log(bad.map((b) => "    " + b).join("\n"));
    if (err.trim()) console.log("\n    stderr:\n" + err.split("\n").map((l) => "      " + l).join("\n"));
    process.exit(1);
  }
  console.log(`✔ container — starts, and all ${ASKS.length} routes answer`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
