/**
 * Aldershot — Workers entry point.
 *
 * Editing is reading. No timeline, no scrubbing, no NLE. See design/ for the
 * spec: design/Aldershot.dc.html is authoritative, design/docs/ explains it.
 *
 * Routing follows design/docs/10-ROUTES-AND-KEYS.md exactly. The prototype
 * switches surfaces on a single `view` string; the built app gives each one a
 * real URL so work is linkable and the back button works — the prototype's
 * biggest limitation, called out in that doc.
 */

import { Hono } from "hono";
import type { Env } from "./env";
import { ensureV2Schema } from "./schema";
import { page, type ShortsCtx, type View } from "./ui/shell";
import { renderHome } from "./ui/pages/home";
import { emptyState, pageHeading } from "./ui/pages/empty";
import { CLIENT_JS } from "./ui/client";
import { currentUser } from "./user";
import { createSource, getSegments, getSource, listSources } from "./sources";
import { readSource } from "./ingest";
import { activeJobs, createJob, getJobs } from "./jobs";
import { monthUsage } from "./usage";

export { RenderContainer } from "./render";

const app = new Hono<{ Bindings: Env }>();

/** Health check — no auth, no schema work, so it stays honest when D1 is down. */
app.get("/api/health", (c) => c.json({ ok: true }));

/** The client runtime: keyboard map, composer, toasts. Served as a module. */
app.get("/app.js", (c) =>
  c.body(CLIENT_JS, 200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
  }),
);

/**
 * Phase 0 renders every surface as its designed empty state. There is no auth
 * yet (phase 9) and no ingested footage yet (phase 1), so "fresh" is the honest
 * state for all of them — these are the prototype's own empty states, not
 * placeholders, and they ship as-is.
 */
function surface(view: View, screenLabel: string, title: string, body: string, shortsCtx: ShortsCtx = "nav") {
  return page({ title, view, screenLabel, shortsCtx }, body);
}

app.get("/", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface("home", "Home", "Aldershot", renderHome({ name: null, isFresh: true })),
  );
});

app.get("/projects", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface(
      "projects",
      "Projects",
      "Projects — Aldershot",
      pageHeading("Projects") + emptyState("Nothing in Projects yet — start something above."),
    ),
  );
});

app.get("/footage", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface(
      "archive",
      "Footage",
      "Footage — Aldershot",
      pageHeading(
        "Footage",
        "Every video you've added. Search by topic, upload new ones, or ask what's in there.",
      ) + emptyState("Nothing kept yet — add a clip back."),
    ),
  );
});

app.get("/clipping", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface(
      "shorts",
      "Clipping",
      "Clipping — Aldershot",
      pageHeading("Clipping") + emptyState("Drop a video, or clip one you already have"),
      "nav",
    ),
  );
});

/**
 * The editor with no project is not a real destination — the nav item exists
 * because the editor is a verb, but you reach a stage through a project. With
 * nothing made yet, say so plainly rather than 404ing.
 */
app.get("/editor", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface(
      "cut",
      "Cutting room",
      "Editor — Aldershot",
      // The prototype has no "editor with nothing open" state — you always
      // arrive at the editor through a project. Rather than invent copy for it,
      // reuse Projects' own real empty line, which says the same true thing.
      // Flagged in docs/decisions/open-questions.md for the owner to rule on.
      pageHeading("Editor") + emptyState("Nothing in Projects yet — start something above."),
    ),
  );
});

app.get("/settings", async (c) => {
  await ensureV2Schema(c.env.DB);
  return c.html(
    surface(
      "settings",
      "Settings",
      "Settings — Aldershot",
      pageHeading(
        "Settings",
        "Defaults, storage, and the deleted pile. Nothing here changes work you've already made.",
      ),
    ),
  );
});


/* ── Ingest (Phase 1) ───────────────────────────────────────────────────
 * Upload → read. The transcript is what makes a source usable, so it is the
 * only thing on this path; probe and frames are sequenced separately so a
 * source becomes readable without waiting on thumbnails.
 */

/**
 * Creates the source row and streams the upload into R2 in one request.
 *
 * Multipart/resumable upload is still to come (06-BUILD-PLAN Phase 1 calls for
 * it) and matters for the 45–180 minute files this is really for; a single PUT
 * is enough to exercise the whole read path end to end today.
 */
app.post("/api/sources", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await currentUser(c.env.DB);

  const filename = c.req.header("x-filename") || "upload.mp4";
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: "empty upload" }, 400);

  const src = await createSource(c.env.DB, { user_id: user.id, filename, origin: "upload" });
  await c.env.MEDIA.put(src.r2_key, body);

  // Reading happens AFTER the response so the user sees staged progress
  // instead of a hung request — an hour of footage takes minutes, and the
  // design is explicit that every long operation shows its stage.
  //
  // waitUntil is the right shape but the wrong lifetime: it is still bounded
  // by the request's limits. Queues (04-API-AND-JOBS.md §Job pipeline) are the
  // real home for this, and the client contract does not change when it moves
  // there — it already polls /api/jobs for the id it gets back here.
  const durationHeader = Number(c.req.header("x-duration-s") || 0);
  const job = await createJob(c.env.DB, { user_id: user.id, type: "transcribe", ref_id: src.id });
  const opts = {
    plan: user.plan,
    diarize: c.req.header("x-diarize") === "1",
    knownDurationS: durationHeader || undefined,
    jobId: job.id,
  };
  c.executionCtx.waitUntil(readSource(c.env, src, opts).then(() => undefined));

  return c.json({ source: src, jobId: job.id });
});

app.get("/api/sources", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await currentUser(c.env.DB);
  return c.json({ sources: await listSources(c.env.DB, user.id) });
});

app.get("/api/sources/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await currentUser(c.env.DB);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);
  return c.json({ source: src, segments: await getSegments(c.env.DB, src.id) });
});

/** The UI polls this for honest staged progress. */
app.get("/api/jobs", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await currentUser(c.env.DB);
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean);
  return c.json({ jobs: ids.length ? await getJobs(c.env.DB, ids) : await activeJobs(c.env.DB, user.id) });
});

/** Owner-only real spend (05-INFRA-AND-COSTS.md; the panel itself is Phase 8). */
app.get("/api/usage/month", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await currentUser(c.env.DB);
  if (!user.is_owner) return c.json({ error: "not found" }, 404);
  const d = new Date();
  const since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return c.json(await monthUsage(c.env.DB, user.id, since));
});


export default app;
