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
import { renderConfirm, renderLanding } from "./ui/pages/landing.ts";
import { clearStateCookie, finishGoogle, googleConfigured, startGoogle, stateCookie, stateFrom, stateMatches } from "./oauth.ts";
import { page, type ShortsCtx, type View } from "./ui/shell.ts";
import { renderHome } from "./ui/pages/home.ts";
import { emptyState, pageHeading } from "./ui/pages/empty.ts";
import { renderFootageFull, type FootTab, type SearchMode } from "./ui/pages/footage.ts";
import { listMoments, listThreads, searchExact, searchMeaning, threadIdsByClip } from "./library.ts";
import { ulid } from "./id.ts";
import { renderSource } from "./ui/pages/source.ts";
import { editorHeader, renderEditor, type Stage } from "./ui/pages/editor.ts";
import { getProject, listClipsForSource, listProjects, listShorts, putBeats, saveClips, saveCuts, setKept } from "./projects.ts";
import { applyEvent, billingReady, checkoutUrl, portalUrl, verifyWebhook } from "./billing.ts";
import { mayReadMedia } from "./media-auth.ts";
import { quickSearch } from "./search.ts";
import { FONT_FILES } from "./ui/fontbytes.ts";
import { checkStorage, storedBytes } from "./storage.ts";
import { LIMITS, rateLimit, reapRateLimits } from "./ratelimit.ts";
import { createShortRender, shortRendersFor } from "./short-render.ts";
import { cleanTitle, closeAccount, duplicateProject, listTrash, purge, rename, restore, softDelete } from "./library-ops.ts";
import { renderScript } from "./ui/pages/script.ts";
import { renderClipping } from "./ui/pages/clipping.ts";
import { renderBuild, buildSummary } from "./ui/pages/build.ts";
import { renderProjects } from "./ui/pages/projects.ts";
import { renderEditorIntake } from "./ui/pages/editor-intake.ts";
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
import { ASPECTS, CLIP_LENGTHS, type ClipLength, CAPTION_STYLES } from "./shorts.ts";
import { addCuts, fillerCuts, parseCuts, pauseCuts, runtimeAfterCuts, serialiseCuts, timeSaved, toggleSegment, toggleWord } from "./cuts.ts";
import type { CleanUp } from "./ui/pages/editor.ts";
import { createRender, edlForProject, isAspect, isFormat, listRenders, runRender, type Aspect, type Format } from "./render-job.ts";
import { CLIENT_JS } from "./ui/client.ts";
import { SW_JS } from "./ui/sw.ts";
import { currentUser, userForEmail } from "./user.ts";
import { PLANS } from "./plans.ts";
import { abortMultipart, canPresign, completeMultipart, createMultipart, presignPart } from "./r2sign.ts";
import { consume, dispatch } from "./queue.ts";
import { clipCountsBySource, createSource, getSegments, getSource, listSources, isSourceSort, type SourceSort, reapGhostSources } from "./sources.ts";
import { readSource } from "./ingest.ts";
import { abortUpload, completeUpload, partSizeFor, startUpload, uploadPart } from "./upload.ts";
import { activeJobs, createJob, failJob, finishJob, getJobs, latestJobFor, recentlyFinished, startJob, reapStaleJobs } from "./jobs.ts";
import { meter, monthUsage } from "./usage.ts";
import { TTS } from "./models.ts";
import { wavDurationMs } from "./mp3.ts";
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

/**
 * Every HTML page is per-user and live: it renders this account's footage,
 * this account's jobs, and whatever state they are in right now.
 *
 * These responses carried NO cache-control at all, which does not mean "do not
 * cache" — it means the browser applies its own heuristics, and Safari in
 * particular will happily serve a page back for a long while. Two consequences,
 * one cosmetic and one not:
 *
 *   - fixes did not reach a phone that had already loaded the site, which is
 *     how a corrected mobile layout still looked broken
 *   - far worse, a user could be shown a stale Footage list, a job that has
 *     since finished, or an upload that has since landed
 *
 * `private` keeps any shared cache from holding a signed-in page; `no-store`
 * is the honest instruction for something that is different on every request.
 * Static assets keep their own long cache — this only covers HTML.
 */
app.use("*", async (c, next) => {
  await next();
  const type = c.res.headers.get("content-type") || "";
  if (type.includes("text/html")) {
    c.res.headers.set("cache-control", "private, no-store, must-revalidate");
  }
});

/** Health check — no auth, no schema work, so it stays honest when D1 is down. */
app.get("/api/health", (c) => c.json({ ok: true }));

/**
 * The upload service worker.
 *
 * Served from the root so its scope covers every surface — a worker registered
 * at a deeper path could not keep an upload alive across a navigation to a
 * different section, which is the entire reason it exists.
 */
app.get("/sw.js", (c) =>
  c.body(SW_JS, 200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-cache",
    "service-worker-allowed": "/",
  }),
);

/** The client runtime: keyboard map, composer, toasts. Served as a module. */
/**
 * The typefaces.
 *
 * Served by us instead of fetched from fonts.googleapis.com on every page
 * load. Immutable and a year long because a font file for a given weight and
 * subset never changes — and unlike /media this is public by necessity: the
 * landing page has to render in the right type before anyone has signed in.
 */
app.get("/fonts/:name", (c) => {
  const bytes = FONT_FILES[c.req.param("name")];
  if (!bytes) return c.notFound();
  return new Response(bytes, {
    headers: {
      "content-type": "font/woff2",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
});

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

  /*
   * Limited per ADDRESS, not per IP.
   *
   * The harm is someone else's inbox filling with our links and our sending
   * reputation paying for it, and that harm is keyed to the address being
   * targeted — an attacker rotating IPs would sail past an IP limit while
   * doing exactly the same damage to one person.
   */
  const gate = await rateLimit(c.env.DB, `auth:${email}`, LIMITS.authStart);
  if (!gate.ok) return c.redirect("/?error=toomany", 302);

  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const { url, sent } = await startLogin(c.env, email, origin);

  if (sent) return c.redirect(`/?sent=${encodeURIComponent(email)}`, 302);

  /*
   * The mail provider is not configured, so the link was only logged.
   *
   * Handing it back in the response is a DEVELOPMENT convenience and nothing
   * else. In production it is an authentication bypass: type any address,
   * receive that account's login link on screen, and you are them. This
   * shipped that way for a few minutes and anyone could have signed in as the
   * owner — hence the guard, and hence it keys off the same var that already
   * marks a machine as development.
   *
   * Everywhere else, say plainly that sign-in is not available rather than
   * claiming an email was sent.
   */
  if (c.env.DEV_LOGIN_EMAIL) return c.redirect(`/?link=${encodeURIComponent(url)}`, 302);
  return c.redirect("/?error=nomail", 302);
});

/**
 * Following a link shows a confirm page. It does NOT sign anyone in.
 *
 * The token is spent by the POST below, never by this GET. Mail scanners —
 * Outlook Safe Links, antivirus, some clients — fetch URLs before a human
 * clicks them, and a single-use token consumed on GET is already spent by the
 * time the real click arrives. That is the most common way magic links fail in
 * practice, and it is silent: the user sees "expired" on a link they just
 * received.
 *
 * One extra click buys immunity from every automated fetcher, because none of
 * them submit forms.
 */
app.get("/auth/callback", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.redirect("/?error=link", 302);
  return c.html(renderConfirm(token));
});

/** Spends the token and mints the session. */
app.post("/auth/callback", async (c) => {
  await ensureV2Schema(c.env.DB);
  const form = await c.req.parseBody();
  const token = String(form.token ?? "");
  if (!token) return c.redirect("/?error=link", 302);

  const email = await consumeToken(c.env, token);
  if (!email) return c.redirect("/?error=link", 302);

  const user = await userForEmail(c.env.DB, email);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("set-cookie", sessionCookie(await mintSession(c.env, user.id), secure));
  return c.redirect("/", 302);
});

/* ── Sign in with Google ───────────────────────────────────────────────
 * The primary path. See src/oauth.ts for why this exists rather than the
 * email link alone. */

app.get("/auth/google", async (c) => {
  if (!googleConfigured(c.env)) return c.redirect("/?error=nogoogle", 302);

  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const { url, state } = startGoogle(c.env, origin);
  c.header("set-cookie", stateCookie(state, new URL(c.req.url).protocol === "https:"));
  return c.redirect(url, 302);
});

app.get("/auth/google/callback", async (c) => {
  await ensureV2Schema(c.env.DB);
  const secure = new URL(c.req.url).protocol === "https:";

  // The state cookie is single-use whatever happens next.
  c.header("set-cookie", clearStateCookie(secure));

  /*
   * Verify state BEFORE spending the code. Without this an attacker can run a
   * sign-in to completion in someone else's browser and silently leave them
   * inside the attacker's account, where anything they upload is visible.
   */
  if (!stateMatches(c.req.query("state"), stateFrom(c.req.header("cookie")))) {
    return c.redirect("/?error=google", 302);
  }

  const code = c.req.query("code");
  if (!code) return c.redirect("/?error=google", 302);

  const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
  const who = await finishGoogle(c.env, code, origin);
  if (!who) return c.redirect("/?error=google", 302);

  const user = await userForEmail(c.env.DB, who.email, who.name);
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
        google: googleConfigured(c.env),
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
        /* A job whose source has been deleted is not work in progress — it is
           a leftover. Showing it produced "reading a video and a video". */
        working: jobs
          .filter((j) => !j.ref_id || byId.has(j.ref_id) || projects.some((p) => p.id === j.ref_id))
          .map((j) => ({
            label:
              byId.get(j.ref_id ?? "")?.title ??
              projects.find((p) => p.id === j.ref_id)?.title ??
              "a video",
            type: j.type,
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
  /*
   * Videos first, not Clips.
   *
   * The prototype opens on Clips; the owner's actual use is the opposite —
   * clicking Footage is nearly always "find the video I uploaded so I can edit
   * it", and landing on a wall of clips buries that. Their call, and a
   * deliberate departure from the prototype rather than a slip.
   */
  const tab: FootTab =
    t === "threads" ? "threads" : t === "moments" ? "moments" : t === "find" ? "find" : "sources";
  const mode: SearchMode = c.req.query("mode") === "exact" ? "exact" : "meaning";
  const query = (c.req.query("q") || "").trim();
  const thread = c.req.query("thread") || null;

  /*
   * Every tab carries its count, so all three lists are needed on every tab,
   * not just the one being shown. They are small — threads and sources are
   * tens of rows — and loading only the active tab left the other two reading
   * "Threads" with no number, which looks like zero.
   */
  const sort = isSourceSort(c.req.query("sort")) ? (c.req.query("sort") as SourceSort) : "newest";
  const sources = await listSources(c.env.DB, user.id, sort);
  const threads = await listThreads(c.env.DB, user.id);

  /* Live read progress per source, so a row that is being read shows a moving
     bar instead of a static word. The jobs are already being loaded for the
     nav; this just joins them up. */
  const reading = await activeJobs(c.env.DB, user.id);
  const pctFor = new Map(reading.filter((j) => j.type === "transcribe").map((j) => [j.ref_id, j.pct]));

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
      renderFootageFull({
        tab,
        sources: sources.map((s) => ({ ...s, pct: pctFor.get(s.id) })),
        moments, threads, mode, q: query, meaningUnavailable, thread, sort,
      }),
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

/**
 * Opening a video.
 *
 * This used to be a read-only transcript with three buttons on top, and the
 * owner's verdict was exact: "when i click the video it just takes me to the
 * transcript page. that's not what should happen." They were right, and the
 * reason is worse than a design slip — THERE IS NO SUCH PAGE IN THE DESIGN.
 * The reference captures go Footage → editor. I invented a reading surface,
 * put it between the user and the work, and it did nothing but display text.
 *
 * So opening a video opens the editor on it. begin() with no brief is
 * idempotent — it reuses the existing edit rather than making another — so
 * this resolves to the same workspace every time rather than breeding
 * "Untitled cut" rows, and it runs no scoring pass, because the user asked to
 * open their video, not to be told what a model thinks of it.
 *
 * A redirect adds no history entry, so Back from the editor goes to Footage
 * rather than bouncing through here again.
 *
 * The page still renders for a video that is not readable yet — while it is
 * being read, and when the read failed and there is a retry to offer. There is
 * genuinely nothing to edit in either case.
 */
app.get("/sources/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.notFound();

  if (src.transcript_state === "ready") {
    const { href } = await begin(c.env, {
      userId: user.id,
      sourceId: src.id,
      brief: "",
      sourceTitle: src.title,
    });
    return c.redirect(href, 302);
  }

  /* The LATEST job, not the active one: this page renders the failed state and
     needs the reason that failure recorded, which activeJobs can never
     return. */
  const [segments, job] = await Promise.all([
    getSegments(c.env.DB, src.id),
    latestJobFor(c.env.DB, src.id, user.id, ["transcribe"]),
  ]);

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
/**
 * Serves media out of R2.
 *
 * RANGE REQUESTS MATTER HERE. The design routes preview playback through
 * Cloudflare Stream; we serve from R2 instead, because Stream bills per minute
 * both stored and delivered and the design's own costs page warns that putting
 * originals there is "the single easiest way to make this product
 * unprofitable". That is the right call — but Stream was also doing something
 * for us, and this is it: a `<video>` element cannot seek without ranges, and
 * Safari will not begin playback at all without a 206. Serving the whole
 * object every time was fine for posters and quietly broke video.
 */
/**
 * Media, for the person it belongs to and nobody else.
 *
 * This route used to serve any object to any caller with the URL. See
 * src/media-auth.ts for why that is worse than it sounds.
 *
 * 404 rather than 401 or 403, for both "not signed in" and "not yours": a 403
 * confirms the object exists, which is a small oracle over unguessable keys,
 * and there is nothing a caller can usefully do with the distinction. It also
 * keeps <img> and <video> failing quietly instead of following a redirect to
 * the landing page and rendering it as a broken image.
 *
 * No requireUser() here for the same reason — it redirects, and a redirect is
 * the wrong answer to a subresource fetch.
 */
app.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/media\//, "");

  const user = await currentUser(c.env, c.req.header("cookie"));
  if (!user || !(await mayReadMedia(c.env.DB, user.id, key))) return c.notFound();

  const range = c.req.header("range");

  if (range) {
    // Only `bytes=start-` and `bytes=start-end` occur in practice; anything
    // else falls through to a normal 200, which is a legal answer to a range
    // request and better than guessing.
    const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    if (m) {
      const offset = Number(m[1]);
      const end = m[2] ? Number(m[2]) : undefined;
      const object = await c.env.MEDIA.get(key, {
        range: end === undefined ? { offset } : { offset, length: end - offset + 1 },
      });
      if (!object) return c.notFound();

      const total = object.size;
      const last = end === undefined ? total - 1 : Math.min(end, total - 1);
      return new Response(object.body, {
        status: 206,
        headers: {
          "content-type": object.httpMetadata?.contentType || "application/octet-stream",
          "content-range": `bytes ${offset}-${last}/${total}`,
          "content-length": String(last - offset + 1),
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(object.size),
      /* ?download=1 saves the file instead of playing it in the tab. The name
         is the last path segment, which for a render is its id plus extension
         — not pretty, but it is the file you asked for and it is honest. */
      ...(c.req.query("download")
        ? { "content-disposition": `attachment; filename="${(key.split("/").pop() || "video.mp4").replace(/[^\w.\-]/g, "_")}"` }
        : {}),
      // Advertised even on a full response: without it a browser will not
      // attempt a range request, so seeking never starts.
      "accept-ranges": "bytes",
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
  await dispatch(c.env, c.executionCtx, {
    type: "transcribe", jobId: job.id, userId: user.id, sourceId: src.id, plan: user.plan,
  });
  return c.redirect(`/sources/${src.id}`, 303);
});

app.get("/clipping", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const sources = await listSources(c.env.DB, user.id);
  const sourceId = c.req.query("source");
  const source = sourceId ? (sources.find((s) => s.id === sourceId) ?? null) : null;

  /*
   * Only what Clipping produced — the editor's kept clips are a different
   * thing and belong in Footage, not mixed in here.
   *
   * With no video chosen this is every short across the library rather than
   * an empty list, so landing on Clipping shows what you have made rather than
   * asking you to remember which video you made it from.
   */
  const shorts = (
    source
      ? await listClipsForSource(c.env.DB, source.id, user.id)
      : await listShorts(c.env.DB, user.id)
  ).filter((cl) => cl.origin === "clipping");

  /* Whether each one has actually been made into a video yet. Without this the
     cards could only ever show a still and a play button that did nothing. */
  const renders = await shortRendersFor(c.env.DB, user.id, shorts.map((cl) => cl.id));
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
        shorts: shorts.map((cl) => ({ ...cl, render: renders.get(cl.id) ?? null })),
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
  await dispatch(c.env, c.executionCtx, {
    type: "shorts",
    jobId: job.id,
    userId: user.id,
    sourceId: src.id,
    length,
    count: Number(b.count) || 8,
    query: b.query,
  });
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

  /*
   * WHOSE CLIPS ARE THESE?
   *
   * v2_clips hangs off the SOURCE, not the project — it is the moment library
   * behind Footage's Clips tab, which is the right shape for a library and
   * the wrong shape for an edit. The consequence was visible and baffling:
   * open a video you never asked anything of and it showed you eleven scored
   * clips with a model's reasons attached, because some earlier briefed edit
   * of the same footage had left them there. Four edits of one video all read
   * "11 clips kept · 5:00" because they were all counting one shared set.
   *
   * An edit with no brief asked for no pass, so it has no clips of its own and
   * must not borrow anyone else's. It renders the transcript instead. A briefed
   * edit is the one that ran a pass and the one that gets the scored blocks.
   *
   * This is a scope fix, not the cure: two BRIEFED edits of the same source
   * still share one `kept` flag, because clip ownership is genuinely wrong in
   * the schema. See docs/decisions/clip-ownership.md.
   */
  const isScratch = !project.brief?.trim();
  const clips = source && !isScratch ? await listClipsForSource(c.env.DB, source.id, user.id) : [];

  /* This edit's exports. Loaded for every stage, because "where did my video
     go" is a question you can ask from any of them. */
  const renders = await listRenders(c.env.DB, project.id);

  /*
   * The Clean up chips' sublabels carry live numbers, so they are computed
   * from the real transcript. A chip whose number cannot be computed honestly
   * shows its descriptive text and stays disabled rather than displaying a
   * fabricated count.
   */
  let cleanUps: CleanUp[] = [];
  /* Pick renders these directly when no pass has run — an unassisted cut's
     blocks are the transcript itself. */
  let pickSegments: Awaited<ReturnType<typeof getSegments>> = [];
  if (source && stage === "cut") {
    const segs = await getSegments(c.env.DB, source.id);
    pickSegments = segs;
    const cuts = parseCuts(project.cuts);
    /* Only quote a saving that is worth quoting. Under a second this printed
       "11 found · −0:00", which reads as a broken number rather than as "not
       much" — and the count on its own is the honest thing to say. */
    const minus = (ms: number) =>
      ms >= 1000 ? `−${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` : "";

    const fillers = fillerCuts(segs);
    const fillersLeft = fillers.filter((f) => !cuts.some((x) => x.seg === f.seg && x.words?.[0] === f.words?.[0]));
    const pauses = pauseCuts(segs);
    const pausesLeft = pauses.filter((p2) => !cuts.some((x) => x.seg === p2.seg && x.words?.[0] === p2.words?.[0]));

    /*
     * Only clean-ups that can actually run.
     *
     * "Studio sound" and "Cut everything it flagged" were rendered permanently
     * greyed, because neither is built — the enhance pass is not wired up and
     * nothing flags weak stretches yet. A button that is disabled forever and
     * never says why reads as a broken product, which is exactly how the owner
     * read it. Same rule as "Queue it" on Build: it appears when it works.
     */
    cleanUps = [
      {
        id: "fillers",
        name: "Remove the ums and uhs",
        sub: fillersLeft.length
          ? [`${fillersLeft.length} found`, minus(timeSaved(segs, cuts, fillersLeft))].filter(Boolean).join(" · ")
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
          ? ["anything over 2s", minus(timeSaved(segs, cuts, pausesLeft))].filter(Boolean).join(" · ")
          : pauses.length
            ? "tightened"
            : "none over 2s",
        ready: pausesLeft.length > 0,
        done: pauses.length > 0 && pausesLeft.length === 0,
      },
    ].filter((chip) => chip.ready || chip.done);
  }
  /* Same as the source page: renderEditor has a failed branch, and looking the
     job up through activeJobs meant that branch could never fire — a scoring
     pass that died showed an empty cut with no explanation. */
  const job = await latestJobFor(c.env.DB, project.id, user.id, ["score", "pass"]);

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
            sourceKey: source?.r2_key ?? null,
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
        /* The transcript, for a cut that never had a pass run over it. */
        segments: pickSegments.map((sg) => ({
          idx: sg.idx, start_ms: sg.start_ms, end_ms: sg.end_ms, text: sg.text,
        })),
        cuts: parseCuts(project.cuts),
        runtimeAfterCutsMs: pickSegments.length
          ? runtimeAfterCuts(pickSegments, parseCuts(project.cuts)) * 1000
          : undefined,
        sourcePoster: source?.poster_r2_key ?? null,
        sourceKey: source?.r2_key ?? null,
        sourceId: source?.id ?? null,
        plan: user.plan,
        renders,
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
  const b = await body<{ projectId: string; format: Format; aspect: Aspect; captionStyle?: string }>(c);
  if (!b.projectId) return c.json({ error: "which project?" }, 400);

  const project = await getProject(c.env.DB, b.projectId, user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  /*
   * Validate, and enforce the plan.
   *
   * This took whatever it was handed and defaulted anything falsy, so a
   * request could name any format string at all — and 4K, which Settings
   * sells as a Studio feature, was renderable by a free account that posted
   * it directly. A gate that only exists in the interface is not a gate.
   */
  const format = isFormat(b.format) ? b.format : "mp4_1080";
  const aspect = isAspect(b.aspect) ? b.aspect : "16:9";

  if (format === "mp4_4k" && user.plan === "free") {
    return c.json({ error: "4K renders are on Studio. 1080p is available on Free." }, 402);
  }

  /* Captions are opt-in. An unrecognised value is treated as no captions
     rather than as a style, so a bad request cannot burn text into a video. */
  const captionStyle = CAPTION_STYLES.includes(b.captionStyle as never) ? b.captionStyle : "None";

  const render = await createRender(c.env.DB, {
    user_id: user.id,
    project_id: project.id,
    format,
    aspect,
    captionStyle,
  });
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: project.id });

  await dispatch(c.env, c.executionCtx, {
    type: "render", jobId: job.id, userId: user.id, projectId: project.id, renderId: render.id,
  });
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

  const b = await body<{ at: number; kind: string; text: string; clipId: string; act: string }>(c);
  const kind = (["clip", "vo", "react", "generated", "stock"] as const).find((k) => k === b.kind) ?? "vo";

  /* Added from the "Add a beat" panel rather than a seam, so it goes on the
     end — `at` is only sent when a specific seam was clicked. */
  const existing = await getBeats(c.env.DB, project.id);
  const at = b.at == null ? existing.length : Number(b.at);

  const beats = await insertBeat(c.env.DB, project.id, at, {
    kind,
    act: b.act ?? null,
    text: b.text ?? null,
    clip_id: b.clipId ?? null,
  });
  return c.json({ beats });
});

/**
 * Edit what a beat says.
 *
 * The textarea on every beat was rendered, editable, and wired to nothing —
 * you could type into it and the words were gone on reload. Saved on blur
 * rather than per keystroke: this is prose being written.
 */
app.post("/api/projects/:id/beats/:beatId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ text: string; clearMedia?: boolean; clipId?: string }>(c);
  const beatId = c.req.param("beatId");

  /*
   * "Swap clip" / "Pick from Footage" — point this beat at a different moment.
   *
   * There was no way to do this at all: a clip beat's clip was set when the
   * beat was created and could never be changed, while four buttons offering
   * exactly that rendered on every beat and did nothing.
   */
  if (b.clipId) {
    const owned = await c.env.DB
      .prepare(`SELECT id FROM v2_clips WHERE id=? AND user_id=? AND deleted_at IS NULL`)
      .bind(b.clipId, user.id)
      .first<{ id: string }>();
    if (!owned) return c.json({ error: "not found" }, 404);

    await c.env.DB
      .prepare(`UPDATE beats SET clip_id=?, kind='clip' WHERE id=? AND project_id=?`)
      .bind(b.clipId, beatId, project.id)
      .run();
    return c.json({ ok: true });
  }

  /*
   * "Redo" — throw the take away so Record comes back.
   *
   * The recording is deleted from R2 rather than merely unlinked. It is being
   * explicitly discarded by the person who made it, and an unlinked object is
   * invisible to every cleanup path in the product, so leaving it would mean
   * every abandoned take billed forever with nothing able to find it again.
   */
  if (b.clearMedia) {
    const beat = await c.env.DB
      .prepare(`SELECT media_r2_key FROM beats WHERE id=? AND project_id=?`)
      .bind(beatId, project.id)
      .first<{ media_r2_key: string | null }>();

    if (beat?.media_r2_key) await c.env.MEDIA.delete(beat.media_r2_key).catch(() => {});
    await c.env.DB
      .prepare(`UPDATE beats SET media_r2_key=NULL, recorded_at=NULL, dur_ms=NULL WHERE id=? AND project_id=?`)
      .bind(beatId, project.id)
      .run();
    return c.json({ ok: true });
  }

  await c.env.DB
    .prepare(`UPDATE beats SET text=? WHERE id=? AND project_id=?`)
    .bind(b.text ?? null, beatId, project.id)
    .run();
  return c.json({ ok: true });
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
  await dispatch(c.env, c.executionCtx, {
    type: "reactions", jobId: job.id, userId: user.id, projectId: project.id, about,
  });
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
  await dispatch(c.env, c.executionCtx, {
    type: "outline", jobId: job.id, userId: user.id, projectId: project.id, topic,
  });
  return c.json({ jobId: job.id });
});

/**
 * Generate the voice for a beat.
 *
 * Backs the "Generate it" control on a beat that wants your voice. That button
 * shipped visible and wired to nothing, because the design specified
 * ElevenLabs-with-your-own-key — a reasonable upgrade and a bad default, since
 * it leaves a core control dead until the user has gone and got a third-party
 * account.
 *
 * This is Workers AI, so it works out of the box. It is not a cloned voice and
 * the UI does not claim otherwise: Record is still offered as the real answer,
 * and this fills the beat so the cut can be watched end to end.
 */
app.post("/api/beats/:id/tts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const beat = await c.env.DB
    .prepare(
      `SELECT b.* FROM beats b JOIN v2_projects p ON p.id = b.project_id
        WHERE b.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
    )
    .bind(c.req.param("id"), user.id)
    .first<{ id: string; project_id: string; text: string | null }>();
  if (!beat) return c.json({ error: "not found" }, 404);

  const text = (beat.text ?? "").trim();
  if (!text) return c.json({ error: "there's nothing written on this beat yet" }, 400);

  try {
    /*
     * `lang` is required by this model; without it the call fails with a bare
     * "3043: Internal server error" that names nothing. Measured, not assumed.
     *
     * Retried with backoff, because this model returns an opaque "3043:
     * Internal server error" under load. That reads like flakiness and is not:
     * measured at 3/6 when called back to back, and 3/3 when the same calls
     * are spaced twelve seconds apart. It is a rate limit wearing a 500's
     * clothing, so the backoff is in seconds — retrying fast just spends every
     * attempt inside the same closed window.
     */
    let out: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        out = await c.env.AI.run(TTS.id as never, { prompt: text, lang: "en" } as never);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        // Seconds, not milliseconds — see the note above. Retrying fast
        // against a rate limit just spends the remaining attempts inside the
        // same closed window.
        await new Promise((r) => setTimeout(r, [1000, 3000, 6000][attempt]));
      }
    }

    // The model returns base64 audio on this route; tolerate a raw body too
    // rather than assuming one shape and failing opaquely if it changes.
    let bytes: Uint8Array;
    if (out instanceof ArrayBuffer) {
      bytes = new Uint8Array(out);
    } else if (out && typeof out === "object" && "audio" in out && typeof out.audio === "string") {
      const bin = atob(out.audio);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(await new Response(out as ReadableStream).arrayBuffer());
    }
    if (!bytes.byteLength) return c.json({ error: "nothing came back" }, 502);

    /*
     * This model returns WAV, not MP3. Naming it .mp3 and labelling it
     * audio/mpeg would be a lie about the bytes — the browser mostly copes,
     * but the render container is handed the file by name and building a
     * concat plan around a mislabelled stream is how a render fails at the
     * last step for no visible reason.
     */
    const key = `u/${user.id}/beats/${beat.id}/generated.wav`;
    await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "audio/wav" } });

    /*
     * Duration comes out of the WAV header, exactly. Left at zero, Build's
     * timecodes, its runtime and every segment width in the preview scrubber
     * read wrong — the same defect that made the whole surface show "0:00"
     * when clip beats were written without it.
     */
    await setBeatMedia(c.env.DB, beat.id, key, wavDurationMs(bytes));
    await meter(c.env.DB, { user_id: user.id, job_type: "tts", cpu_ms: 0 });

    return c.json({ ok: true, key });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "couldn't generate that" }, 502);
  }
});

/** Keep or drop a block. Undoable — nothing here hard-deletes. */
/** The moments available to a beat — what the clip picker offers. */
app.get("/api/projects/:id/clips", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project?.source_id) return c.json({ clips: [] });

  const clips = await listClipsForSource(c.env.DB, project.source_id, user.id);
  return c.json({
    clips: clips.map((cl) => ({
      id: cl.id,
      quote: cl.quote,
      start_ms: cl.start_ms,
      end_ms: cl.end_ms,
      frame_r2_key: cl.frame_r2_key,
    })),
  });
});

/**
 * Make the actual video of one short.
 *
 * On demand, one at a time. Rendering everything a scoring pass found would
 * spend real money on videos nobody asked for, and the product's own rule is
 * that nothing renders until you say so.
 */
app.post("/api/clips/:id/render", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const clip = await c.env.DB
    .prepare(`SELECT id FROM v2_clips WHERE id=? AND user_id=? AND deleted_at IS NULL`)
    .bind(c.req.param("id"), user.id)
    .first<{ id: string }>();
  if (!clip) return c.json({ error: "not found" }, 404);

  const b = await body<{ aspect?: string; captionStyle?: string }>(c);
  /* Unrecognised values fall back rather than reaching ffmpeg: 9:16 because a
     short is vertical, and no captions because burned-in text cannot be taken
     back out of a finished file. */
  const aspect = ASPECTS.includes(b.aspect as never) ? (b.aspect as string) : "9:16";
  const captionStyle = CAPTION_STYLES.includes(b.captionStyle as never) ? (b.captionStyle as string) : "None";

  const renderId = await createShortRender(c.env.DB, { userId: user.id, clipId: clip.id, aspect, captionStyle });
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: clip.id });

  await dispatch(c.env, c.executionCtx, {
    type: "short-render", jobId: job.id, userId: user.id, clipId: clip.id, renderId,
  });
  return c.json({ ok: true, renderId, jobId: job.id });
});

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
  await dispatch(c.env, c.executionCtx, {
    type: "score",
    jobId: job.id,
    userId: user.id,
    sourceId: project.source_id,
    projectId: project.id,
    brief: instruction,
  });
  return c.json({ jobId: job.id });
});

/**
 * The editor with no project is not a real destination — the nav item exists
 * because the editor is a verb, but you reach a stage through a project. With
 * nothing made yet, say so plainly rather than 404ing.
 */
/**
 * The editor with nothing open — the intake state.
 *
 * See docs/reference/06-editor-intake.png. This rendered as a heading and one
 * line of grey text until the owner pointed out that Editor and Clipping look
 * like blank screens rather than tools before you have uploaded anything. They
 * were right, and so was the design: this state was drawn and I missed it.
 */
app.get("/editor", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const [sources, projects, clipCounts] = await Promise.all([
    listSources(c.env.DB, user.id),
    listProjects(c.env.DB, user.id),
    clipCountsBySource(c.env.DB, user.id),
  ]);

  const byId = new Map(sources.map((s) => [s.id, s]));
  const live = projects.filter((p) => !p.archived_at).sort((a, b) => b.updated_at - a.updated_at);

  /*
   * An edit's own numbers, not its source's.
   *
   * Every row read "11 clips kept · 5:00 so far" because every row counted the
   * clips on the SOURCE — so four different edits of one video reported four
   * identical figures and the list was impossible to tell apart. A scratch
   * edit has no clips at all; what it has is its own cuts, and its runtime is
   * the transcript minus them.
   *
   * Segments are fetched once per source rather than once per edit, since
   * several edits of the same video are the normal case here.
   */
  const shown = live.slice(0, 6);
  const scratchSources = [
    ...new Set(shown.filter((p) => !p.brief?.trim() && p.source_id).map((p) => p.source_id as string)),
  ];
  const segsBySource = new Map(
    await Promise.all(
      scratchSources.map(async (id) => [id, await getSegments(c.env.DB, id)] as const),
    ),
  );

  const edits = await Promise.all(
    shown.map(async (p) => {
      const isScratch = !p.brief?.trim();

      if (isScratch && p.source_id) {
        const segs = segsBySource.get(p.source_id) ?? [];
        const cuts = parseCuts(p.cuts);
        const dropped = new Set(cuts.filter((x) => x.words === null).map((x) => x.seg));
        const keptSegs = segs.filter((sg) => !dropped.has(sg.idx));
        return {
          id: p.id,
          title: p.title,
          poster_r2_key: p.poster_r2_key ?? byId.get(p.source_id)?.poster_r2_key ?? null,
          sourceFilename: byId.get(p.source_id)?.filename ?? null,
          kept: keptSegs.length,
          runtime_s: segs.length ? Math.round(runtimeAfterCuts(segs, cuts)) : null,
          updated_at: p.updated_at,
          scratch: true,
        };
      }

      const clips = p.source_id ? await listClipsForSource(c.env.DB, p.source_id, user.id) : [];
      const kept = clips.filter((cl) => cl.kept);
      return {
        id: p.id,
        title: p.title,
        // A project borrows its first clip's frame until it has been rendered,
        // for the same reason Projects does: a black rectangle stops the
        // surface reading as a video tool.
        poster_r2_key: p.poster_r2_key ?? kept[0]?.frame_r2_key ?? null,
        sourceFilename: p.source_id ? (byId.get(p.source_id)?.filename ?? null) : null,
        kept: kept.length,
        runtime_s: kept.length
          ? Math.round(kept.reduce((n, cl) => n + (cl.end_ms - cl.start_ms), 0) / 1000)
          : null,
        updated_at: p.updated_at,
        scratch: false,
      };
    }),
  );

  return c.html(
    surface(
      "cut",
      "Cutting room",
      "Editor — Aldershot",
      renderEditorIntake({
        sources: sources.map((s) => ({
          id: s.id, title: s.title, duration_s: s.duration_s,
          poster_r2_key: s.poster_r2_key, transcript_state: s.transcript_state,
          clip_count: clipCounts.get(s.id) ?? 0,
        })),
        edits,
      }),
    ),
  );
});

/*
 * Rename, delete, restore — for an edit and for a video.
 *
 * One shape for both, because they are the same three verbs and a user who
 * learns them on one should not have to learn them again on the other.
 */
const ENTITY_PATH = { projects: "project", sources: "source" } as const;

app.post("/api/:kind{projects|sources}/:id/rename", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const entity = ENTITY_PATH[c.req.param("kind") as keyof typeof ENTITY_PATH];

  const title = cleanTitle((await body<{ title: string }>(c)).title ?? "");
  /* An empty name is not a name. Refusing beats silently storing "" and
     rendering a row nobody can identify. */
  if (!title) return c.json({ error: "give it a name" }, 400);

  const ok = await rename(c.env.DB, entity, c.req.param("id"), user.id, title);
  return ok ? c.json({ ok: true, title }) : c.json({ error: "not found" }, 404);
});

app.post("/api/:kind{projects|sources}/:id/delete", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const entity = ENTITY_PATH[c.req.param("kind") as keyof typeof ENTITY_PATH];

  const { ok, label } = await softDelete(c.env.DB, entity, c.req.param("id"), user.id);
  return ok ? c.json({ ok: true, label }) : c.json({ error: "not found" }, 404);
});

/** Set your own name. The greeting has nowhere else to get one. */
app.post("/api/account/name", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const name = cleanTitle((await body<{ name: string }>(c)).name ?? "").slice(0, 60);
  await c.env.DB.prepare(`UPDATE v2_users SET name=? WHERE id=?`).bind(name || null, user.id).run();
  return c.json({ ok: true, name: name || null });
});

/**
 * Close the account. Irreversible, and total.
 *
 * You cannot sell a subscription to an account nobody can close, and the
 * right to erasure is not optional for anyone selling into the EU or UK.
 * The typed email is re-checked server-side — "the interface asked" is not a
 * safeguard an API can rely on.
 */
app.post("/api/account/close", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const { ok, error } = await closeAccount(c.env, user.id, (await body<{ email: string }>(c)).email ?? "");
  if (!ok) return c.json({ error: error ?? "couldn't close that" }, 400);

  /* Clear the cookie on the way out, or the next request is a session for a
     user that no longer exists. */
  return c.json({ ok: true }, 200, { "set-cookie": clearCookie(new URL(c.req.url).protocol === "https:") });
});

/** Try something else without losing the cut you already have. */
app.post("/api/projects/:id/duplicate", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const copy = await duplicateProject(c.env.DB, c.req.param("id"), user.id);
  return copy ? c.json({ ok: true, ...copy, href: `/p/${copy.id}/pick` }) : c.json({ error: "not found" }, 404);
});

/**
 * Empty one thing out of the bin for good, and free what it was holding.
 *
 * The ONLY path in this product that removes a byte from R2. Deliberately
 * reachable from one place — the deleted pile — and only for something
 * already deleted, so it takes two decisions rather than one.
 */
/**
 * Empty the bin.
 *
 * Purging was one item at a time, which is the wrong shape for the one job a
 * bin exists to do. Each item still goes through purge() rather than a bulk
 * query, because that function is where the refusals live — a second way to
 * remove things is always the one that misses a rule the first one enforces.
 */
app.post("/api/trash/empty", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  let freedBytes = 0;
  let removed = 0;
  for (const row of await listTrash(c.env.DB, user.id, 200)) {
    const out = await purge(c.env, row.entity, row.entity_id, user.id);
    if (out.ok) {
      freedBytes += out.freedBytes;
      removed += 1;
    }
  }
  return c.json({ ok: true, removed, freedBytes });
});

app.post("/api/:kind{projects|sources}/:id/purge", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const entity = ENTITY_PATH[c.req.param("kind") as keyof typeof ENTITY_PATH];

  const { ok, freedBytes } = await purge(c.env, entity, c.req.param("id"), user.id);
  return ok ? c.json({ ok: true, freedBytes }) : c.json({ error: "not in the deleted pile" }, 404);
});

app.post("/api/:kind{projects|sources}/:id/restore", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const entity = ENTITY_PATH[c.req.param("kind") as keyof typeof ENTITY_PATH];

  await restore(c.env.DB, entity, c.req.param("id"), user.id);
  return c.json({ ok: true });
});

/**
 * What the nav's "Ask for anything" asks.
 *
 * Deliberately not the meaning search: that embeds the query and costs a
 * Workers AI call, which is fine once and wrong on every keystroke. See
 * src/search.ts.
 */
app.get("/api/search", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  return c.json({ hits: await quickSearch(c.env.DB, user.id, c.req.query("q") || "") });
});

/** What the bell knows: what is running, and what finished while you were away. */
app.get("/api/notifications", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const [running, done] = await Promise.all([
    activeJobs(c.env.DB, user.id),
    recentlyFinished(c.env.DB, user.id),
  ]);
  return c.json({ running, done });
});

/*
 * Billing.
 *
 * Three routes and no more: somewhere to start paying, somewhere to stop, and
 * the webhook that is the only thing allowed to change what an account is
 * entitled to.
 */

/** Start a subscription. Answers with a URL rather than redirecting, because
    the button is scripted like every other action on Settings. */
app.post("/api/billing/checkout", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  if (!billingReady(c.env)) return c.json({ error: "billing isn't switched on yet" }, 503);

  try {
    const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    return c.json({ url: await checkoutUrl(c.env, user, origin) });
  } catch {
    /* stripe() has already logged Stripe's own message, which can name
       internal ids. The customer gets something they can act on. */
    return c.json({ error: "couldn't open checkout — try again in a moment" }, 502);
  }
});

/** Manage or cancel an existing subscription, on Stripe's own portal. */
app.post("/api/billing/portal", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  if (!billingReady(c.env)) return c.json({ error: "billing isn't switched on yet" }, 503);

  try {
    const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    return c.json({ url: await portalUrl(c.env, user, origin) });
  } catch {
    return c.json({ error: "couldn't open your billing page — try again in a moment" }, 502);
  }
});

/**
 * Stripe's webhook. THE ONLY THING THAT GRANTS A PLAN.
 *
 * Unauthenticated by necessity — Stripe has no session — so the signature IS
 * the authentication. An unverified body here would let anyone on the internet
 * POST themselves a subscription, so a missing secret is a refusal rather than
 * a skipped check.
 *
 * The RAW body is read and passed through unparsed: the signature covers the
 * exact bytes Stripe sent, and re-serialising parsed JSON changes them.
 *
 * Always 200 once verified, even when the event is one we ignore. A non-2xx
 * tells Stripe to retry, and retrying an event nobody handles just fills the
 * log until Stripe disables the endpoint.
 */
app.post("/webhooks/stripe", async (c) => {
  await ensureV2Schema(c.env.DB);

  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    console.log("[billing] webhook hit with no STRIPE_WEBHOOK_SECRET set — refusing");
    return c.text("billing not configured", 503);
  }

  const raw = await c.req.text();
  const ok = await verifyWebhook(c.env.STRIPE_WEBHOOK_SECRET, raw, c.req.header("stripe-signature") ?? null);
  if (!ok) {
    console.log("[billing] webhook signature did not verify");
    return c.text("bad signature", 400);
  }

  try {
    const outcome = await applyEvent(c.env, JSON.parse(raw));
    console.log(`[billing] ${outcome}`);
  } catch (err) {
    /* The event was genuinely from Stripe but we could not apply it. That is
       our bug, and it IS worth a retry. */
    console.log(`[billing] couldn't apply event: ${(err as Error).message}`);
    return c.text("could not apply", 500);
  }
  return c.text("ok");
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
  /* Storage is what is held, not what was added this month — a video uploaded
     in March still occupies a disk in April. This summed the month, so an
     account near its limit read as nearly empty every 1st. */
  const storedNow = await storedBytes(c.env.DB, user.id);

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
      used: Math.round((storedNow / 1e9) * 10) / 10,
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
      renderSettings({ name: user.name, email: user.email, plan: user.plan, isOwner: !!user.is_owner, meters, cost, billingReady: billingReady(c.env), trash: await listTrash(c.env.DB, user.id) }),
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
  await dispatch(c.env, c.executionCtx, { type: "transcribe", sourceId: src.id, userId: user.id, ...opts });

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
  const b = await body<{ filename: string; contentType: string; bytes: number }>(c);
  const filename = b.filename || "upload.mp4";

  /*
   * THE CAP, BEFORE THE BYTES.
   *
   * There was no check here at all: this created the source, opened the
   * multipart upload and returned. The only refusal in the product is
   * checkCap, which counts processing MINUTES and runs at transcribe time —
   * after the file has landed. So it refused the cheap thing and permitted the
   * expensive one, and a refused upload was still billed storage for ever.
   */
  const rate = await rateLimit(c.env.DB, `upload:${user.id}`, LIMITS.upload);
  if (!rate.ok) {
    return c.json({ error: "That is a lot of uploads at once — give it a minute." }, 429, {
      "retry-after": String(rate.retryAfterS),
    });
  }

  const room = await checkStorage(c.env.DB, user.id, user.plan, Number(b.bytes) || 0);
  if (!room.ok) return c.json({ error: room.message }, 413);

  const src = await createSource(c.env.DB, { user_id: user.id, filename, origin: "upload" });
  const partSize = partSizeFor(b.bytes);

  /*
   * Prefer sending the bytes straight to R2.
   *
   * The Worker's job is to say who may write where, which is exactly what a
   * presigned URL is — streaming gigabytes through it as well is work nobody
   * needs. Falls back to the through-Worker path when the R2 API credentials
   * are absent, so the product still uploads on a deployment that has not been
   * given them.
   */
  let uploadId: string | null = null;
  let mode: "direct" | "worker" = "worker";

  if (canPresign(c.env)) {
    uploadId = await createMultipart(c.env, src.r2_key, b.contentType);
    if (uploadId) mode = "direct";
  }
  if (!uploadId) {
    const started = await startUpload(c.env.MEDIA, src.r2_key, b.contentType, b.bytes);
    uploadId = started.uploadId;
  }

  // Remembered server-side so a browser that reloads, crashes, or comes back
  // tomorrow can ask what is already stored instead of starting over.
  await c.env.DB
    .prepare(
      `INSERT OR REPLACE INTO uploads (source_id,user_id,upload_id,part_size,total_bytes,filename,mode,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(src.id, user.id, uploadId, partSize, b.bytes ?? null, filename, mode, Date.now())
    .run();

  return c.json({ source: src, uploadId, key: src.r2_key, partSize, mode });
});

/** One part. Part numbers are 1-indexed; order does not matter. */
app.put("/api/uploads/:sourceId/parts/:n", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const uploadId = c.req.header("x-upload-id");
  if (!uploadId) return c.json({ error: "missing upload id" }, 400);

  const bytes = await c.req.arrayBuffer();
  const n = Number(c.req.param("n"));
  const part = await uploadPart(c.env.MEDIA, src.r2_key, uploadId, n, bytes);

  /* Recorded as it lands. This is what any later session reads to work out
     what is left, and what `complete` trusts instead of the client's memory. */
  await c.env.DB
    .prepare(
      `INSERT OR REPLACE INTO upload_parts (source_id,part_number,etag,bytes,created_at)
       VALUES (?,?,?,?,?)`,
    )
    .bind(src.id, n, part.etag, bytes.byteLength, Date.now())
    .run();

  return c.json(part);
});

/**
 * Assembles the object and starts reading it. This is where a source stops
 * being an upload and becomes something the product can work with.
 */
/**
 * What has already landed for an in-flight upload.
 *
 * The resume query. A client that has lost its own record — a reload, a crash,
 * a new tab, a different day — asks this and sends only the parts that are
 * missing. Without it, "resumable" only ever meant "within this page's
 * lifetime", which is not what the word promises to someone whose 2GB upload
 * stopped at 60%.
 */
app.get("/api/uploads/:sourceId/state", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const up = await c.env.DB
    .prepare(`SELECT * FROM uploads WHERE source_id=? AND user_id=?`)
    .bind(c.req.param("sourceId"), user.id)
    .first<{ upload_id: string; part_size: number; total_bytes: number | null; filename: string | null; mode: string }>();
  if (!up) return c.json({ error: "not found" }, 404);

  const { results } = await c.env.DB
    .prepare(`SELECT part_number, etag FROM upload_parts WHERE source_id=? ORDER BY part_number`)
    .bind(c.req.param("sourceId"))
    .all<{ part_number: number; etag: string }>();

  return c.json({
    uploadId: up.upload_id,
    partSize: up.part_size,
    totalBytes: up.total_bytes,
    filename: up.filename,
    /* A resumed upload must keep using the transport it started on: a direct
       upload's parts belong to an S3 uploadId the binding cannot complete. */
    mode: up.mode,
    parts: (results ?? []).map((r) => ({ partNumber: r.part_number, etag: r.etag })),
  });
});

/**
 * Presigned URLs for a batch of parts.
 *
 * Handed out in batches rather than all at once: a 150-part upload does not
 * need 150 write capabilities alive from the start, and short-lived URLs mean
 * an abandoned upload stops being writable on its own.
 */
app.post("/api/uploads/:sourceId/part-urls", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const up = await c.env.DB
    .prepare(`SELECT upload_id, mode FROM uploads WHERE source_id=? AND user_id=?`)
    .bind(src.id, user.id)
    .first<{ upload_id: string; mode: string }>();
  if (!up || up.mode !== "direct") return c.json({ error: "not a direct upload" }, 409);

  const b = await body<{ parts: number[] }>(c);
  const wanted = (b.parts ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 64);

  const urls: Record<string, string> = {};
  for (const n of wanted) {
    const url = await presignPart(c.env, src.r2_key, up.upload_id, n);
    if (url) urls[String(n)] = url;
  }
  return c.json({ urls });
});

/**
 * The browser reports a part it PUT straight to R2.
 *
 * With a direct upload the Worker never sees the bytes, so it cannot record
 * the part itself — but the resume machinery depends on that record existing.
 * The ETag is R2's own receipt for the part, so this is the browser passing on
 * proof rather than being taken at its word: a wrong ETag fails completion.
 */
app.post("/api/uploads/:sourceId/parts/:n/done", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const b = await body<{ etag: string; bytes: number }>(c);
  if (!b.etag) return c.json({ error: "missing etag" }, 400);

  await c.env.DB
    .prepare(
      `INSERT OR REPLACE INTO upload_parts (source_id,part_number,etag,bytes,created_at)
       VALUES (?,?,?,?,?)`,
    )
    .bind(src.id, Number(c.req.param("n")), b.etag, b.bytes ?? 0, Date.now())
    .run();
  return c.json({ ok: true });
});

/** Uploads this account has started and not finished. */
app.get("/api/uploads/pending", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const { results } = await c.env.DB
    .prepare(
      /* upload_id and mode come back too: a page that adopts an interrupted
         upload has to hand the worker the SAME multipart id that issued the
         part URLs, and completion differs between direct and worker mode. */
      `SELECT u.source_id, u.filename, u.total_bytes, u.part_size, u.upload_id, u.mode,
              s.duration_s,
              (SELECT COUNT(*) FROM upload_parts p WHERE p.source_id = u.source_id) AS parts_done
         FROM uploads u
         JOIN sources s ON s.id = u.source_id
        WHERE u.user_id = ? AND s.deleted_at IS NULL
        ORDER BY u.created_at DESC LIMIT 5`,
    )
    .bind(user.id)
    .all();
  return c.json({ pending: results ?? [] });
});

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

  /*
   * The part list comes from what the server actually stored, not from what
   * the client believes it sent. A resumed upload may have been carried by two
   * different sessions — or two different devices — and neither would hold the
   * whole list. Completing with a partial list produces a truncated file that
   * looks successful, which is the worst possible failure here.
   */
  const { results } = await c.env.DB
    .prepare(`SELECT part_number, etag FROM upload_parts WHERE source_id=? ORDER BY part_number`)
    .bind(src.id)
    .all<{ part_number: number; etag: string }>();
  const stored = (results ?? []).map((r) => ({ partNumber: r.part_number, etag: r.etag }));
  const parts = stored.length ? stored : body.parts;

  /* Part numbers must be a complete run from 1. A gap means a part is missing
     and the assembled file would be silently short. */
  const missing = parts.map((p, i) => (p.partNumber === i + 1 ? null : i + 1)).filter(Boolean);
  if (missing.length) {
    return c.json({ error: `That upload is missing part ${missing[0]} — it needs to finish sending.` }, 409);
  }

  /* A direct upload has to be completed over the same API that issued its
     part URLs — the binding does not know that uploadId. */
  const up = await c.env.DB
    .prepare(`SELECT upload_id, mode FROM uploads WHERE source_id=?`)
    .bind(src.id)
    .first<{ upload_id: string; mode: string }>();
  const uploadId = up?.upload_id ?? body.uploadId;

  if (up?.mode === "direct") {
    const done = await completeMultipart(c.env, src.r2_key, uploadId, parts);
    if (!done.ok) return c.json({ error: done.error }, 400);
  } else {
    try {
      await completeUpload(c.env.MEDIA, src.r2_key, uploadId, parts);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "couldn't finish the upload" }, 400);
    }
  }

  // The upload is done; its bookkeeping is no longer resumable state.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM upload_parts WHERE source_id=?`).bind(src.id),
    c.env.DB.prepare(`DELETE FROM uploads WHERE source_id=?`).bind(src.id),
  ]);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "transcribe", ref_id: src.id });
  await dispatch(c.env, c.executionCtx, {
    type: "transcribe",
    jobId: job.id,
    userId: user.id,
    sourceId: src.id,
    plan: user.plan,
    diarize: body.diarize,
    knownDurationS: body.durationS,
  });
  return c.json({ source: src, jobId: job.id });
});

/** Abandon an upload, releasing the parts R2 is still billing for. */
app.post("/api/uploads/:sourceId/abort", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("sourceId"), user.id);
  if (!src) return c.json({ error: "not found" }, 404);
  /* The stored record is the authority on which API opened this upload, and on
     its id — the client may not have either after a reload. */
  const up = await c.env.DB
    .prepare(`SELECT upload_id, mode FROM uploads WHERE source_id=?`)
    .bind(src.id)
    .first<{ upload_id: string; mode: string }>();
  const uploadId = up?.upload_id ?? c.req.header("x-upload-id");

  if (uploadId) {
    if (up?.mode === "direct") await abortMultipart(c.env, src.r2_key, uploadId);
    else await abortUpload(c.env.MEDIA, src.r2_key, uploadId).catch(() => {});
  }

  /* Cleanup used to sit AFTER the return, so it never ran and every abandoned
     upload left its parts behind to be offered as resumable forever. */
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM upload_parts WHERE source_id=?`).bind(src.id),
    c.env.DB.prepare(`DELETE FROM uploads WHERE source_id=?`).bind(src.id),
    c.env.DB.prepare(`UPDATE sources SET deleted_at=? WHERE id=?`).bind(Date.now(), src.id),
  ]);
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
    sourceTitle: src.title,
  });

  /* No job means this reopened an edit that already has its clips — there is
     nothing to run, and re-running would cost minutes and money for an answer
     already on screen. */
  if (result.jobId) {
    await dispatch(c.env, c.executionCtx, {
      type: "score",
      jobId: result.jobId,
      userId: user.id,
      sourceId: src.id,
      projectId: result.projectId,
      brief: b.brief || "",
      upgrade: b.upgrade,
    });
  }
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







/*
 * `fetch` plus `queue`, rather than exporting the Hono app directly.
 *
 * The consumer has to sit beside fetch on the same default export for
 * Cloudflare to route messages to it. Until the queue is provisioned nothing
 * ever calls it — dispatch() falls back to waitUntil — but it ships now so
 * that provisioning the queue is a config change and not a code change.
 */
/**
 * The sweep.
 *
 * Everything that reconciles state in this product runs LAZILY — reapStaleJobs
 * when active jobs are read, reapGhostSources when sources are listed, the
 * duplicate-edit reap when projects are listed. That is a good pattern with
 * one hole: it only happens on a surface someone opens. A job that dies
 * belonging to a user who does not come back is never closed out, so their
 * next visit — days later — still shows work in progress that stopped long
 * ago. There was no scheduled handler at all.
 *
 * Hourly, and it does exactly what the lazy paths do, for everyone. Nothing
 * here is new behaviour; it is the existing behaviour arriving on time.
 */
async function scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  await ensureV2Schema(env.DB);

  const { results } = await env.DB
    .prepare(
      `SELECT DISTINCT user_id FROM jobs WHERE state IN ('queued','running')
       UNION
       SELECT DISTINCT user_id FROM sources WHERE transcript_state='pending' AND deleted_at IS NULL`,
    )
    .all<{ user_id: string }>();

  await reapRateLimits(env.DB);

  for (const { user_id } of results ?? []) {
    /* One user's bad row must not stop the sweep for everyone else. */
    try {
      await reapStaleJobs(env.DB, user_id);
      await reapGhostSources(env.DB, user_id);
    } catch (err) {
      console.log(`[sweep] ${user_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export default {
  fetch: app.fetch,
  queue: consume,
  scheduled,
};
