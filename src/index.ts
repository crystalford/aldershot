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

export default app;
