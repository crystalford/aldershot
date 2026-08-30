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

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env.ts";
import { ensureV2Schema } from "./schema.ts";
import { clearCookie, consumeToken, mintSession, sessionCookie, startLogin } from "./auth.ts";
import { renderLanding } from "./ui/pages/landing.ts";
import { page, type ShortsCtx, type View } from "./ui/shell.ts";
import { renderHome } from "./ui/pages/home.ts";
import { emptyState, pageHeading } from "./ui/pages/empty.ts";
import { renderFootageFull, type FootTab, type SearchMode } from "./ui/pages/footage.ts";
import { listMoments, listThreads, searchExact, searchMeaning, threadIdsByClip } from "./library.ts";
import { ulid } from "./id.ts";
import { renderSource } from "./ui/pages/source.ts";
import { editorHeader, renderEditor, type Stage } from "./ui/pages/editor.ts";
import { getProject, listClipsForSource, listProjects, putBeats, saveClips, saveCuts, setKept } from "./projects.ts";
import { renderScript } from "./ui/pages/script.ts";
import { renderClipping } from "./ui/pages/clipping.ts";
import { renderBuild, buildSummary } from "./ui/pages/build.ts";
import { renderProjects } from "./ui/pages/projects.ts";
import { renderSettings } from "./ui/pages/settings.ts";
import { ACCENT } from "./ui/tokens.ts";

/* Named here so the cost panel's categories read as colour decisions. */
const ACCENT_CYAN = ACCENT.cyan;
const ACCENT_GOLD = ACCENT.gold;
const ACCENT_GREEN = ACCENT.green;
const ACCENT_VIOLET = ACCENT.violet;
const ACCENT_RED = ACCENT.red;
import { deleteBeat, getBeats, insertBeat, moveBeat, setBeatMedia } from "./projects.ts";
import { placeReactions } from "./reactions.ts";
import { draftOutline, type EssayBeat } from "./essay.ts";
import { runShorts } from "./shorts-job.ts";
import { CLIP_LENGTHS, type ClipLength } from "./shorts.ts";
import { addCuts, fillerCuts, parseCuts, pauseCuts, runtimeAfterCuts, serialiseCuts, timeSaved, toggleSegment, toggleWord } from "./cuts.ts";
import type { CleanUp } from "./ui/pages/editor.ts";
import { createRender, edlForProject, listRenders, runRender, type Aspect, type Format } from "./render-job.ts";
import { CLIENT_JS } from "./ui/client.ts";
import { currentUser, userForEmail } from "./user.ts";
import { PLANS } from "./plans.ts";
import { clipCountsBySource, createSource, getSegments, getSource, listSources } from "./sources.ts";
import { readSource } from "./ingest.ts";
import { abortUpload, completeUpload, startUpload, uploadPart } from "./upload.ts";
import { activeJobs, createJob, failJob, finishJob, getJobs, recentlyFinished, startJob } from "./jobs.ts";
import { meter, monthUsage } from "./usage.ts";
import { begin, runScore } from "./begin.ts";
import { intentLabel, readIntent } from "./intent.ts";

export { RenderContainer } from "./render.ts";

const app = new Hono<{ Bindings: Env }>();

/** The request context, as every route in this file sees it. */
type Ctx = Context<{ Bindings: Env }>;

/**
 * Reads a JSON body, treating a malformed one as an empty object.
 *
 * `c.req.json<T>().catch(() => ({}))` widens the result to `T | {}`, which
 * then rejects every property access — this keeps the declared shape and
 * makes every field optional at the call site, where it belongs.
 */
async function body<T extends object>(c: { req: { json<U>(): Promise<U> } }): Promise<Partial<T>> {
  return await c.req.json<Partial<T>>().catch(() => ({}) as Partial<T>);
}

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

/* ── Auth ──────────────────────────────────────────────────────────────
   Email link only. See src/auth.ts for why there are no passwords. */

/** Asks for a link. Never reveals whether the address has an account. */
app.post("/auth/start", async (c) => {
  await ensureV2Schema(c.env.DB);
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim();

  // Enough of a check to catch a typo, not a regex pretending to validate
  // email — the link either arrives or it does not, which is the real test.
  if (!email.includes("@") || email.length < 5) {
    return c.redirect("/?error=email", 302);
  }

  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const { url, sent } = await startLogin(c.env, email, origin);

  /*
   * With no mail provider configured the link is only logged, so saying
   * "check your email" would be a lie. In that case the link is handed
   * straight back instead — which is also what makes local development work
   * without a Resend key.
   */
  if (!sent) return c.redirect(`/?link=${encodeURIComponent(url)}`, 302);
  return c.redirect(`/?sent=${encodeURIComponent(email)}`, 302);
});

/** Follows a link: proves the address, mints the session, lands on Home. */
app.get("/auth/callback", async (c) => {
  await ensureV2Schema(c.env.DB);
  const token = c.req.query("token");
  if (!token) return c.redirect("/?error=link", 302);

  const email = await consumeToken(c.env, token);
  if (!email) return c.redirect("/?error=link", 302);

  const user = await userForEmail(c.env.DB, email);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("set-cookie", sessionCookie(await mintSession(c.env, user.id), secure));
  return c.redirect("/", 302);
});

app.post("/auth/signout", async (c) => {
  c.header("set-cookie", clearCookie(new URL(c.req.url).protocol === "https:"));
  return c.redirect("/", 302);
});

app.get("/", async (c) => {
  await ensureV2Schema(c.env.DB);

  /*
   * `/` is the landing site when signed out and Home when signed in
   * (10-ROUTES-AND-KEYS.md). Same URL, so a shared link works for both.
   */
  const visitor = await currentUser(c.env, c.req.header("cookie"));
  if (!visitor) {
    return c.html(
      renderLanding({
        sentTo: c.req.query("sent") ?? null,
        devLink: c.req.query("link") ?? null,
        error: c.req.query("error") ?? null,
      }),
    );
  }

  const user = visitor;
  const [sources, jobs, finished, projects] = await Promise.all([
    listSources(c.env.DB, user.id),
    activeJobs(c.env.DB, user.id),
    recentlyFinished(c.env.DB, user.id),
    listProjects(c.env.DB, user.id),
  ]);

  // "Fresh" means the account genuinely has nothing — that is what earns the
  // demo card and the "How this goes" walkthrough. One upload and they go.
  const isFresh = sources.length === 0;
  const byId = new Map(sources.map((s) => [s.id, s]));

  return c.html(
    surface(
      "home",
      "Home",
      "Aldershot",
      renderHome({
        name: user.name,
        isFresh,
        // "Overnight" is the last 12 hours — real arrivals only, never a
        // number invented to make the greeting feel alive.
        landedOvernight: sources.filter((s) => Date.now() - s.created_at < 12 * 3600 * 1000).length,
        working: jobs.map((j) => ({
          label: byId.get(j.ref_id ?? "")?.title ?? "a video",
          stage: j.stage_label ?? "working on",
          pct: j.pct,
        })),
        /*
         * The feed reports finished JOBS, so it can only ever say what really
         * ran. A failure is included and named — coming back to a silent gap
         * where a render should be is worse than coming back to bad news.
         */
        feed: finished.map((j) => {
          /*
           * A job's ref_id points at a source for reading and scoring, but at
           * a PROJECT for passes and renders. Looking only at sources made
           * every pass read "Ran a pass on a video", which tells the user
           * nothing about which of their things moved.
           */
          const what =
            byId.get(j.ref_id ?? "")?.title ??
            projects.find((p) => p.id === j.ref_id)?.title ??
            "a video";
          const done: Record<string, string> = {
            transcribe: `Finished reading ${what}`,
            score: `Found the moments in ${what}`,
            shorts: `Cut shorts from ${what}`,
            render: `Rendered ${what}`,
            pass: `Ran a pass on ${what}`,
          };
          return {
            text: j.state === "failed" ? (j.error ?? `Couldn't finish ${what}`) : (done[j.type] ?? `Finished ${what}`),
            at: j.finished_at ?? j.created_at,
            state: j.state,
            href: j.ref_id
              ? projects.some((p) => p.id === j.ref_id)
                ? `/p/${j.ref_id}/build`
                : `/sources/${j.ref_id}`
              : undefined,
            link: "Open",
          };
        }),
        motion: projects
          .filter((p) => !p.archived_at && p.pct > 0 && p.pct < 100)
          .slice(0, 6)
          .map((p) => ({
            id: p.id, title: p.title, pct: p.pct,
            next_action: p.next_action, poster_r2_key: p.poster_r2_key,
          })),
      }),
    ),
  );
});

app.get("/projects", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const projects = (await listProjects(c.env.DB, user.id)).filter((p) => !p.archived_at);

  /*
   * A project's state pill is derived from its beats, not stored: "needs you"
   * means a voice or reaction beat has no recording yet. Stored, it would go
   * stale the moment a beat was recorded from any other surface.
   */
  const rows = await Promise.all(
    projects.map(async (p) => {
      const beats = await getBeats(c.env.DB, p.id);

      /*
       * A project has no poster of its own until it is rendered, so it borrows
       * the frame of its first clip — a real frame from the footage, which is
       * what the design requires. Left empty, every card on this surface was a
       * black rectangle and the page stopped reading as a video tool.
       */
      let posterKey = p.poster_r2_key;
      if (!posterKey) {
        const firstClipId = beats.find((b) => b.clip_id)?.clip_id;
        if (firstClipId) {
          const clip = await c.env.DB
            .prepare(`SELECT frame_r2_key FROM v2_clips WHERE id=?`)
            .bind(firstClipId)
            .first<{ frame_r2_key: string }>();
          posterKey = clip?.frame_r2_key ?? null;
        }
      }

      /* Runtime is the sum of the beats, for the same reason. */
      const runtime = beats.reduce((n, b) => n + (b.dur_ms ?? 0), 0);

      return {
        id: p.id, title: p.title, kind: p.kind, pct: p.pct,
        runtime_s: p.runtime_s ?? (runtime ? Math.round(runtime / 1000) : null),
        next_action: p.next_action,
        poster_r2_key: posterKey, updated_at: p.updated_at,
        beats: beats.length,
        needs: beats.filter((b) => (b.kind === "vo" || b.kind === "react") && !b.media_r2_key).length,
      };
    }),
  );

  return c.html(
    surface("projects", "Projects", "Projects — Aldershot", renderProjects(rows)),
  );
});

app.get("/footage", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const t = c.req.query("tab");
  const tab: FootTab =
    t === "threads" ? "threads" : t === "sources" ? "sources" : t === "find" ? "find" : "moments";
  const mode: SearchMode = c.req.query("mode") === "exact" ? "exact" : "meaning";
  const query = (c.req.query("q") || "").trim();
  const thread = c.req.query("thread") || null;

  /*
   * Every tab carries its count, so all three lists are needed on every tab,
   * not just the one being shown. They are small — threads and sources are
   * tens of rows — and loading only the active tab left the other two reading
   * "Threads" with no number, which looks like zero.
   */
  const sources = await listSources(c.env.DB, user.id);
  const threads = await listThreads(c.env.DB, user.id);

  let moments: Awaited<ReturnType<typeof listMoments>> = [];
  let meaningUnavailable = false;

  if (tab === "moments") {
    if (!query) {
      moments = await listMoments(c.env.DB, user.id);
      if (thread) {
        const inThread = await threadIdsByClip(c.env.DB, user.id);
        moments = moments.filter((m) => (inThread.get(m.id) ?? []).includes(thread));
      }
    } else if (mode === "meaning") {
      const byMeaning = await searchMeaning(c.env, user.id, query);
      if (byMeaning === null) {
        // The index isn't there. Fall back to exact and SAY so — returning
        // nothing would read as "your library has nothing like that".
        meaningUnavailable = true;
        moments = await searchExact(c.env.DB, user.id, query);
      } else {
        moments = byMeaning;
      }
    } else {
      moments = await searchExact(c.env.DB, user.id, query);
    }
  }

  return c.html(
    surface(
      "archive",
      "Footage",
      "Footage — Aldershot",
      renderFootageFull({ tab, sources, moments, threads, mode, q: query, meaningUnavailable, thread }),
    ),
  );
});

/**
 * The acting user, or a redirect out.
 *
 * A page sends a signed-out visitor to the landing site at `/`; an API call
 * gets a 401 it can act on rather than a login page it cannot parse. Throwing
 * rather than returning null keeps every route one line, which is what stopped
 * the null check being forgotten somewhere.
 */
async function requireUser(c: Ctx) {
  const user = await currentUser(c.env, c.req.header("cookie"));
  if (user) return user;

  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    throw new HTTPException(401, { message: "sign in" });
  }
  throw new HTTPException(302, {
    res: new Response(null, { status: 302, headers: { location: "/" } }),
  });
}

/**
 * Where the user came in from, as [label, href].
 *
 * The prototype keeps this as `cameFrom` state and renders "← " + its label,
 * so the editor sends you back where you actually were. Server-rendered there
 * is no such state, so the Referer carries it — and when it is absent or
 * off-site the answer is Home, which is the prototype's own default.
 */
function cameFrom(referer: string | undefined): [string, string] {
  const path = (() => {
    try {
      return new URL(referer ?? "").pathname;
    } catch {
      return "";
    }
  })();

  if (path.startsWith("/footage") || path.startsWith("/sources/")) return ["Footage", "/footage?tab=sources"];
  if (path.startsWith("/clipping")) return ["Clipping", "/clipping"];
  if (path.startsWith("/projects")) return ["Projects", "/projects"];
  return ["Home", "/"];
}

/** One source, read. Phase 1's claim made visible. */
app.get("/sources/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.notFound();

  const [segments, jobs] = await Promise.all([
    getSegments(c.env.DB, src.id),
    getJobs(c.env.DB, []).then(() => activeJobs(c.env.DB, user.id)),
  ]);
  const job = jobs.find((j) => j.ref_id === src.id) ?? null;

  return c.html(
    surface("archive", "Footage", `${src.title} — Aldershot`, renderSource({ source: src, segments, job })),
  );
});

/**
 * The poster frame, extracted in the browser from the file the user just
 * picked. A real frame of the real video — the design allows nothing else.
 */
app.post("/api/sources/:id/poster", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: "empty" }, 400);

  const key = `u/${user.id}/sources/${src.id}/poster.jpg`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare(`UPDATE sources SET poster_r2_key=? WHERE id=?`).bind(key, src.id).run();
  return c.json({ ok: true });
});

/** Media out of R2. Posters and, later, frames and renders. */
app.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/media\//, "");
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      // Immutable: a poster for a given source never changes.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

/** Re-read a source that failed, keeping everything the user already gave us. */
app.post("/api/sources/:id/retry", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "transcribe", ref_id: src.id });
  c.executionCtx.waitUntil(
    readSource(c.env, src, { plan: user.plan, jobId: job.id }).then(() => undefined),
  );
  return c.redirect(`/sources/${src.id}`, 303);
});

app.get("/clipping", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const sources = await listSources(c.env.DB, user.id);
  const sourceId = c.req.query("source");
  const source = sourceId ? (sources.find((s) => s.id === sourceId) ?? null) : null;

  // Only what Clipping produced — the editor's kept clips are a different
  // thing and belong in Footage, not mixed in here.
  const shorts = source
    ? (await listClipsForSource(c.env.DB, source.id, user.id)).filter((cl) => cl.origin === "clipping")
    : [];
  const jobs = await activeJobs(c.env.DB, user.id);
  const job = source ? (jobs.find((j) => j.ref_id === source.id) ?? null) : null;
  const clipCounts = await clipCountsBySource(c.env.DB, user.id);

  return c.html(
    surface(
      "shorts",
      "Clipping",
      "Clipping — Aldershot",
      renderClipping({
        source: source
          ? {
              id: source.id, title: source.title, duration_s: source.duration_s,
              transcript_state: source.transcript_state, poster_r2_key: source.poster_r2_key,
              clip_count: clipCounts.get(source.id) ?? 0,
            }
          : null,
        available: sources.map((s) => ({
          id: s.id, title: s.title, duration_s: s.duration_s, transcript_state: s.transcript_state,
          poster_r2_key: s.poster_r2_key, clip_count: clipCounts.get(s.id) ?? 0,
        })),
        shorts,
        job,
        fromEditor: false,
      }),
      "nav",
    ),
  );
});

/** Start a Clipping batch, or search for one it missed. */
app.post("/api/shorts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ sourceId: string; length: string; count: number; query: string }>(c);
  if (!b.sourceId) return c.json({ error: "pick a video first" }, 400);

  const src = await getSource(c.env.DB, b.sourceId, user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  // The UI sends the label ("30–60s"); map it back to the id it stands for.
  const length = (CLIP_LENGTHS.find((l) => l.name === b.length || l.id === b.length)?.id ?? "30-60") as ClipLength;

  const job = await createJob(c.env.DB, { user_id: user.id, type: "shorts", ref_id: src.id });
  c.executionCtx.waitUntil(
    runShorts(c.env, {
      userId: user.id,
      sourceId: src.id,
      jobId: job.id,
      length,
      count: Number(b.count) || 8,
      query: b.query,
    }),
  );
  return c.json({ jobId: job.id });
});

/* ── The editor ────────────────────────────────────────────────────────
 * One surface, four stages, real URLs per 10-ROUTES-AND-KEYS.md.
 */
const STAGE_FOR_PATH: Record<string, Stage> = {
  pick: "cut",
  build: "essay",
  script: "transcript",
  shorts: "shorts",
};

app.get("/p/:id/:stagePath", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const stage = STAGE_FOR_PATH[c.req.param("stagePath")];
  if (!stage) return c.notFound();

  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.notFound();

  const source = project.source_id ? await getSource(c.env.DB, project.source_id, user.id) : null;
  const clips = source ? await listClipsForSource(c.env.DB, source.id, user.id) : [];

  /*
   * The Clean up chips' sublabels carry live numbers, so they are computed
   * from the real transcript. A chip whose number cannot be computed honestly
   * shows its descriptive text and stays disabled rather than displaying a
   * fabricated count.
   */
  let cleanUps: CleanUp[] = [];
  if (source && stage === "cut") {
    const segs = await getSegments(c.env.DB, source.id);
    const cuts = parseCuts(project.cuts);
    const minus = (ms: number) => `−${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

    const fillers = fillerCuts(segs);
    const fillersLeft = fillers.filter((f) => !cuts.some((x) => x.seg === f.seg && x.words?.[0] === f.words?.[0]));
    const pauses = pauseCuts(segs);
    const pausesLeft = pauses.filter((p2) => !cuts.some((x) => x.seg === p2.seg && x.words?.[0] === p2.words?.[0]));

    cleanUps = [
      { id: "sound", name: "Studio sound", sub: "noise, echo, levels — regenerated", ready: false, done: false },
      {
        id: "fillers",
        name: "Remove the ums and uhs",
        sub: fillersLeft.length
          ? `${fillersLeft.length} found · ${minus(timeSaved(segs, cuts, fillersLeft))}`
          : fillers.length
            ? `${fillers.length} gone`
            : "none found",
        ready: fillersLeft.length > 0,
        done: fillers.length > 0 && fillersLeft.length === 0,
      },
      {
        id: "pauses",
        name: "Tighten long pauses",
        sub: pausesLeft.length
          ? `anything over 2s · ${minus(timeSaved(segs, cuts, pausesLeft))}`
          : pauses.length
            ? "tightened"
            : "none over 2s",
        ready: pausesLeft.length > 0,
        done: pauses.length > 0 && pausesLeft.length === 0,
      },
      // "Flagged" needs the model to mark weak stretches, which no pass does
      // yet. Shown with its real description and disabled, rather than with an
      // invented count.
      { id: "flagged", name: "Cut everything it flagged", sub: "dead air, false starts", ready: false, done: false },
    ];
  }
  const jobs = await activeJobs(c.env.DB, user.id);
  const job = jobs.find((j) => j.ref_id === project.id) ?? null;

  if (stage === "essay") {
    const beats = await getBeats(c.env.DB, project.id);
    const byClip = new Map(clips.map((cl) => [cl.id, cl]));
    return c.html(
      page(
        { title: `${project.title} — Aldershot`, view: stage, screenLabel: "Essay", shortsCtx: "editor" },
        editorHeader({
          projectId: project.id, title: project.title, brief: project.brief,
          sourceTitle: source?.title ?? "", sourceFilename: source?.filename ?? null,
          hasSource: Boolean(source), stage, clips, job, kind: project.kind,
          cameFrom: cameFrom(c.req.header("referer")),
          beatCount: beats.length,
          beatRuntimeMs: beats.reduce((n, b) => n + (b.dur_ms ?? 0), 0),
          summary: buildSummary(beats, project.kind),
        }) +
          renderBuild({
            projectId: project.id,
            hasActs: Boolean(project.has_acts),
            playIdx: 0,
            beats: beats.map((b) => {
              const clip = b.clip_id ? byClip.get(b.clip_id) : undefined;
              return {
                id: b.id, idx: b.idx, kind: b.kind as never, act: b.act, text: b.text,
                dur_ms: b.dur_ms, media_r2_key: b.media_r2_key,
                clip_id: b.clip_id,
                quote: clip?.quote ?? null,
                sourceFilename: source?.filename ?? null,
                start_ms: clip?.start_ms ?? null,
                frame_r2_key: clip?.frame_r2_key ?? null,
              };
            }),
          }),
      ),
    );
  }

  // Script edits the source transcript directly, so it needs the segments
  // rather than the scored clips.
  if (stage === "transcript" && source) {
    const segments = await getSegments(c.env.DB, source.id);
    const cuts = parseCuts(project.cuts);
    return c.html(
      page(
        { title: `${project.title} — Aldershot`, view: stage, screenLabel: "Transcript editor", shortsCtx: "editor" },
        editorHeader({
          projectId: project.id,
          kind: project.kind,
          cameFrom: cameFrom(c.req.header("referer")),
          title: project.title,
          brief: project.brief,
          sourceTitle: source.title,
          sourceFilename: source.filename,
          hasSource: true,
          stage,
          clips,
          job,
        }) +
          renderScript({
            projectId: project.id,
            segments,
            cuts,
            // Precedence matters here: `a ?? b ?? 0 / 1000` divides only the
            // zero, so the fallback silently read milliseconds as seconds and
            // a 70-second transcript displayed as 19 hours.
            originalS: source.duration_s ?? (segments.at(-1)?.end_ms ?? 0) / 1000,
            afterS: runtimeAfterCuts(segments, cuts),
            posterKey: source.poster_r2_key,
            fillersRemoved:
              fillerCuts(segments).length > 0 &&
              fillerCuts(segments).every((f) => cuts.some((c) => c.seg === f.seg && c.words?.[0] === f.words?.[0])),
            pausesTightened:
              pauseCuts(segments).length > 0 &&
              pauseCuts(segments).every((f) => cuts.some((c) => c.seg === f.seg && c.words?.[0] === f.words?.[0])),
          }),
      ),
    );
  }

  // The nav keeps Editor lit on the shorts stage — that context is why the
  // editor feels like one place (10-ROUTES-AND-KEYS.md).
  return c.html(
    page(
      { title: `${project.title} — Aldershot`, view: stage, screenLabel: "Cutting room", shortsCtx: "editor" },
      renderEditor({
        cleanUps,
        kind: project.kind,
        cameFrom: cameFrom(c.req.header("referer")),
        projectId: project.id,
        title: project.title,
        brief: project.brief,
        sourceTitle: source?.title ?? "",
        sourceFilename: source?.filename ?? null,
        hasSource: Boolean(source),
        stage,
        clips,
        job,
      }),
    ),
  );
});

/**
 * A transcript cut. Autosaved on every gesture — there is no Save button in
 * this design and adding one would be wrong (10-ROUTES-AND-KEYS.md §Autosave).
 */
app.post("/api/projects/:id/cuts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project || !project.source_id) return c.json({ error: "not found" }, 404);

  const b = await body<{ seg: number; word: number | null; kind: "word" | "segment" | "fillers" | "pauses" }>(c);
  const segments = await getSegments(c.env.DB, project.source_id);
  let cuts = parseCuts(project.cuts);

  if (b.kind === "fillers") {
    cuts = addCuts(cuts, fillerCuts(segments));
  } else if (b.kind === "pauses") {
    cuts = addCuts(cuts, pauseCuts(segments));
  } else if (b.kind === "segment" && typeof b.seg === "number") {
    cuts = toggleSegment(cuts, b.seg);
  } else if (b.kind === "word" && typeof b.seg === "number" && typeof b.word === "number") {
    cuts = toggleWord(cuts, b.seg, b.word);
  } else {
    return c.json({ error: "bad cut" }, 400);
  }

  await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  return c.json({ cuts, afterS: runtimeAfterCuts(segments, cuts) });
});

/**
 * Render the cut. Every render is a NEW row — re-rendering after an edit never
 * loses the previous version (06-BUILD-PLAN.md §Phase 3).
 */
app.post("/api/renders", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ projectId: string; format: Format; aspect: Aspect }>(c);
  if (!b.projectId) return c.json({ error: "which project?" }, 400);

  const project = await getProject(c.env.DB, b.projectId, user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const render = await createRender(c.env.DB, {
    user_id: user.id,
    project_id: project.id,
    format: b.format || "mp4_1080",
    aspect: b.aspect || "16:9",
  });
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: project.id });

  c.executionCtx.waitUntil(
    runRender(c.env, { userId: user.id, projectId: project.id, renderId: render.id, jobId: job.id }),
  );
  return c.json({ render, jobId: job.id });
});

app.get("/api/projects/:id/renders", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);
  return c.json({ renders: await listRenders(c.env.DB, project.id) });
});

/**
 * What the cut currently is, as ranges. The preview and the runtime figures
 * read from here so the number a user sees and the video they get come from
 * the same place.
 */
app.get("/api/projects/:id/edl", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);
  const built = await edlForProject(c.env, project, user.id);
  if (!built) return c.json({ error: "no source" }, 400);
  return c.json({ cuts: built.edl.cuts, durationMs: built.edl.durationMs });
});

/* ── Beats ─────────────────────────────────────────────────────────────
 * The edit IS the beats table, so these are the edit operations.
 */
app.post("/api/projects/:id/beats", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ at: number; kind: string; text: string; clipId: string }>(c);
  const kind = (["clip", "vo", "react", "generated", "stock"] as const).find((k) => k === b.kind) ?? "vo";
  const beats = await insertBeat(c.env.DB, project.id, Number(b.at ?? 0), {
    kind,
    text: b.text ?? null,
    clip_id: b.clipId ?? null,
  });
  return c.json({ beats });
});

app.post("/api/projects/:id/beats/:beatId/move", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);
  const b = await body<{ dir: number }>(c);
  const beats = await moveBeat(c.env.DB, project.id, c.req.param("beatId"), b.dir === 1 ? 1 : -1);
  return c.json({ beats });
});

app.delete("/api/projects/:id/beats/:beatId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);
  return c.json({ beats: await deleteBeat(c.env.DB, project.id, c.req.param("beatId")) });
});

/**
 * A recorded take. The browser records it, so this only has to store it and
 * attach it to the beat — the recording itself never touches the server until
 * the user has one they are happy with.
 */
app.post("/api/beats/:beatId/record", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const audio = await c.req.arrayBuffer();
  if (!audio.byteLength) return c.json({ error: "empty recording" }, 400);

  const beatId = c.req.param("beatId");
  const key = `u/${user.id}/beats/${beatId}.webm`;
  await c.env.MEDIA.put(key, audio, { httpMetadata: { contentType: "audio/webm" } });
  await setBeatMedia(c.env.DB, beatId, key, Number(c.req.header("x-duration-ms") || 0));
  return c.json({ ok: true, key });
});

/** Lay out a reaction: clips interleaved with lines drafted to say after them. */
app.post("/api/projects/:id/reactions", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project?.source_id) return c.json({ error: "not found" }, 404);

  const b = await body<{ about: string }>(c);
  const about = (b.about || project.brief || "").trim();
  if (!about) return c.json({ error: "say what you're reacting to" }, 400);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "pass", ref_id: project.id });
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await startJob(c.env.DB, job.id, "placing the reactions");
        const segments = await getSegments(c.env.DB, project.source_id!);
        const result = await placeReactions(c.env, segments, about);

        const src = await getSource(c.env.DB, project.source_id!, user.id);
        const clipBeats = result.beats.filter((x) => x.kind === "clip");
        const saved = await saveClips(
          c.env.DB,
          { user_id: user.id, source_id: project.source_id!, origin: "editor", posterKey: src?.poster_r2_key ?? null },
          clipBeats.map((x) => ({
            start_ms: x.start_ms!, end_ms: x.end_ms!, quote: x.quote ?? "",
            why: x.why ?? "", score: 0, heat: 0,
          })),
        );

        // Interleave: each clip, then the line drafted to say after it.
        const existing = await listClipsForSource(c.env.DB, project.source_id!, user.id);
        const beats: Parameters<typeof putBeats>[2] = [];
        let n = 0;
        for (const rb of result.beats) {
          if (rb.kind === "clip") {
            const match =
              saved.find((cl) => cl.start_ms === rb.start_ms) ??
              existing.find((cl) => cl.start_ms === rb.start_ms);
            beats.push({
              kind: "clip", act: null, clip_id: match?.id ?? null, text: rb.quote ?? null,
              struck: null, dur_ms: (rb.end_ms ?? 0) - (rb.start_ms ?? 0), media_r2_key: null, recorded_at: null,
            });
            n++;
          } else {
            beats.push({
              kind: "react", act: null, clip_id: null, text: rb.say ?? null,
              struck: null, dur_ms: null, media_r2_key: null, recorded_at: null,
            });
          }
        }
        await putBeats(c.env.DB, project.id, beats);
        await meter(c.env.DB, {
          user_id: user.id, job_id: job.id, job_type: "pass",
          tokens_in: result.tokensIn, tokens_out: result.tokensOut,
        });
        await finishJob(c.env.DB, job.id);
      } catch (err) {
        await failJob(c.env.DB, job.id, `Couldn't place the reactions: ${err instanceof Error ? err.message : String(err)}`);
      }
    })(),
  );
  return c.json({ jobId: job.id });
});

/**
 * Outline an essay from the library.
 *
 * Unlike every other pass, this one has no source video — it builds from what
 * the user has already kept. A beat the model could not back with a real clip
 * comes back marked as a gap rather than dropped or faked.
 */
app.post("/api/projects/:id/outline", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ topic: string }>(c);
  const topic = (b.topic || project.brief || project.title || "").trim();
  if (!topic) return c.json({ error: "what is the essay about?" }, 400);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "pass", ref_id: project.id });
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await startJob(c.env.DB, job.id, "drafting the acts");
        const moments = await listMoments(c.env.DB, user.id, 120);
        if (!moments.length) {
          return void (await failJob(c.env.DB, job.id, "Nothing kept yet — an essay is built from clips you've saved."));
        }

        const outline = await draftOutline(
          c.env,
          topic,
          moments.map((m) => ({ id: m.id, quote: m.quote, source_title: m.source_title })),
        );

        /*
         * A clip beat's length is the clip's length — it is known here and
         * must be written, because Build's timecodes, its runtime label and
         * the width of every segment in the preview scrubber all read from
         * dur_ms. Left null, the whole surface renders "0:00" and the scrubber
         * shows equal-width blocks that mean nothing.
         */
        const byId = new Map(moments.map((m) => [m.id, m]));
        await putBeats(
          c.env.DB,
          project.id,
          outline.beats.map((be: EssayBeat) => {
            const clip = be.clip_id ? byId.get(be.clip_id) : undefined;
            return {
              kind: be.kind, act: be.act, clip_id: be.clip_id ?? null, text: be.text,
              struck: null,
              dur_ms: clip ? clip.end_ms - clip.start_ms : null,
              media_r2_key: null, recorded_at: null,
            };
          }),
        );
        await c.env.DB.prepare(`UPDATE v2_projects SET has_acts=1, updated_at=? WHERE id=?`)
          .bind(Date.now(), project.id).run();

        // The pass log says honestly how much of the argument is actually
        // backed — including the beats the model wanted to cite and could not.
        const backed = outline.beats.filter((be) => be.kind === "clip").length;
        await c.env.DB
          .prepare(`INSERT INTO passes (id,project_id,source_id,n,instruction,result,model,tokens_in,tokens_out,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(
            ulid(), project.id, null, 1, topic,
            `${outline.beats.length} beats — ${backed} backed by a clip` +
              (outline.rejected ? `, ${outline.rejected} needing footage it doesn't have` : ""),
            outline.model, outline.tokensIn, outline.tokensOut, Date.now(),
          ).run();

        await meter(c.env.DB, {
          user_id: user.id, job_id: job.id, job_type: "pass",
          tokens_in: outline.tokensIn, tokens_out: outline.tokensOut,
        });
        await finishJob(c.env.DB, job.id);
      } catch (err) {
        await failJob(c.env.DB, job.id, `Couldn't draft the acts: ${err instanceof Error ? err.message : String(err)}`);
      }
    })(),
  );
  return c.json({ jobId: job.id });
});

/** Keep or drop a block. Undoable — nothing here hard-deletes. */
app.post("/api/clips/:id/keep", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ kept: boolean }>(c);
  await setKept(c.env.DB, c.req.param("id"), user.id, Boolean(b.kept));
  return c.json({ ok: true });
});

/**
 * Make a short out of one transcript line.
 *
 * Script is where you are already reading the words, so turning a line you
 * just read into a clip should not mean going somewhere else and finding it
 * again. The clip is `origin: "manual"` — it was chosen by hand, so it has no
 * score, and the library shows it beside the scored ones without pretending a
 * model picked it.
 */
app.post("/api/projects/:id/shorts-from-line", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project || !project.source_id) return c.json({ error: "not found" }, 404);

  const b = await body<{ segIdx: number }>(c);
  const segments = await getSegments(c.env.DB, project.source_id);
  const seg = segments.find((x) => x.idx === b.segIdx);
  if (!seg) return c.json({ error: "no such line" }, 404);

  const source = await getSource(c.env.DB, project.source_id, user.id);
  const saved = await saveClips(
    c.env.DB,
    {
      user_id: user.id,
      source_id: project.source_id,
      origin: "manual",
      posterKey: source?.poster_r2_key ?? null,
    },
    [{ start_ms: seg.start_ms, end_ms: seg.end_ms, quote: seg.text, why: null, score: null, heat: null }],
  );

  // saveClips drops anything that overlaps a clip we already hold, so an empty
  // result means the moment is already in the library — not a failure.
  return c.json({ ok: true, made: saved.length > 0, clip: saved[0] ?? null });
});

/** An extra instruction against what the pass already found. */
app.post("/api/projects/:id/passes", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project || !project.source_id) return c.json({ error: "not found" }, 404);

  const b = await body<{ instruction: string }>(c);
  const instruction = (b.instruction || "").trim();
  if (!instruction) return c.json({ error: "say what you want" }, 400);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "pass", ref_id: project.id });
  c.executionCtx.waitUntil(
    runScore(c.env, {
      userId: user.id,
      sourceId: project.source_id,
      projectId: project.id,
      brief: instruction,
      jobId: job.id,
    }),
  );
  return c.json({ jobId: job.id });
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
  const user = await requireUser(c);
  const pro = user.plan !== "free";

  const now = new Date();
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const roll = await monthUsage(c.env.DB, user.id, since);

  /*
   * Processing minutes are the source minutes actually metered this month, and
   * storage is what R2 is actually holding. Both come from usage_events rather
   * than a counter kept alongside, so the meters cannot drift from the bill.
   */
  const stored = await c.env.DB
    .prepare(`SELECT SUM(bytes_stored) AS b FROM usage_events WHERE user_id=? AND created_at>=?`)
    .bind(user.id, since)
    .first<{ b: number | null }>();

  /*
   * The caps come from PLANS, which is also what checkCap refuses on. They
   * were hardcoded here, and they disagreed with it — Settings told a free
   * account it had 300 minutes while ingest cut it off at 60. A number shown
   * to the user and the number enforced against them have to be one number.
   */
  const limits = PLANS[user.plan] ?? PLANS.free;
  const meters = [
    {
      label: "Processing minutes",
      used: Math.round(roll.source_minutes),
      cap: limits.sourceMinutes,
      unit: "",
      color: ACCENT_CYAN,
      note: "Spent reading footage, rendering cuts, and burning captions. Resets on the 1st.",
    },
    {
      label: "Storage",
      used: Math.round(((stored?.b ?? 0) / 1e9) * 10) / 10,
      cap: limits.storageGb,
      unit: "GB",
      color: ACCENT_GREEN,
      note: "Source videos are the bulk of it. Nothing expires — need more room, add storage or point sources at your own bucket below.",
    },
  ];

  /*
   * The cost panel is owner-only and reads the same rollup the API does. A job
   * type with no events this month is simply absent — showing it at $0.00
   * would imply we ran it and it was free.
   */
  let cost = null;
  if (user.is_owner) {
    const LABEL: Record<string, [string, string, string]> = {
      transcribe: ["Transcribe + align", ACCENT_CYAN, "Whisper on a container, per source minute"],
      pass: ["Reading it for meaning", ACCENT_GOLD, "one pass per video plus your extra passes"],
      score: ["Reading it for meaning", ACCENT_GOLD, "one pass per video plus your extra passes"],
      render: ["Rendering", ACCENT_GREEN, "vCPU-seconds on Containers"],
      shorts: ["Rendering", ACCENT_GREEN, "vCPU-seconds on Containers"],
      storage: ["Storage", ACCENT_VIOLET, "originals kept, never auto-deleted. Grows every month."],
      delivery: ["Delivery", ACCENT_RED, "Stream minutes watched, mostly your own previews"],
    };

    // Several job types roll into one line — render and shorts are both
    // "Rendering" as far as spend is concerned.
    const merged = new Map<string, { label: string; amount: number; color: string; note: string }>();
    for (const l of roll.lines) {
      const [label, color, note] = LABEL[l.job_type] ?? [l.job_type, ACCENT_CYAN, ""];
      const at = merged.get(label);
      if (at) at.amount += l.cost;
      else merged.set(label, { label, amount: l.cost, color, note });
    }

    const finished = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM renders WHERE user_id=? AND state='ready' AND created_at>=?`)
      .bind(user.id, since)
      .first<{ n: number }>();

    cost = {
      lines: [...merged.values()].sort((a, b) => b.amount - a.amount),
      total: roll.total,
      finished: finished?.n ?? 0,
      dayOfMonth: now.getUTCDate(),
    };
  }

  return c.html(
    surface(
      "settings",
      "Settings",
      "Settings — Aldershot",
      renderSettings({ name: user.name, plan: user.plan, isOwner: !!user.is_owner, meters, cost }),
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
  const user = await requireUser(c);

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

/* ── Resumable upload ──────────────────────────────────────────────────
 * A 45–180 minute source is gigabytes. These three routes let the client send
 * it in 8MB parts, retry a single failed part instead of the whole file, and
 * resume after an interruption.
 */

/** Reserves the source row and opens the multipart upload. */
app.post("/api/uploads", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ filename: string; contentType: string }>(c);
  const filename = b.filename || "upload.mp4";

  const src = await createSource(c.env.DB, { user_id: user.id, filename, origin: "upload" });
  const started = await startUpload(c.env.MEDIA, src.r2_key, b.contentType);
  return c.json({ source: src, ...started });
});

/** One part. Part numbers are 1-indexed; order does not matter. */
app.put("/api/uploads/:sourceId/parts/:n", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const uploadId = c.req.header("x-upload-id");
  if (!uploadId) return c.json({ error: "missing upload id" }, 400);

  const part = await uploadPart(
    c.env.MEDIA,
    src.r2_key,
    uploadId,
    Number(c.req.param("n")),
    await c.req.arrayBuffer(),
  );
  return c.json(part);
});

/**
 * Assembles the object and starts reading it. This is where a source stops
 * being an upload and becomes something the product can work with.
 */
app.post("/api/uploads/:sourceId/complete", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
    durationS?: number;
    diarize?: boolean;
  }>();

  try {
    await completeUpload(c.env.MEDIA, src.r2_key, body.uploadId, body.parts);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "couldn't finish the upload" }, 400);
  }

  const job = await createJob(c.env.DB, { user_id: user.id, type: "transcribe", ref_id: src.id });
  c.executionCtx.waitUntil(
    readSource(c.env, src, {
      plan: user.plan,
      diarize: body.diarize,
      knownDurationS: body.durationS,
      jobId: job.id,
    }).then(() => undefined),
  );
  return c.json({ source: src, jobId: job.id });
});

/** Abandon an upload, releasing the parts R2 is still billing for. */
app.post("/api/uploads/:sourceId/abort", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);
  const uploadId = c.req.header("x-upload-id");
  if (uploadId) await abortUpload(c.env.MEDIA, src.r2_key, uploadId).catch(() => {});
  await c.env.DB.prepare(`UPDATE sources SET deleted_at=? WHERE id=?`).bind(Date.now(), src.id).run();
  return c.json({ ok: true });
});

app.get("/api/sources", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  return c.json({ sources: await listSources(c.env.DB, user.id) });
});

app.get("/api/sources/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);
  return c.json({ source: src, segments: await getSegments(c.env.DB, src.id) });
});

/**
 * What the app understood from a sentence, before committing to it. The regex
 * fast path is enough to answer this without an LLM call.
 */
app.post("/api/intent", async (c) => {
  const { text } = await body<{ text: string }>(c);
  return c.json({ kind: readIntent(text || ""), explain: intentLabel(text || "") });
});

/** Begin — one sentence becomes the right kind of work. */
app.post("/api/begin", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ sourceId: string; brief: string; upgrade: boolean }>(c);
  if (!b.sourceId) return c.json({ error: "pick a video first" }, 400);

  const src = await getSource(c.env.DB, b.sourceId, user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const result = await begin(c.env, {
    userId: user.id,
    sourceId: src.id,
    brief: b.brief || "",
    upgrade: b.upgrade,
  });

  c.executionCtx.waitUntil(
    runScore(c.env, {
      userId: user.id,
      sourceId: src.id,
      projectId: result.projectId,
      brief: b.brief || "",
      jobId: result.jobId,
      upgrade: b.upgrade,
    }),
  );
  return c.json(result);
});

/** The UI polls this for honest staged progress. */
app.get("/api/projects", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  return c.json({ projects: await listProjects(c.env.DB, user.id) });
});

app.get("/api/jobs", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean);
  return c.json({ jobs: ids.length ? await getJobs(c.env.DB, ids) : await activeJobs(c.env.DB, user.id) });
});

/** Owner-only real spend (05-INFRA-AND-COSTS.md; the panel itself is Phase 8). */
app.get("/api/usage/month", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  if (!user.is_owner) return c.json({ error: "not found" }, 404);
  const d = new Date();
  const since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return c.json(await monthUsage(c.env.DB, user.id, since));
});







export default app;
