/**
 * Aldershot — Workers entry point.
 *
 * Editing is reading. No timeline, no scrubbing, no NLE. See design/ for the
 * spec: design/Aldershot.dc.html is authoritative, docs/archive/handoff-v2/ explains it.
 *
 * Routing follows docs/archive/handoff-v2/10-ROUTES-AND-KEYS.md exactly. The prototype
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
import { renderBoard } from "./ui/pages/board.ts";
import { boardFor } from "./scout-board-data.ts";
import { createRun, diligence } from "./scout-store.ts";
import { renderHome } from "./ui/pages/home.ts";
import { renderFootageFull, type FootTab, type SearchMode, hms } from "./ui/pages/footage.ts";
import { listMoments, listThreads, searchExact, searchMeaning, threadIdsByClip, countMoments } from "./library.ts";
import { ulid } from "./id.ts";
import { renderSource } from "./ui/pages/source.ts";
import { exportPanel, exportsStrip } from "./ui/pages/export.ts";
import { blocksForProject, cutClips, getProject, listClipsForSource, listProjects, overlapFraction, saveClips, saveCuts, setKept, toggleBeatStruck, scopeOf, createProject, titleFromBrief } from "./projects.ts";
import { applyEvent, billingReady, checkoutUrl, portalUrl, verifyWebhook } from "./billing.ts";
import { mayReadMedia } from "./media-auth.ts";
import { quickSearch } from "./search.ts";
import { moveBlock, parseOrder, runtimeMs, serialiseOrder, type Block } from "./blocks.ts";
import { buildSummary, renderBlockSlice, renderCut, type CutView } from "./ui/pages/cut.ts";
import { FONT_FILES } from "./ui/fontbytes.ts";
import { checkStorage, storedBytes } from "./storage.ts";
import { LIMITS, rateLimit, reapRateLimits } from "./ratelimit.ts";
import { nameSourceCut, nameUnnamedSources } from "./naming.ts";
import { createShortRender } from "./short-render.ts";
import { cleanTitle, closeAccount, duplicateProject, listTrash, purge, rename, restore, softDelete } from "./library-ops.ts";
import { renderProjects } from "./ui/pages/projects.ts";
import { renderEditorIntake } from "./ui/pages/editor-intake.ts";
import { renderSettings } from "./ui/pages/settings.ts";
import { ACCENT, C } from "./ui/tokens.ts";

/* Named here so the cost panel's categories read as colour decisions. */
const ACCENT_CYAN = ACCENT.cyan;
const ACCENT_GOLD = ACCENT.gold;
const ACCENT_GREEN = ACCENT.green;
const ACCENT_VIOLET = ACCENT.violet;
const ACCENT_RED = ACCENT.red;
import { deleteBeat, getBeats, insertBeat, moveBeat, setBeatMedia } from "./projects.ts";
import { draftPlan, findForBeats } from "./plan.ts";
import { createPlan, getPlan, setBeatKept, setFound, setPlanProject } from "./plan-store.ts";
import { addCuts, fillerCuts, findPhrase, isSegmentCut, isWordCut, parseCuts, pauseCuts, phraseCuts, serialiseCuts, timeSaved, toggleSegment, toggleWord, type Cut } from "./cuts.ts";
import { ASPECTS, CAPTION_STYLES, createRender, edlForProject, isAspect, isFormat, listFinished, listRenders, type Aspect, type Format } from "./render-job.ts";
import { encoderFor } from "./encode.ts";
import { CLIENT_JS } from "./ui/client.ts";
import { SW_JS } from "./ui/sw.ts";
import { currentUser, userForEmail, reconcileUser } from "./user.ts";
import { PLANS, checkCap } from "./plans.ts";
import { abortMultipart, canPresign, completeMultipart, createMultipart, presignPart } from "./r2sign.ts";
import { consume, dispatch } from "./queue.ts";
import { reapUsedAudio } from "./audio.ts";
import { proxyFirst, backfillProxies } from "./proxy.ts";
import { backfillClipIndex, reapClipIndex } from "./embeddings.ts";
import { loadRules, saveRules } from "./rule-store.ts";
import { honestReply, parseRules } from "./rule-parse.ts";
import { compileBrief, shortlistDiff } from "./brief.ts";
import { UNSURE, classify } from "./classify.ts";
import { allowed, type Move, type Source as PictureSource } from "./pictures.ts";
import { cueSheetFor, cueSheetText } from "./cuesheet.ts";
import { commentary, disputeFor, disputeText, usedSeconds } from "./dispute.ts";
import { beforePost, checklistText } from "./beforepost.ts";
import { overTheLimit, sidecarWanted } from "./captions.ts";
import { captionCues } from "./edl.ts";
import { loudnessVerdict } from "./loudness.ts";
import { buildManifest, manifestJson, type LeftOut, type ManifestSource } from "./manifest.ts";
import { asCandidateModel, isModelId } from "./eval-adversarial.ts";
import { judge } from "./judge.ts";
import { receiptsHtml, receiptsPage } from "./receipts.ts";
import { applyRule, compute, effectLine, fmt as fmtSecs, ruleKey, toFootageSet, type Rule } from "./rules.ts";
import { momentTags } from "./moment-tags.ts";
import { aspectOf, clipCountsBySource, createSource, editCountsBySource, getSegments, getSource, listSources, isSourceSort, playableKey, type SourceSort, reapGhostSources } from "./sources.ts";
import { requeueTransientReads } from "./ingest.ts";
import { abortUpload, completeUpload, partSizeFor, startUpload, uploadPart } from "./upload.ts";
import { activeJobs, createJob, getJobs, latestJobFor, recentlyFinished, reapStaleJobs } from "./jobs.ts";
import { transcribeOnce } from "./transcribe.ts";
import { meter, monthUsage } from "./usage.ts";
import { TTS } from "./models.ts";
import { wavDurationMs } from "./mp3.ts";
import { begin } from "./begin.ts";
import { assembleFromLibrary, CANDIDATE_POOL, inScope, recomputeFromRules } from "./assemble.ts";
import { momentsShown, renderRoom, type RoomTab, type Who } from "./ui/pages/room.ts";
import { externalMoments, countExternal, minesOwn, openMissions } from "./scout-external.ts";
import { shouldAlign, timingForProject } from "./align-source.ts";
import { JUDGE_VERSION } from "./judge.ts";
import { candidatesFor } from "./beat-find.ts";
import { otioJson } from "./otio.ts";
import { renderPlan } from "./ui/pages/plan.ts";
import { renderEval, type EvalData } from "./ui/pages/eval.ts";
import { LEGACY_LABELLER, isVerdict, labellerName, setProgress, type Verdict } from "./eval-set.ts";
import { findMaterial } from "./assemble.ts";
import { claimPassUndo, passLog, recordPass } from "./passes.ts";

export { AudioContainer, RenderContainer } from "./render.ts";

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
/*
 * `email` rather than a whole user: the shell only needs an initial for the
 * avatar, which was a hardcoded "C" — the owner's — on every account.
 *
 * REQUIRED, NOT OPTIONAL, and that is the whole fix.
 *
 * It was optional with a neutral fallback, so "every authenticated route has
 * the user in hand" held only as long as everyone remembered. They did not:
 * the editor called page() directly without one and several surfaces here
 * dropped it, so the avatar showed the signed-in initial on Home and a bare
 * bullet the moment you opened a video. Half the app knew who you were.
 *
 * A default that silently produces a plausible-looking wrong answer is the
 * shape of bug that spreads, because nothing ever fails. Making it required
 * turns forgetting into a type error, and a signed-out page now says `null`
 * out loud, which is a statement rather than an omission.
 */
function surface(
  view: View,
  screenLabel: string,
  title: string,
  body: string,
  email: string | null,
  shortsCtx: ShortsCtx = "nav",
) {
  return page({ title, view, screenLabel, shortsCtx, email }, body);
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

/**
 * What a job was ABOUT, when it is not a source and not a project.
 *
 * `ref_id` points at a source for reading and scoring, at a project for
 * passes, and — since a render's job started pointing at its render rather
 * than at the project — at a RENDER. Home names every row it shows and drops
 * the ones it cannot name, so without this an export in flight would simply
 * disappear from the working row while it ran.
 *
 * One query for all of them rather than one per row: the feed did a clip
 * lookup inside a `.map()`, which is a round trip per item.
 *
 * A render is named after what it is a render OF — the edit's title, or for a
 * short, the video the clip came from — because "Rendered a video" tells you
 * nothing and the id itself is not a name.
 */
async function nameLooseRefs(
  db: D1Database,
  userId: string,
  refIds: string[],
): Promise<Map<string, { title: string; href: string }>> {
  const out = new Map<string, { title: string; href: string }>();
  if (!refIds.length) return out;
  const marks = refIds.map(() => "?").join(",");

  const { results: renders } = await db
    .prepare(
      `SELECT r.id AS ref, p.title AS project_title, p.id AS project_id,
              s.title AS source_title, s.id AS source_id
         FROM renders r
         LEFT JOIN v2_projects p ON p.id = r.project_id
         LEFT JOIN v2_clips cl ON cl.id = r.clip_id
         LEFT JOIN sources s ON s.id = cl.source_id
        WHERE r.user_id=? AND r.id IN (${marks})`,
    )
    .bind(userId, ...refIds)
    .all<{ ref: string; project_title: string | null; project_id: string | null; source_title: string | null; source_id: string | null }>();

  for (const r of renders ?? []) {
    const title = r.project_title ?? r.source_title;
    if (!title) continue;
    out.set(r.ref, {
      title,
      href: r.project_id ? `/p/${r.project_id}/cut` : `/sources/${r.source_id}`,
    });
  }

  /* Clips, for the short-render jobs written before the change above — those
     rows are still in the table and still have to name themselves. */
  const rest = refIds.filter((id) => !out.has(id));
  if (rest.length) {
    const { results: clips } = await db
      .prepare(
        `SELECT cl.id AS ref, s.title AS title, s.id AS source_id
           FROM v2_clips cl JOIN sources s ON s.id = cl.source_id
          WHERE cl.user_id=? AND cl.id IN (${rest.map(() => "?").join(",")})`,
      )
      .bind(userId, ...rest)
      .all<{ ref: string; title: string; source_id: string }>();
    for (const c of clips ?? []) out.set(c.ref, { title: c.title, href: `/sources/${c.source_id}` });
  }

  return out;
}

const homeHandler = async (c: Ctx) => {
  await ensureV2Schema(c.env.DB);

  /*
   * `/` is the landing site when signed out and Home when signed in
   * (10-ROUTES-AND-KEYS.md). Same URL, so a shared link works for both.
   */
  const visitor = await currentUser(c.env, c.req.header("cookie"));
  if (!visitor) {
    /*
     * "Start with Studio" has to end at Studio.
     *
     * The paid CTA pointed at the same free form as the free one, so the plan
     * this page sells could not be bought from it. Checkout needs an account
     * to attach a subscription to, so signing in comes first — the choice is
     * parked in a short-lived cookie and picked up below once there is a user.
     * Both ways in (Google and the email link) land back here, which is why
     * the cookie is read here rather than inside either of them.
     */
    const wants = c.req.query("plan") === "studio";
    if (wants) {
      c.header(
        "set-cookie",
        "want_plan=studio; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax; Secure",
        { append: true },
      );
    }
    return c.html(
      renderLanding({
        sentTo: c.req.query("sent") ?? null,
        devLink: c.req.query("link") ?? null,
        error: c.req.query("error") ?? null,
        google: googleConfigured(c.env),
      }),
    );
  }

  /* A stored row today's rules would not produce is corrected on the way past
     — see reconcileUser. Home is the page everybody lands on. */
  const user = await reconcileUser(c.env.DB, visitor);

  /* Signed in, and they asked for Studio on the way. Clear it first, so a
     checkout that fails does not trap them in a redirect loop. */
  if (/(^|;\s*)want_plan=studio/.test(c.req.header("cookie") ?? "")) {
    c.header("set-cookie", "want_plan=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure", { append: true });
    if (user.plan !== "studio" && user.plan !== "pro") return c.redirect("/settings?checkout=studio", 302);
  }
  const [sources, jobs, finished, projects] = await Promise.all([
    listSources(c.env.DB, user.id),
    activeJobs(c.env.DB, user.id),
    recentlyFinished(c.env.DB, user.id),
    listProjects(c.env.DB, user.id),
  ]);

  /*
   * "Fresh" means the account genuinely has nothing to work with — that is
   * what earns the "How this goes" walkthrough.
   *
   * It was `sources.length === 0`, and a source row is created the instant an
   * upload STARTS, before a single byte lands. So the walkthrough vanished
   * mid-onboarding: the user clicked Begin, the page reloaded, and the
   * instructions they were following disappeared while their file was still
   * going up. Somebody whose only video is still uploading has nothing to work
   * with yet.
   */
  const isFresh = !sources.some((s) => s.transcript_state !== "pending");
  const byId = new Map(sources.map((s) => [s.id, s]));

  /* Anything neither a source nor a project — a render, or an old short's
     clip. Resolved in one query for the whole page rather than per row. */
  const loose = [...new Set(
    [...jobs, ...finished]
      .map((j) => j.ref_id)
      .filter((id): id is string => Boolean(id))
      .filter((id) => !byId.has(id) && !projects.some((p) => p.id === id)),
  )];
  const named = await nameLooseRefs(c.env.DB, user.id, loose);

  return c.html(
    surface(
      "home",
      "Home",
      "Aldershot",
      renderHome({
        name: user.name,
        isFresh,
        /*
         * "Overnight" means while you were away, and it has to be at least
         * plausibly true: this counted anything from the last 12 hours, so a
         * file uploaded sixty seconds ago was announced as having landed
         * overnight. It now needs the video to be READ — a still-uploading one
         * has not landed — and the greeting only claims "overnight" when the
         * arrival really was hours ago and you were not here for it.
         */
        landedOvernight: sources.filter(
          (s) =>
            s.transcript_state === "ready" &&
            Date.now() - s.created_at < 12 * 3600 * 1000 &&
            Date.now() - s.created_at > 60 * 60 * 1000,
        ).length,
        /* A job whose source has been deleted is not work in progress — it is
           a leftover. Showing it produced "reading a video and a video". */
        working: jobs
          .filter((j) => !j.ref_id || byId.has(j.ref_id) || projects.some((p) => p.id === j.ref_id) || named.has(j.ref_id))
          .map((j) => ({
            label:
              byId.get(j.ref_id ?? "")?.title ??
              projects.find((p) => p.id === j.ref_id)?.title ??
              named.get(j.ref_id ?? "")?.title ??
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
        feed: (
          await Promise.all(
            finished.map(async (j) => {
              /*
               * WHAT this was about, or nothing.
               *
               * ref_id points at a source for reading and scoring, at a
               * PROJECT for passes, and at a RENDER for an export. None of
               * the last two matched either list, so those rows read
               * "Rendered a video" and offered an Open that went nowhere. A
               * row that cannot name its subject is dropped rather than shown
               * pointing at a 404.
               *
               * nameLooseRefs did the lookup for the whole page already; this
               * used to run a query per row inside the map.
               */
              const src = byId.get(j.ref_id ?? "");
              const proj = projects.find((p) => p.id === j.ref_id);
              const other = !src && !proj ? named.get(j.ref_id ?? "") : undefined;

              const what = src?.title ?? proj?.title ?? other?.title ?? null;
              if (!what) return null;

              const href = proj ? `/p/${j.ref_id}/cut` : (other?.href ?? `/sources/${src?.id}`);

              /*
               * A DECISION where there honestly is one. The design's feed rows
               * each ask something — "Add it / Skip", "Export / Later" — and
               * this was a changelog where every row said "Open" whatever had
               * happened.
               */
              if (j.state === "failed") {
                return { text: j.error ?? `Couldn't finish ${what}`, at: j.finished_at ?? j.created_at, state: j.state, href, link: "Retry" };
              }
              const done: Record<string, [string, string]> = {
                transcribe: [`Finished transcribing ${what}`, "Start cutting"],
                score: [`Found the moments in ${what}`, "Review the cut"],
                shorts: [`Cut shorts from ${what}`, "Open"],
                render: [`Rendered ${what}`, "Download"],
                pass: [`Ran a pass on ${what}`, "Review the cut"],
              };
              const [text, link] = done[j.type] ?? [`Finished ${what}`, "Open"];
              return { text, at: j.finished_at ?? j.created_at, state: j.state, href, link };
            }),
          )
        ).filter((f): f is NonNullable<typeof f> => f !== null),
        /*
         * WHAT YOU HAVE ON THE GO — computed, not stored.
         *
         * This filtered on `pct > 0 && pct < 100`, and nothing anywhere writes
         * v2_projects.pct: every row is 0, so the filter was always empty and
         * this section has never once rendered. `next_action`, which its rows
         * also read, is null on every row too.
         *
         * The editor has been computing exactly this all along. buildSummary
         * gives the line ("2 voiceovers to go."), and whether anything is
         * outstanding is what decides the state — the prototype's own three.
         */
        motion: await Promise.all(
          projects
            .filter((p) => !p.archived_at)
            .slice(0, 6)
            .map(async (p) => {
              /*
               * The line has to describe THIS cut, and buildSummary only
               * knows about beats — so an unassisted cut of a 24-line
               * transcript read "nothing laid down yet." while sitting next to
               * "ready to render". A cut made by striking text has no beats
               * and is still full of content; what it has is blocks.
               */
              const { blocks, cuts, beats } = await blocksForProject(c.env.DB, p, user.id);
              const outstanding = buildSummary(beats);
              const unfilled = beats.length > 0 && outstanding !== "every beat is filled.";
              const kept = blocks.filter((b) => !b.struck).length;
              /*
               * "Ready to render" has to mean a cut EXISTS. Every state but
               * needs-you fell through to it, so a transcript nobody had
               * touched sat on Home claiming it was ready — true in the sense
               * that the button works, and misleading in every sense that
               * matters. What makes it an edit is that someone cut something
               * (cuts) or put something in (beats); otherwise it is the
               * source read back at you, and the honest word is "not started".
               */
              const touched = cuts.length > 0 || beats.length > 0;

              return {
                id: p.id,
                title: p.title,
                poster_r2_key: p.poster_r2_key ?? (p.source_id ? (byId.get(p.source_id)?.poster_r2_key ?? null) : null),
                /* What still wants you, what is already there, or where to start. */
                needs: unfilled
                  ? outstanding
                  : touched
                    ? `${kept} kept · ${hms(runtimeMs(blocks, cuts) / 1000)}`
                    : `${blocks.length} lines · nothing cut yet`,
                state: unfilled
                  ? ("needsyou" as const)
                  : touched && kept > 0
                    ? ("ready" as const)
                    : ("idle" as const),
              };
            }),
        ),
        /* Recent videos, so a cut can be started from Home. listSources is
           already loaded above for the feed's title lookups. */
        footage: sources.slice(0, 8).map((sv) => ({
          id: sv.id,
          title: sv.cut_title || sv.title,
          poster_r2_key: sv.poster_r2_key,
          duration_s: sv.duration_s,
        })),
      }),
      user.email,
    ),
  );
};

/*
 * THE ROOM IS THE FRONT DOOR. The old Home keeps a URL.
 *
 * `/` was Home — a composer and a feed — while /footage and /projects were
 * two more pages over the same library. One Take is one room, so / serves it
 * and the nav's Home link already points here.
 *
 * Home is not deleted. It carries a finished-while-you-were-away feed and a
 * "what is part-made" section the room does not cover yet, and removing a
 * surface before its replacement covers it is how a product loses features
 * quietly. It goes when the room covers it, not before — and until then it is
 * at /home, reachable and unadvertised.
 *
 * Signed out, / is still the landing site, which is Home's own branch: a
 * shared link has to work for someone with no account.
 */
app.get("/home", homeHandler);
app.get("/", async (c) => {
  const visitor = await currentUser(c.env, c.req.header("cookie"));
  return visitor ? roomHandler(c) : homeHandler(c);
});

/**
 * The edits, shaped for a card.
 *
 * Two surfaces need exactly this — /projects and Footage's Edits tab — so it
 * is one function. Writing it twice is how Footage and Clipping came to
 * disagree about a count before.
 */
async function editRows(db: D1Database, userId: string) {
  const projects = (await listProjects(db, userId)).filter((p) => !p.archived_at);

  /*
   * A project's state pill is derived from its beats, not stored: "needs you"
   * means a voice or reaction beat has no recording yet. Stored, it would go
   * stale the moment a beat was recorded from any other surface.
   */
  const rows = await Promise.all(
    projects.map(async (p) => {
      const beats = await getBeats(db, p.id);

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
          const clip = await db
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

  return rows;
}

app.get("/projects", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const rows = await editRows(c.env.DB, user.id);
  return c.html(
    surface("projects", "Projects", "Projects — Aldershot", renderProjects(rows), user.email),
  );
});

/**
 * THE ROOM — One Take's front door, with no project open.
 *
 * Home, Footage and Projects were three pages describing one library. This is
 * the one surface they fold into (docs/handoff/02-SCREENS.md). It is mounted
 * at /room while the old pages are still linked to from the nav and from the
 * editor's back links; /room becomes / once nothing points at them.
 *
 * Every count is read, never estimated. The tab lists are loaded ALL of them
 * rather than only the active one, for the same reason the Footage page does:
 * the tab bar shows each count, and a count that disagrees with its list is a
 * bug this product has already had twice.
 */
const roomHandler = async (c: Ctx) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const t = c.req.query("tab");
  const tab: RoomTab = t === "highlights" ? "highlights" : t === "projects" ? "projects" : "videos";
  const q = (c.req.query("q") || "").trim();
  /*
   * MINE · EXTERNAL · ALL.
   *
   * "all" is the default, as it is in the prototype — a person who has never
   * run Scout should not have to find a filter to see their own footage, and
   * a person who has should not have to go looking for what it found. An
   * unknown value falls back to all rather than refusing: it is a view, and
   * a bookmarked link with a typo in it should show the library.
   */
  const w = c.req.query("who");
  const who: Who = w === "mine" ? "mine" : w === "external" ? "external" : "all";

  /*
   * WHAT IS ATTACHED, from the URL.
   *
   * Server-rendered, so the selection has to survive a page load and the URL
   * is the only place that cannot get out of step with what is on screen.
   * Filtered against the user's own sources on render as well as on submit:
   * a stale id in a bookmarked link should quietly drop out rather than show
   * a video that is not there.
   */
  const attachParam = (c.req.query("attach") || "").split(",").filter(Boolean);
  /* The ghost list, kept apart from the source list for the reason RoomData
     says: a ledger id is not a source id and must not be scoped against. */
  const extParam = (c.req.query("ext") || "").split(",").filter(Boolean);
  /* Which retriever the person asked for. Both still run and fuse — this
     says which one they chose to see first, and whether to say the index is
     off. "exact" means they asked for the words, so the notice is not news. */
  const mode: "meaning" | "exact" = c.req.query("mode") === "exact" ? "exact" : "meaning";

  const [sources, projects, threads, clipsPer, momentCount, jobs, externalCount] = await Promise.all([
    listSources(c.env.DB, user.id, "newest"),
    listProjects(c.env.DB, user.id),
    listThreads(c.env.DB, user.id),
    clipCountsBySource(c.env.DB, user.id),
    countMoments(c.env.DB, user.id),
    activeJobs(c.env.DB, user.id),
    countExternal(c.env.DB, user.id),
  ]);

  /*
   * A JOB WITH NOTHING TO NAME IS NOT SHOWN.
   *
   * The same rule Home follows: a job whose ref_id matches no source and no
   * project would render as "a video", which is a progress bar for something
   * the person cannot find. Better to say nothing about it than to say that.
   */
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const working = jobs
    .filter((j) => !j.ref_id || sourceById.has(j.ref_id) || projects.some((p) => p.id === j.ref_id))
    .map((j) => ({
      label:
        sourceById.get(j.ref_id ?? "")?.title ??
        projects.find((p) => p.id === j.ref_id)?.title ??
        "a video",
      type: j.type,
      stage: j.stage_label ?? "working on",
      pct: j.pct,
    }));

  /*
   * SEARCH IS THE SAME RETRIEVAL THE ASSEMBLY PATH USES.
   *
   * findMaterial runs meaning and exact words as peers and fuses them by
   * rank. Calling it here rather than writing a second search means the room
   * and the cut can never disagree about what the library contains — and when
   * somebody types a sentence into the box and then asks for a cut of it, the
   * same moments come back.
   *
   * `how` tells us whether the index took part, which is the only thing the
   * notice on screen claims.
   */
  let moments: Awaited<ReturnType<typeof listMoments>>;
  let meaningUnavailable = false;
  if (q) {
    const found = await findMaterial(c.env, user.id, q, 60);
    /*
     * A SEARCH THAT MATCHED NOTHING RETURNS NOTHING.
     *
     * findMaterial falls back to the most recent moments when neither
     * retriever matches, which is right for a BRIEF — "eight minutes on
     * whatever you have" is a request for material — and wrong for a search
     * box, where it answered "turpentine" with the whole library. Caught by
     * searching for a word that is not in the seeded footage and getting
     * nine moments back.
     *
     * `how === "recent"` is findMaterial saying so itself, which is why it
     * reports it.
     */
    moments = found.how === "recent" ? [] : found.moments;
    meaningUnavailable = found.how !== "meaning";
  } else {
    moments = await listMoments(c.env.DB, user.id, 60);
  }

  const mine = new Set(sources.map((s) => s.id));
  const attached = attachParam.filter((id) => mine.has(id));

  /*
   * ONE LIST, TWO PROVENANCES.
   *
   * Doc 18: an external moment "uses the same table and engine as the user's
   * own moments". It does not literally share v2_clips — nothing was
   * downloaded, so there is no clip — but it shares the LIST, and the filter
   * is how a person stops it being lost among six hundred of their own.
   *
   * Only read when it could be shown. Under Mine the query is not run at
   * all, which keeps the common case at the cost it was before this landed.
   */
  const externals =
    who === "mine" || tab !== "highlights" ? [] : await externalMoments(c.env.DB, user.id, 60);
  const extAttached = extParam.filter((id) => externals.some((e) => e.id === id));

  /*
   * A SEARCH FILTERS THE EXTERNAL ROWS TOO, on their words.
   *
   * findMaterial searches v2_clips, which these are not in, so a search with
   * externals showing would otherwise have returned every find regardless of
   * the query — the Highlights list claiming nine matches and showing forty.
   * Matching the quote is the honest version of the same thing until the
   * ledger is indexed.
   */
  const extTerms = q.toLowerCase().split(/\s+/).filter((x) => x.length > 1);
  const extHits = extTerms.length
    ? externals.filter((e) => {
        const hay = `${e.quote} ${e.source_title}`.toLowerCase();
        return extTerms.every((term) => hay.includes(term));
      })
    : externals;

  const mineCards = moments.map((m) => ({
    id: m.id,
    quote: m.quote,
    frame_r2_key: m.frame_r2_key,
    source_title: m.source_title,
    thread_name: m.thread_name,
    provenance: "mine" as const,
    at_s: m.start_ms / 1000,
    dur_s: (m.end_ms - m.start_ms) / 1000,
    attached: attached.includes(m.id),
  }));
  const extCards0 = extHits.map((e) => ({
    id: e.id,
    quote: e.quote,
    frame_r2_key: e.frame_r2_key,
    source_title: e.source_title,
    thread_name: null,
    provenance: "external" as const,
    acq: e.acq,
    host: e.host,
    at_s: e.t_start_s,
    attached: extAttached.includes(e.id),
  }));
  /*
   * THE TAB'S COUNT IS THE LENGTH OF THE LIST UNDER IT.
   *
   * This file already says it twice: "a count that disagrees with its list is
   * a bug this product has already had twice". It had it a third time — the
   * Highlights tab read the user's own moments while the list showed three
   * finds beside them, so a library with nothing of its own said 0 over
   * three cards. The count is what is shown, and `who` decides what that is.
   */
  const shown =
    who === "external" ? extCards0 : who === "mine" ? mineCards : [...mineCards, ...extCards0];
  const shownCount = momentsShown(who, momentCount, externalCount);

  return c.html(
    page(
      { title: "Your footage — Aldershot", view: "room", screenLabel: "The room", email: user.email },
      renderRoom({
        tab,
        attached,
        q,
        mode,
        meaningUnavailable: mode === "exact" ? false : meaningUnavailable,
        threadNames: threads.map((t) => t.name),
        working,
        sources: sources.map((s) => ({
          id: s.id,
          title: s.title,
          poster_r2_key: s.poster_r2_key,
          transcript_state: s.transcript_state,
          duration_s: s.duration_s,
          clips: clipsPer.get(s.id) ?? 0,
        })),
        who,
        ext: extAttached,
        moments: shown,
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          updated_at: p.updated_at,
        })),
        counts: {
          sources: sources.length,
          moments: shownCount,
          threads: threads.length,
          external: externalCount,
        },
      }),
    ),
  );
};

/*
 * THE ROOM IS THE FRONT DOOR NOW.
 *
 * `/` was Home — a composer and a feed — and /footage and /projects were two
 * more pages over the same library. One Take is one room, so / serves it, and
 * the nav's Home link already points here.
 *
 * The old Home stays at /home rather than being deleted. It carries a feed
 * and a "what is part-made" section the room does not have yet, and deleting
 * a surface before its replacement covers it is how a product loses features
 * quietly. It goes when the room covers it, not before.
 *
 * /room stays as an alias so anything already linking to it keeps working.
 */
app.get("/room", roomHandler);

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
    t === "threads" ? "threads"
    : t === "moments" ? "moments"
    : t === "edits" ? "edits"
    : t === "exports" ? "exports"
    : t === "find" ? "find"
    : "sources";
  /*
   * Default to what actually works.
   *
   * "By meaning" was preselected, and meaning search needs a VECTORIZE index
   * that is deliberately unbound until it is created (wrangler.jsonc). So the
   * default control was one that could only ever fall back and then apologise
   * — the apology is honest, but making the broken mode the default is not.
   */
  const canMean = Boolean(c.env.VECTORIZE);
  const asked = c.req.query("mode");
  const mode: SearchMode = asked === "exact" || (!asked && !canMean) ? "exact" : "meaning";
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

  /* What each video has yielded, and what is being made from it. Two grouped
     queries rather than two per row — the same shape Clipping's picker and the
     editor's intake already use. */
  const [clipsPer, editsPer] = await Promise.all([
    clipCountsBySource(c.env.DB, user.id),
    editCountsBySource(c.env.DB, user.id),
  ]);

  /* Live read progress per source, so a row that is being read shows a moving
     bar instead of a static word. The jobs are already being loaded for the
     nav; this just joins them up. */
  const reading = await activeJobs(c.env.DB, user.id);
  const pctFor = new Map(reading.filter((j) => j.type === "transcribe").map((j) => [j.ref_id, j.pct]));

  /* The count on every tab, the LIST only where it is shown. A count is one
     cheap query; sixteen rows of quotes and frames are not. */
  const momentCount = await countMoments(c.env.DB, user.id);

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

  /* Finished exports — cuts AND shorts. Loaded whatever tab you are on,
     because the tab bar shows the count and a count that disagrees with its
     list is worse than none.
     Both kinds, because Clipping was the only surface that listed a finished
     short: scrapping it while this asked for 'cut' alone would have left every
     short you had rendered unreachable and still paying for its storage. */
  const finished = await listFinished(c.env.DB, user.id, ["cut", "short"]);
  /* Same rule as the counts above: loaded whatever tab you are on, because
     the tab bar shows the number and a count that disagrees with its list is
     worse than no count. */
  const edits = await editRows(c.env.DB, user.id);

  return c.html(
    surface(
      "archive",
      "Footage",
      "Footage — Aldershot",
      renderFootageFull({
        tab,
        exports: finished.map((r) => ({
          id: r.id, r2_key: r.r2_key, duration_s: r.duration_s, bytes: r.bytes,
          format: r.format, aspect: r.aspect, created_at: r.created_at,
          title: r.title, href: r.href, kind: r.kind,
        })),
        edits,
        editsCount: edits.length,
        exportCount: finished.length,
        sources: sources.map((s) => ({
          ...s,
          pct: pctFor.get(s.id),
          clip_count: clipsPer.get(s.id) ?? 0,
          edit_count: editsPer.get(s.id) ?? 0,
        })),
        moments, momentCount, threads, mode, q: query, meaningUnavailable, canMean, thread, sort,
      }),
      user.email,
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
/**
 * Opening the edit — a VERB, so it redirects.
 *
 * Footage cards point here: "when i click the video it just takes me to the
 * transcript page.. that's not what should happen", so a click still lands
 * you in the editor. What changed is that /sources/:id no longer does this,
 * because a noun that redirects is a page you can never reach.
 */
app.get("/sources/:id/edit", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (!src) return c.notFound();
  /* Not readable yet: the source page is where the reading, and any failure
     with its reason and a Retry, actually live. */
  if (src.transcript_state !== "ready") return c.redirect(`/sources/${src.id}`, 302);

  /*
   * Name it NOW if nobody has. Once per source, on the way in — the sweep
   * that catches older footage runs hourly and does not help the person
   * standing here.
   */
  let cutTitle = src.cut_title;
  if (!cutTitle) {
    const segs = await getSegments(c.env.DB, src.id);
    cutTitle = await nameSourceCut(c.env, src, segs.slice(0, 40).map((sg) => sg.text).join(" "));
  }

  const { href } = await begin(
    c.env,
    {
      userId: user.id,
      sourceId: src.id,
      brief: (c.req.query("brief") || "").trim(),
      sourceTitle: src.title,
      cutTitle,
      fresh: c.req.query("fresh") === "1",
    },
    c.executionCtx,
  );
  return c.redirect(href, 302);
});

/**
 * The footage itself — a NOUN, so it is a page.
 *
 * This used to 302 straight into the editor the moment a transcript was
 * ready, which meant the source page only ever rendered while a video was
 * still being read or had failed. Your own footage became unreachable the
 * instant it became useful, and an edit looked like it had consumed it.
 *
 * Nothing about editing touches what is here: cuts live on the project, the
 * transcript is written once, and a render writes a new file rather than
 * overwriting the original. The page just has to say so by existing.
 */
app.get("/sources/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const src = await getSource(c.env.DB, c.req.param("id"), user.id);
  if (src) await proxyFirst(c.env, c.executionCtx, src);
  if (!src) return c.notFound();

  /* The LATEST job, not the active one: this page renders the failed state and
     needs the reason that failure recorded, which activeJobs can never
     return. */
  const [segments, job, edits] = await Promise.all([
    getSegments(c.env.DB, src.id),
    latestJobFor(c.env.DB, src.id, user.id, ["transcribe"]),
    /* Every edit made from this footage. The point of the page: one source,
       as many cuts as you like, none of them consuming it. */
    c.env.DB
      .prepare(
        `SELECT id, title, brief, cuts, updated_at FROM v2_projects
          WHERE source_id=? AND user_id=? AND deleted_at IS NULL AND archived_at IS NULL
          ORDER BY updated_at DESC`,
      )
      .bind(src.id, user.id)
      .all<{ id: string; title: string; brief: string | null; cuts: string | null; updated_at: number }>()
      .then((r) => r.results ?? []),
  ]);

  return c.html(
    surface("archive", "Footage", `${src.title} — Aldershot`, renderSource({ source: src, segments, job, edits }), user.email),
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

/* ──────────────────────────────────────────────────────────────────────────
 * SCOUT, AS THREE ROUTES.
 *
 * Doc 18 section 1 draws them: POST a run, GET a run, GET the board. The
 * modules behind them have been built and tested for a week and none of them
 * has been reachable by a person, which is the difference between a library
 * and a feature.
 *
 * THE RUN IS A JOB, not a request. Minutes of frontier calls and adapter
 * fetches do not belong inside a POST — see src/scout-job.ts for why one
 * phase per message rather than one run per invocation.
 * ────────────────────────────────────────────────────────────────────────── */

app.post("/api/projects/:id/scout/runs", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ brief?: string; subject?: string }>(c);
  const brief = (b.brief ?? project.brief ?? "").trim();
  if (!brief) return c.json({ error: "Scout needs a sentence about what the video argues." }, 400);
  /* The subject is who it is about, which the crowd and seed families hang
     off. Without one those two families produce queries about nobody. */
  const subject = (b.subject ?? "").trim() || brief.split(/\s+/).slice(0, 4).join(" ");

  const runId = await createRun(c.env.DB, { projectId: project.id, trigger: "plan", brief });
  const job = await createJob(c.env.DB, { user_id: user.id, type: "scout", ref_id: runId });
  await dispatch(c.env, c.executionCtx, {
    type: "scout",
    jobId: job.id,
    userId: user.id,
    runId,
    projectId: project.id,
    subject,
    brief,
  });

  /*
   * A FORM POST LANDS ON THE BOARD, not on JSON. The control in the cut's
   * direction column is a plain form — the client is one String.raw template
   * and a stray backtick breaks the product — so the response has to be a
   * page. An XHR caller asks for JSON and gets it.
   */
  if ((c.req.header("accept") ?? "").includes("application/json")) {
    return c.json({ runId, jobId: job.id });
  }
  return c.redirect(`/api/projects/${project.id}/scout/board`, 303);
});

app.get("/api/projects/:id/scout/runs/:rid", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const run = await c.env.DB.prepare("SELECT * FROM scout_runs WHERE id = ? AND project_id = ?")
    .bind(c.req.param("rid"), project.id)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ error: "not found" }, 404);

  /*
   * THE DILIGENCE LOG RIDES ALONG. What was tried is not a separate screen
   * somebody has to think to open — the thing that makes a gap mean "we
   * looked" rather than "there is nothing" travels with the run.
   */
  return c.json({ run, diligence: await diligence(c.env.DB, String(run.id)) });
});

app.get("/api/projects/:id/scout/board", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const data = await boardFor(c.env.DB, project.id);
  return c.html(page({ title: "Scout", view: "room", screenLabel: "Scout", email: user.email }, renderBoard(data)));
});

/*
 * CLIPPING IS GONE.
 *
 * It was a second, worse door to something the editor already does: every
 * block carries "Make a short", and docs/decisions/blocks.md settled it long
 * before this — "Shorts are an export, not a surface." The page outlived the
 * decision and spent several rounds half-finished, ending as two black boxes
 * with Download buttons under a heading that told you to pick a video.
 *
 * The redirect stays rather than a 404: links to it exist in the wild, and
 * every short it used to list now lives in Footage's Exports tab.
 */
app.get("/clipping", (c) => c.redirect("/footage?tab=exports", 302));


/* ── The editor ────────────────────────────────────────────────────────
 * One surface, four stages, real URLs per 10-ROUTES-AND-KEYS.md.
 */
/*
 * ONE EDITOR.
 *
 * There were four stages and they were the same thing badly divided: Pick and
 * Script both strike the same cuts, one by line and one by word, and Build
 * held the reorder and insert gestures behind a screen that is empty until a
 * scoring pass runs. See docs/decisions/blocks.md.
 *
 * The old paths still resolve — links, history and anything the owner has
 * open — and land on the one surface rather than 404ing.
 */
/**
 * The URLs the editor answers on.
 *
 * `cut` is the real one and everything links to it. The other four are the
 * old stage tabs, kept because they are in people's history and in links
 * already sent — a bookmark landing on a 404 is a worse outcome than a URL
 * with a legacy name. They are not redirects: a redirect would rewrite the
 * address bar under someone mid-edit for no benefit they asked for.
 *
 * This list had `cut` MISSING, so the canonical URL 404ed while all four
 * legacy aliases worked. The walk caught it.
 */
const EDITOR_PATHS = new Set(["cut", "pick", "build", "script", "shorts", "footage"]);

/**
 * The editor. One route, one surface.
 *
 * Everything the old four stages did happens here: strike a line or a word,
 * move a block, insert one, judge, export. The sequence comes from
 * src/blocks.ts, which is the single place that says what a cut IS — so this
 * and the renderer cannot disagree about it.
 */
app.get("/p/:id/:stagePath", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const stage = c.req.param("stagePath");
  if (!EDITOR_PATHS.has(stage)) return c.notFound();

  /*
   * WHICH READING. /p/:id/script was one of four legacy stage aliases that all
   * rendered the same block view; it is the script view now, which is what the
   * word always meant. ?view= is honoured too, the same shape Footage's ?tab=
   * uses, so the blocks endpoint can ask for a matching slice.
   */
  const view: CutView =
    stage === "footage" || c.req.query("view") === "footage" ? "footage"
    : stage === "script" || c.req.query("view") === "script" ? "script"
    /* `shorts` was already in EDITOR_PATHS and rendered the blocks view —
       a tab the product answered and did not have. It has one now. */
    : stage === "shorts" || c.req.query("view") === "shorts" ? "shorts"
    : "blocks";

  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.notFound();

  const source = project.source_id ? await getSource(c.env.DB, project.source_id, user.id) : null;

  /* The video you are about to edit goes to the front of the proxy queue.
     The hourly backfill does two at a time, so without this the copy for the
     one video you actually opened could sit hours behind ones you were never
     going to touch. */
  if (source) await proxyFirst(c.env, c.executionCtx, source);

  const [segments, beats, clips, job, passes] = await Promise.all([
    source ? getSegments(c.env.DB, source.id) : Promise.resolve([]),
    getBeats(c.env.DB, project.id),
    /* The model's opinion of this footage, attached to the blocks it covers
       rather than rendered as a separate list of "clips". */
    source ? listClipsForSource(c.env.DB, source.id, user.id) : Promise.resolve([]),
    latestJobFor(c.env.DB, project.id, user.id, ["score", "pass"]),
    /* What has been asked of this cut and what came of it. Written since the
       first pass ever ran; read here for the first time. */
    passLog(c.env.DB, project.id),
  ]);

  const cuts = parseCuts(project.cuts);
  const blocks = (
    await blocksForProject(c.env.DB, project, user.id, {
      segments,
      posterKey: source?.poster_r2_key ?? null,
      scores: clips.map((cl) => ({ start_ms: cl.start_ms, end_ms: cl.end_ms, score: cl.score, why: cl.why })),
    })
  ).blocks;

  const renders = await listRenders(c.env.DB, project.id, user.id);

  return c.html(
    page(
      { title: `${project.title} — Aldershot`, view: "cut", screenLabel: "Cutting room", shortsCtx: "editor", email: user.email },
      renderCut({
        projectId: project.id,
        title: project.title,
        sourceId: source?.id ?? null,
        sourceTitle: source?.title ?? null,
        /* The editing copy when there is one — see playableKey. The RENDER
           still reads r2_key; this is only what you watch. */
        sourceKey: source ? playableKey(source) : null,
        /* The video's own shape, measured by the proxy pass. Without it a
           vertical source is drawn into a landscape box — see aspectOf. */
        aspect: source ? aspectOf(source) : undefined,
        posterKey: source?.poster_r2_key ?? null,
        blocks,
        beats,
        cuts,
        view,
        windowSize: BLOCK_WINDOW,
        /*
         * WHAT THE CUT IS, in the line the centre column opens with. The
         * same numbers the bottom bar carries, said where you are reading
         * rather than where you scroll to.
         */
        cutLine: (() => {
          const live = blocks.filter((b) => !b.struck);
          const runtime = live.reduce((n, b) => n + Math.max(0, b.end_ms - b.start_ms), 0);
          const videos = new Set(live.map((b) => b.mediaKey ?? "own")).size;
          return [
            hms(runtime / 1000),
            `${live.length} block${live.length === 1 ? "" : "s"}`,
            source ? source.title : `from ${videos} video${videos === 1 ? "" : "s"}`,
          ].join(" · ");
        })(),
        /*
         * What the clean-ups would actually do, counted from THIS transcript.
         *
         * "A chip whose number cannot be computed honestly yet shows its
         * descriptive text and is disabled, rather than displaying a plausible
         * fabricated count" — and these can be computed honestly, so they are.
         * fillerCuts and pauseCuts find the real words and the real gaps;
         * timeSaved runs both through the same playableRanges the render is
         * built from, so "-0:31" is what the video actually loses.
         */
        cleanups: (() => {
          /*
           * What is LEFT to find, not what exists.
           *
           * The filter was only dropping fillers inside fully-cut lines, so a
           * chip that had just removed two of them still offered to remove the
           * same two — with "−0:00" next to it, because timeSaved correctly
           * measured that there was nothing left to save. A count and its own
           * saving disagreeing is exactly the kind of number that teaches
           * people to stop reading them.
           */
          const left = (found: Cut[]) =>
            found.filter((x) => !(x.words ? isWordCut(cuts, x.seg, x.words[0]) : isSegmentCut(cuts, x.seg)));
          const fillers = left(fillerCuts(segments));
          const pauses = left(pauseCuts(segments));
          return {
            fillers: { found: fillers.length, savedMs: timeSaved(segments, cuts, fillers) },
            pauses: { found: pauses.length, savedMs: timeSaved(segments, cuts, pauses) },
          };
        })(),
        runtimeMs: runtimeMs(blocks, cuts),
        keptCount: blocks.filter((b: Block) => !b.struck).length,
        plan: user.plan,
        cameFrom: cameFrom(c.req.header("referer")),
        job,
        passes,
        /*
         * THE RULES THAT PRODUCED THIS CUT, with what each is doing now.
         *
         * Empty for an edit that began with a video — those are the staged
         * editor's and have no rule set. An assembled cut has one, stored at
         * assembly, and its effect is recomputed here rather than stored:
         * an effect is a fact about the CURRENT footage, and a stored one goes
         * stale the moment a moment is struck.
         */
        ...(await (async () => {
          /*
           * THE RULES AND THE MOMENTS THEY JUDGED, from one computation.
           *
           * Both halves of the project state read the same cut: the pane
           * numbers the rules, the Footage tab says which rule put each
           * moment in or took it out, and they have to agree or a moment
           * points at the wrong line. Computing twice would let them.
           */
          const stored = await loadRules(c.env.DB, project.id);
          if (!stored.length) return { rules: [], moments: [], addable: [], blockRule: {} };

          /* Attached footage only. Without this the Footage tab lists every
             moment in the library against a cut that can only ever draw on
             two videos, and every one of them reads "out · no rule keeps it"
             — which is true and useless. */
          const pool = inScope(await listMoments(c.env.DB, user.id, CANDIDATE_POOL), scopeOf(project));
          const set = toFootageSet(pool, momentTags);
          const judged = compute(stored, { set }).st;

          /* The pane numbers only the rules proper; a hand decision is the
             escape hatch from them. Same rule, same order, same numbers. */
          const main = stored.filter((r) => !r.hand);
          const numberOf = (id: unknown) => {
            const i = main.findIndex((r) => String(r.id) === String(id));
            return i < 0 ? "—" : String(i + 1).padStart(2, "0");
          };
          const isHand = (id: unknown) =>
            Boolean(stored.find((r) => String(r.id) === String(id))?.hand);
          const titles = new Map(pool.map((m) => [m.id, m.source_title]));

          /*
           * The videos this cut is NOT drawing on. Only when it has a scope:
           * a cut without one already draws on everything, so there is
           * nothing to add and a control offering to would do nothing.
           */
          const scope = scopeOf(project);
          const addable = scope
            ? (await listSources(c.env.DB, user.id, "newest"))
                .filter((x) => !scope.includes(x.id))
                .map((x) => ({ id: x.id, title: x.title }))
            : [];

          /*
           * WHICH RULE PUT EACH BLOCK HERE, keyed by block id.
           *
           * A block from a beat has the id b:<beatId>, and the beat carries
           * the clip — so the attribution the Footage tab already computes
           * can be attached to the block the person is reading. Same
           * compute(), same numbering, so the chip on a block and the number
           * in the pane cannot disagree.
           */
          const ruleOf = new Map(
            judged.map((m) => [
              String(m.id),
              m.in
                ? m.byId === null || isHand(m.byId)
                  ? "by hand"
                  : `rule ${numberOf(m.byId)}`
                : "",
            ]),
          );
          const blockRule: Record<string, string> = {};
          for (const bt of beats) {
            if (bt.clip_id && ruleOf.get(bt.clip_id)) blockRule[`b:${bt.id}`] = ruleOf.get(bt.clip_id)!;
          }

          return {
            addable,
            blockRule,
            rules: stored.map((r) => ({
              id: String(r.id),
              text: r.text ?? r.kind,
              on: r.on,
              hand: Boolean(r.hand),
              effect: effectLine(stored, r, { set }),
            })),
            moments: judged.map((m) => ({
              id: String(m.id),
              quote: m.text,
              source_title: titles.get(String(m.id)) ?? "",
              in: m.in,
              note: m.in
                ? m.byId === null
                  ? "in · kept by hand"
                  : isHand(m.byId)
                    ? "in · kept by hand"
                    : `in · rule ${numberOf(m.byId)}`
                : m.dropId === null
                  ? "out · no rule keeps it"
                  : isHand(m.dropId)
                    ? "out · by hand · click to keep"
                    : `out · rule ${numberOf(m.dropId)} · click to keep`,
            })),
          };
        })()),
      }) +
        exportPanel(project.id, user.plan) +
        exportsStrip({ projectId: project.id, renders }),
    ),
  );
});

/**
 * Move a block, or insert one.
 *
 * The order is stored as block ids so rearranging never deletes anything and
 * never touches the cuts — the two are independent, which is what makes both
 * undoable on their own. See docs/decisions/blocks.md.
 */
/**
 * Put the cut back the way it was.
 *
 * Undo, as a SNAPSHOT rather than a pile of inverse operations. Every gesture
 * in the editor is some combination of cuts and order — strike a line, cut a
 * selection across three of them, move a block, take out every "um" — and
 * writing an inverse for each is how an undo stack drifts out of step with
 * the thing it is undoing. Restoring the two fields the editor actually reads
 * cannot drift, and one implementation covers gestures not written yet.
 *
 * The client sends back the state it was given BEFORE its own change, so this
 * never has to keep history server-side.
 */
app.post("/api/projects/:id/restore", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ cuts?: string | null; order?: string | null }>(c);
  /* Parsed and re-serialised rather than trusted: this writes straight into
     the columns the render is built from, and a malformed cuts blob would
     make every later read silently return "no cuts" — an edit quietly
     undone. */
  const cuts = serialiseCuts(parseCuts(b.cuts ?? null));
  const order = b.order ? serialiseOrder(parseOrder(b.order)) : null;

  await c.env.DB
    .prepare(`UPDATE v2_projects SET cuts=?, block_order=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(cuts, order, Date.now(), project.id, user.id)
    .run();
  return c.json({ ok: true });
});

/**
 * TAKE BACK ONE PASS, from the conversation.
 *
 * Undo for a pass was a toast that expired after six seconds, or a keyboard
 * shortcut. The owner does not use keyboard shortcuts, so a pass — the one
 * action that rewrites the whole cut at once — was in practice irreversible
 * the moment they looked away.
 *
 * The turn in the conversation offers it instead, for as long as the turn is
 * on screen. The snapshot is claimed rather than read, so a turn can only be
 * spent once: going back twice would restore a state from before an edit made
 * in between and throw that away silently.
 */
app.post("/api/passes/:passId/undo", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ projectId?: string }>(c);
  if (!b.projectId) return c.json({ error: "which edit?" }, 400);

  /* Ownership is checked on the PROJECT, and the pass must belong to it —
     a pass row carries no user_id of its own. */
  const project = await getProject(c.env.DB, b.projectId, user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const snap = await claimPassUndo(c.env.DB, c.req.param("passId"), project.id);
  if (!snap) return c.json({ error: "that one has already been taken back" }, 409);

  /*
   * A RULES-BACKED CUT GOES BACK BY ITS RULES.
   *
   * Restoring {cuts, order} on an assembled project would put the beats back
   * and leave the rules table describing a cut that no longer exists — the
   * pane would explain one thing and the document would be another. So the
   * rule set is restored and the cut re-produced from it, which is the same
   * path every other change to it takes.
   */
  if (snap.rules) {
    let restored: Rule[];
    let scope: string[] | null;
    try {
      restored = JSON.parse(snap.rules) as Rule[];
      /*
       * A pass that did not touch the scope leaves it absent, and the
       * project's own stands. A pass that DID — attaching a video — carries
       * what it was, and that is what goes back. Restoring only the rules
       * would undo an "Added that video" pass and leave the video added.
       */
      scope = snap.scope == null ? scopeOf(project) : (JSON.parse(snap.scope) as string[] | null);
    } catch {
      return c.json({ error: "that one can't be taken back" }, 422);
    }
    const out = await recomputeFromRules(c.env, { userId: user.id, projectId: project.id, rules: restored, scope });
    if (!out) return c.json({ error: "there is no footage left to cut from" }, 422);
    await saveRules(c.env.DB, project.id, restored);
    if (snap.scope != null) {
      await c.env.DB
        .prepare(`UPDATE v2_projects SET scope=?, updated_at=? WHERE id=? AND user_id=?`)
        .bind(scope?.length ? JSON.stringify(scope) : null, Date.now(), project.id, user.id)
        .run();
    }
    return c.json({ ok: true, kept: out.kept, secs: out.secs });
  }

  /* Re-serialised rather than trusted, the same as /restore: this writes
     straight into the columns the render is built from. */
  await c.env.DB
    .prepare(`UPDATE v2_projects SET cuts=?, block_order=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(
      serialiseCuts(parseCuts(snap.cuts ?? null)),
      snap.order ? serialiseOrder(parseOrder(snap.order)) : null,
      Date.now(),
      project.id,
      user.id,
    )
    .run();
  return c.json({ ok: true });
});

app.post("/api/projects/:id/blocks/move", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ block?: string; dir?: number }>(c);
  if (!b.block) return c.json({ error: "which block?" }, 400);
  const dir = (b.dir ?? 1) < 0 ? -1 : 1;

  /* The beats were read here too and thrown away — three handlers each paid
     a round trip for a list nothing looked at. blocksForProject is what reads
     them now, and it reads them itself. */
  const segments = project.source_id ? await getSegments(c.env.DB, project.source_id) : [];
  const blocks = (await blocksForProject(c.env.DB, project, user.id, { segments })).blocks;

  const before = { cuts: project.cuts ?? null, order: project.block_order ?? null };
  const order = moveBlock(blocks, b.block, dir);
  await c.env.DB
    .prepare(`UPDATE v2_projects SET block_order=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(serialiseOrder(order), Date.now(), project.id, user.id)
    .run();

  return c.json({ ok: true, order, before });
});

/**
 * Put something of your own between two blocks.
 *
 * The gesture was stranded inside Build, on a screen that showed nothing until
 * a scoring pass had run. A new beat lands at the seam you clicked, and the
 * order records where — so the insert survives even if the transcript later
 * changes underneath it.
 */
/**
 * Make a vertical short out of one block.
 *
 * This is the whole OpusClip half of the idea, and it belongs HERE rather than
 * on a surface of its own:
 *
 * > "A 9:16 export of one strong block IS an OpusClip short. It should not
 * >  need a separate place, a separate table, or a separate word."
 * >  — docs/decisions/blocks.md
 *
 * Any block can become one — the model does not have to have picked it. That
 * is the difference from a tool that only renders what it found: you can
 * disagree with it.
 *
 * A clip row is created for the block's range so the EXISTING short renderer
 * runs unchanged. It is origin 'clipping' because that is what it is — a
 * short — and origin is exactly what keeps it out of your cut now that `kept`
 * means one thing.
 */
/**
 * How many blocks the editor renders before it starts scrolling for more.
 *
 * A three-hour podcast is 2,700 blocks and 35,100 word spans — 13.2 MB in one
 * response, with a canvas each queued for a video seek. 120 fills a tall
 * screen with room to scroll before the next slice is asked for.
 */
const BLOCK_WINDOW = 120;
/* The most a single request will send, for a jump into a long transcript. */
const BLOCK_SPAN = 600;

/**
 * The next slice of the block list.
 *
 * Rendered by the same renderCut markup the first page used, so the client
 * appends HTML rather than building a block — one definition, no drift.
 */
app.get("/api/projects/:id/blocks", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  /* Only for its poster. A library edit has no own source and each block
     carries its own frame, so null here is a working state. */
  const source = project.source_id ? await getSource(c.env.DB, project.source_id, user.id) : null;
  const segments = project.source_id ? await getSegments(c.env.DB, project.source_id) : [];
  const cuts = parseCuts(project.cuts);
  const blocks = (await blocksForProject(c.env.DB, project, user.id, { segments, posterKey: source?.poster_r2_key ?? null })).blocks;

  const from = Math.max(0, Number(c.req.query("from")) || 0);
  /*
   * Normally one window. `to` is for a jump: find a word 2,000 blocks in and
   * loading 120 at a time is seventeen round trips before you can read the
   * line. The span is capped because the reason windowing exists is that the
   * whole transcript in one response was 13.2 MB.
   */
  const asked = Number(c.req.query("to")) || 0;
  const to = Math.min(Math.max(asked, from + BLOCK_WINDOW), from + BLOCK_SPAN);
  return c.json({
    /* The slice has to match the reading it is being appended into, or a long
       transcript turns into cards halfway down. */
    html: renderBlockSlice(project.id, blocks, cuts, from, to,
      c.req.query("view") === "script" ? "script" : "blocks"),
    from,
    to: Math.min(to, blocks.length),
    total: blocks.length,
    more: to < blocks.length,
  });
});

/**
 * Every place a phrase is said in this cut.
 *
 * The palette (⌘K) searches the whole library and NAVIGATES — which is the
 * opposite of what you want mid-edit. Inside a 48-minute transcript there was
 * no way to reach "sponsor" but scrolling, and no way to act on all of them.
 *
 * Server-side because the editor holds a window of a long transcript and the
 * interesting matches are usually past it. Each match carries the index of the
 * block it is in, so clicking a result can load exactly that far and no
 * further, and the milliseconds, so the video can seek before it arrives.
 */
app.get("/api/projects/:id/find", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const q = (c.req.query("q") ?? "").trim();
  const segments = await (project.source_id ? getSegments(c.env.DB, project.source_id) : Promise.resolve([]));
  const matches = findPhrase(segments, q);
  if (!matches.length) return c.json({ q, matches: [], savedMs: 0 });

  /* Where each match sits in the block list, which is what the reader
     scrolls through — segment order and block order are not the same thing
     once anything has been moved or inserted. */
  const cuts = parseCuts(project.cuts);
  const blocks = (await blocksForProject(c.env.DB, project, user.id, { segments })).blocks;
  const at = new Map(blocks.map((b, i) => [b.id, i]));

  return c.json({
    q,
    /* What cutting every one of them would really take off, by the same rule
       the clean-up chips follow: counted, or not offered. */
    savedMs: timeSaved(segments, cuts, phraseCuts(matches)),
    matches: matches.map((m) => ({
      seg: m.seg,
      from: m.from,
      to: m.to,
      start_ms: m.start_ms,
      block: "s:" + m.seg,
      /* -1 when the line has been struck whole and is not in the list. */
      index: at.get("s:" + m.seg) ?? -1,
      before: m.before,
      hit: m.hit,
      after: m.after,
    })),
  });
});

/**
 * Moments from the whole library, for the seam's clip picker.
 *
 * Distinct from /api/projects/:id/clips, which is this project's own source:
 * pulling a clip in is only interesting when it comes from ANOTHER video —
 * a moment from this one is already a block you can just move.
 */
app.get("/api/moments", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const exclude = c.req.query("not") || "";
  const moments = await listMoments(c.env.DB, user.id, 60);
  return c.json({
    moments: moments
      .filter((m) => m.source_id !== exclude)
      .map((m) => ({
        id: m.id,
        quote: m.quote,
        source: m.source_title,
        ms: m.end_ms - m.start_ms,
        at: m.start_ms,
        frame: m.frame_r2_key,
      })),
  });
});

app.post("/api/projects/:id/blocks/short", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project?.source_id) return c.json({ error: "not found" }, 404);

  const b = await body<{ block?: string; aspect?: string; captionStyle?: string }>(c);
  if (!b.block) return c.json({ error: "which block?" }, 400);

  const source = await getSource(c.env.DB, project.source_id, user.id);
  if (!source) return c.json({ error: "not found" }, 404);

  const segments = await getSegments(c.env.DB, source.id);
  const blocks = (await blocksForProject(c.env.DB, project, user.id, { segments, posterKey: source?.poster_r2_key ?? null })).blocks;

  const block = blocks.find((x) => x.id === b.block);
  if (!block) return c.json({ error: "that block is gone" }, 404);
  /* A recording has no range in the source to cut from, so there is nothing
     to make vertical yet. Say so rather than rendering an empty file. */
  if (block.end_ms <= block.start_ms) {
    return c.json({ error: "Record something into this block first." }, 400);
  }

  /* Unrecognised values fall back rather than reaching ffmpeg: 9:16 because a
     short is vertical, and no captions because burned-in text cannot be taken
     back out of a finished file. */
  const aspect = ASPECTS.includes(b.aspect as never) ? (b.aspect as string) : "9:16";
  /* A SHORT DEFAULTS TO CAPTIONED. The full export panel defaults to None
     because you choose there and a finished file cannot be un-burned; a short
     is the one export watched with the sound off, and the landing page has
     always promised "captions burned in". Both callers used to send "None"
     and this defaulted to it too, so no short ever got any. */
  const captionStyle = CAPTION_STYLES.includes(b.captionStyle as never) ? (b.captionStyle as string) : "Bold";

  /* Reuse a clip already covering this range rather than piling up a row per
     press — the same overlap rule saveClips uses. */
  const existing = await listClipsForSource(c.env.DB, source.id, user.id);
  const hit = existing.find((cl) => cl.origin === "clipping" && overlapFraction(block, cl) > 0.8);
  const clip =
    hit ??
    (
      await saveClips(
        c.env.DB,
        { user_id: user.id, source_id: source.id, origin: "clipping", posterKey: source.poster_r2_key },
        [{
          start_ms: block.start_ms,
          end_ms: block.end_ms,
          quote: block.text,
          why: block.why ?? "You picked this one.",
          score: block.score ?? 0,
          heat: 0,
        }],
      )
    )[0];
  if (!clip) return c.json({ error: "couldn't make that one" }, 500);

  const renderId = await createShortRender(c.env.DB, {
    userId: user.id,
    clipId: clip.id,
    aspect,
    captionStyle,
  });
  /* The render, not the clip — see the note on the cut export's job. */
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: renderId });
  await dispatch(c.env, c.executionCtx, {
    type: "short-render", jobId: job.id, userId: user.id, clipId: clip.id, renderId,
  });

  return c.json({ ok: true, clipId: clip.id, renderId, jobId: job.id });
});

app.post("/api/projects/:id/blocks/insert", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ at: number; kind?: string; clipId?: string }>(c);
  const kind = (["vo", "react", "clip"] as const).find((k) => k === b.kind) ?? "vo";

  /*
   * A clip has to come from somewhere. The seam offers "A clip" as a way to
   * pull a moment out of your library into this cut, so the moment is named
   * up front — an empty clip block would be a slot with no way to fill it,
   * which is what the whole seam used to be.
   */
  if (kind === "clip" && !b.clipId) return c.json({ error: "which clip?" }, 400);

  const existing = await getBeats(c.env.DB, project.id);
  const beats = await insertBeat(c.env.DB, project.id, existing.length, {
    kind,
    act: null,
    text: null,
    clip_id: kind === "clip" ? (b.clipId ?? null) : null,
  });
  const made = beats[beats.length - 1];

  const segments = await (project.source_id ? getSegments(c.env.DB, project.source_id) : Promise.resolve([]));
  const before = (await blocksForProject(c.env.DB, project, user.id, { segments })).blocks;

  /* Insert at the seam, not at the end — the position is the whole point of
     clicking a particular one. */
  const at = Math.max(0, Math.min(Number(b.at) || 0, before.length));
  const order = before.map((x) => x.id);
  order.splice(at, 0, `b:${made.id}`);

  await c.env.DB
    .prepare(`UPDATE v2_projects SET block_order=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(serialiseOrder(order), Date.now(), project.id, user.id)
    .run();

  return c.json({ ok: true, beatId: made.id });
});

/**
 * A transcript cut. Autosaved on every gesture — there is no Save button in
 * this design and adding one would be wrong (10-ROUTES-AND-KEYS.md §Autosave).
 */
app.post("/api/projects/:id/cuts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{
    /** Block id, e.g. "s:12" or "b:<beatId>". Preferred over `seg`. */
    block?: string;
    seg?: number;
    word?: number | null;
    /**
     * A selection, as [segment, firstWord, lastWord] runs.
     *
     * Selecting a phrase and cutting it is THE text-editing gesture — the
     * reason to edit video by text at all — and a selection does not respect
     * line boundaries, so it arrives as one run per line it touches.
     */
    ranges?: Array<{ seg: number; from: number; to: number }>;
    kind: "word" | "segment" | "fillers" | "pauses" | "range";
  }>(c);
  const segments = await (project.source_id ? getSegments(c.env.DB, project.source_id) : Promise.resolve([]));
  /* What the cut looked like before this gesture. Handed back so Undo can put
     it there again without the server keeping a history. */
  const before = { cuts: project.cuts ?? null, order: project.block_order ?? null };
  let cuts = parseCuts(project.cuts);

  /*
   * Striking is a verb on a BLOCK, and blocks come in two kinds.
   *
   * A footage block is a range of the transcript, struck through `cuts`. A
   * block you inserted has no range in the source at all, so it carries its
   * own flag. The client used to send Number(id.slice(2)) for both, which for
   * a beat id is NaN — and NaN is typeof "number", so it passed the guard,
   * wrote {seg: NaN} into cuts, serialised to null, and was thrown away again
   * by parseCuts on the next read. Striking a block you added did nothing at
   * all, silently.
   */
  if (b.kind === "segment" && b.block?.startsWith("b:")) {
    /* null means no such beat. false means it is now UNSTRUCK, which is a
       success — reading it as failure is what made "Add back" do nothing. */
    const now = await toggleBeatStruck(c.env.DB, project.id, b.block.slice(2));
    if (now === null) return c.json({ error: "that block is gone" }, 404);
  } else if (b.kind === "range" && Array.isArray(b.ranges) && b.ranges.length) {
    /* Added, never toggled. A drag across ten words means "cut these", and
       toggling would put back any word inside the selection that happened to
       be struck already — which is the opposite of what the gesture says. */
    cuts = addCuts(
      cuts,
      b.ranges
        .filter((r) => Number.isInteger(r.seg) && Number.isInteger(r.from) && Number.isInteger(r.to))
        .map((r) => ({ seg: r.seg, words: [Math.min(r.from, r.to), Math.max(r.from, r.to)] as [number, number] })),
    );
    await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  } else if (b.kind === "fillers") {
    cuts = addCuts(cuts, fillerCuts(segments));
    await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  } else if (b.kind === "pauses") {
    cuts = addCuts(cuts, pauseCuts(segments));
    await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  } else if (b.kind === "segment" && Number.isInteger(b.seg)) {
    cuts = toggleSegment(cuts, b.seg as number);
    await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  } else if (b.kind === "word" && Number.isInteger(b.seg) && Number.isInteger(b.word)) {
    cuts = toggleWord(cuts, b.seg as number, b.word as number);
    await saveCuts(c.env.DB, project.id, user.id, serialiseCuts(cuts));
  } else {
    return c.json({ error: "bad cut" }, 400);
  }

  /*
   * The runtime the BLOCKS give, not the transcript's.
   *
   * runtimeAfterCuts knows only about segments, so an inserted recording added
   * nothing to the figure in the footer and striking one changed nothing —
   * even once the strike itself worked.
   */
  /* Re-read the project so the cuts just saved are the ones counted. */
  const after = (await getProject(c.env.DB, project.id, user.id)) ?? project;
  const blocks = (await blocksForProject(c.env.DB, after, user.id, { segments })).blocks;
  return c.json({
    cuts,
    before,
    afterS: runtimeMs(blocks, cuts) / 1000,
    kept: blocks.filter((x) => !x.struck).length,
  });
});

/**
 * Render the cut. Every render is a NEW row — re-rendering after an edit never
 * loses the previous version (06-BUILD-PLAN.md §Phase 3).
 */
app.post("/api/renders", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ projectId: string; format: Format; aspect: Aspect; captionStyle?: string; enhance?: boolean | string }>(c);
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
    /* Opt-in, and read as a boolean rather than trusted as one: this arrives
       from the client like everything else here. */
    enhance: b.enhance === true || b.enhance === "1",
  });
  /*
   * ref_id IS THE RENDER, and never was.
   *
   * This said `project.id`, which reads sensibly and was wrong in a way
   * nothing announced. Three pieces of code join jobs.ref_id to renders.id —
   * listRenders for the panel's live stage, secondsPerOutputSecond for the
   * estimate, and reapStaleJobs to close out the renders ROW when its job
   * dies — and all three silently matched nothing for the life of the
   * feature. The last one is why an export could say "putting it together"
   * for ever: the job was reaped, the row it belonged to was not, and the
   * panel reads the row.
   *
   * A render's job is about a render. Home learns to name one (see the feed
   * below), which is the only thing that depended on the old meaning.
   */
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: render.id });

  await dispatch(c.env, c.executionCtx, {
    type: "render", jobId: job.id, userId: user.id, projectId: project.id, renderId: render.id,
  });
  return c.json({ render, jobId: job.id });
});

/**
 * STOP.
 *
 * There was no way to stop anything in this product. Not an export, not a
 * pass, not a read — the only "cancel" in the whole codebase was Stripe's. So
 * when an export wedged, the owner's options were to watch it or to ask me to
 * go into the database, and he had to do both.
 *
 * Whatever the work is doing elsewhere, the rows say stopped from here on.
 * The queue consumer reads the job before each step; a job already failed is
 * one it abandons rather than one it resurrects. And an encoder still holding
 * a container is told to drop it, because a machine grinding on a video
 * nobody wants is the expensive half of this.
 *
 * Deliberately a FAILURE with a reason rather than a fourth state. Every
 * surface in the product already knows how to show a failed render and offer
 * Retry, and "You stopped this." is a true, readable reason. A new state
 * would have to be taught to all of them.
 */
app.post("/api/renders/:id/stop", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const id = c.req.param("id");

  const render = await c.env.DB
    .prepare(`SELECT id, state, clip_id FROM renders WHERE id=? AND user_id=?`)
    .bind(id, user.id)
    .first<{ id: string; state: string; clip_id: string | null }>();
  if (!render) return c.json({ error: "not found" }, 404);
  /* Stopping a finished render would throw away a video the user has. */
  if (render.state === "ready") return c.json({ error: "That one already finished." }, 409);

  await c.env.DB
    .prepare(`UPDATE renders SET state='failed', error='You stopped this.' WHERE id=? AND user_id=?`)
    .bind(id, user.id)
    .run();
  await c.env.DB
    .prepare(
      `UPDATE jobs SET state='failed', finished_at=?, error='You stopped this.'
        WHERE ref_id=? AND user_id=? AND type='render' AND state IN ('queued','running')`,
    )
    .bind(Date.now(), id, user.id)
    .run();

  /* Let go of the container, if one is still working. Best effort: the render
     is stopped either way, and an encoder that has already finished or been
     recycled is not a failure to report. */
  c.executionCtx.waitUntil(
    (async () => {
      /* A short's container is addressed by its clip, a cut's by its render —
         see encoderFor's callers in short-render.ts and render-job.ts. */
      const encoder = encoderFor(c.env, render.clip_id ? `short-${render.clip_id}` : `render-${id}`);
      if (!encoder) return;
      await encoder
        .fetch("http://container/render", { method: "DELETE" })
        .catch(() => undefined);
    })(),
  );

  return c.json({ ok: true });
});

/**
 * Stop a pass, for the same reason.
 *
 * A pass has no row of its own to fail — it IS the job — so this stops the
 * job and the editor's strip reads the failure from there.
 */
app.post("/api/projects/:id/pass/stop", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const { meta } = await c.env.DB
    .prepare(
      `UPDATE jobs SET state='failed', finished_at=?, error='You stopped this.'
        WHERE ref_id=? AND user_id=? AND type IN ('pass','score') AND state IN ('queued','running')`,
    )
    .bind(Date.now(), project.id, user.id)
    .run();

  return c.json({ ok: true, stopped: meta?.changes ?? 0 });
});

/**
 * SWITCH A RULE OFF, OR BACK ON, AND RE-PRODUCE THE CUT.
 *
 * The rules pane could say what every rule was doing and could not change any
 * of it, which is a report rather than a control. This is the other half:
 * invariant 1 says a cut is re-produced from rules, so flipping one has to
 * rebuild the cut from the whole set rather than patch the beats it happens to
 * disagree with.
 *
 * Nothing is deleted — `on` is a state. Toggling off and on again returns the
 * cut exactly, because both passes run the same engine over the same rules;
 * that is Phase 2's acceptance and it is a property of recomputing rather than
 * a thing this route has to be careful about.
 *
 * It records a pass, so the conversation carries it like every other edit.
 * Deliberately NOT undoable through /api/passes/:id/undo: a toggle is its own
 * inverse and already reversible by pressing it again, and an undo snapshot
 * would be a second way to say the same thing that could disagree with the
 * first.
 */
app.post("/api/projects/:id/rules/:ruleId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ on: boolean }>(c);
  const ruleId = c.req.param("ruleId");
  const rules = await loadRules(c.env.DB, project.id);
  const rule = rules.find((r) => String(r.id) === ruleId);
  if (!rule) return c.json({ error: "no such rule" }, 404);

  const on = Boolean(b.on);
  if (rule.on === on) return c.json({ ok: true, unchanged: true });

  const next = rules.map((r) => (String(r.id) === ruleId ? { ...r, on } : r));
  const out = await recomputeFromRules(c.env, { userId: user.id, projectId: project.id, rules: next, scope: scopeOf(project) });
  if (!out) return c.json({ error: "there is no footage left to cut from" }, 422);

  await saveRules(c.env.DB, project.id, next);
  await recordPass(c.env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: `${on ? "Back on" : "Off"}: ${rule.text ?? rule.kind}`,
    result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)}`,
    firstChange: null,
  }).catch(() => {
    /* The cut changed and is correct; a missing line in the log is not worth
       failing the edit for. */
  });

  return c.json({ ok: true, kept: out.kept, secs: out.secs });
});

/**
 * KEEP THIS ONE, OR CUT IT, WHATEVER THE RULES SAY.
 *
 * The Footage tab says "out · rule 02 · click to keep" on every moment a rule
 * dropped. Disagreeing with a rule is the point of showing which rule did it,
 * and the engine already has the mechanism: a hand rule overrides everything
 * above it (step 6). So this writes one and re-produces the cut.
 *
 * PRESSING IT AGAIN TAKES THE HAND BACK, rather than writing the opposite
 * hand rule. Those are different things and only one of them is reversible:
 * "I disagree with the rules here" should be undoable to "whatever the rules
 * say", and a second hand rule in the other direction would leave the moment
 * pinned by hand for ever with no way back to the rule's own answer.
 */
app.post("/api/projects/:id/moments/:momentId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const momentId = c.req.param("momentId");
  const b = await body<{ keep: boolean }>(c);
  const keep = Boolean(b.keep);

  const rules = await loadRules(c.env.DB, project.id);
  if (!rules.length) return c.json({ error: "this cut was not made from rules" }, 422);

  const key = ruleKey({ kind: keep ? "keep" : "drop", cid: momentId, hand: true, on: true });
  const already = rules.find((r) => String(r.id) === key && r.on);

  /* Any hand rule on this moment goes, whichever direction it pointed —
     leaving the other one on would have two hands fighting over one moment. */
  const other = ruleKey({ kind: keep ? "drop" : "keep", cid: momentId, hand: true, on: true });
  const next = rules.filter((r) => String(r.id) !== key && String(r.id) !== other);
  if (!already) {
    next.push({
      id: key,
      kind: keep ? "keep" : "drop",
      cid: momentId,
      hand: true,
      on: true,
      text: keep ? "Kept by hand." : "Cut by hand.",
    });
  }

  const out = await recomputeFromRules(c.env, { userId: user.id, projectId: project.id, rules: next, scope: scopeOf(project) });
  if (!out) return c.json({ error: "there is no footage left to cut from" }, 422);
  await saveRules(c.env.DB, project.id, next);

  await recordPass(c.env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: already ? "Back to what the rules say" : keep ? "Kept by hand" : "Cut by hand",
    result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)}`,
    undo: { cuts: null, order: null, rules: JSON.stringify(rules) },
    firstChange: null,
  }).catch(() => {});

  return c.json({ ok: true, kept: out.kept, secs: out.secs, byHand: !already });
});

/**
 * ADD A VIDEO TO AN OPEN CUT.
 *
 * Attaching happens before a project exists; this is the same gesture after
 * it does. The source joins the scope and the cut is re-produced — so its
 * moments are judged by the rules already on the board rather than appearing
 * in the cut unexamined, which is what "its moments join left out until a
 * rule or your hand keeps them" means once there are rules.
 *
 * A cut with NO scope already draws on the whole library, so there is nothing
 * to add to it and this says so rather than pretending to act.
 */
app.post("/api/projects/:id/attach", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const scope = scopeOf(project);
  if (!scope) return c.json({ error: "this cut already draws on everything you have" }, 422);

  const b = await body<{ sourceId: string }>(c);
  const sourceId = (b.sourceId || "").trim();
  /* Checked against the user's own sources, for the same reason the scope is
     on the way in: it is a filter, and a filter taking arbitrary strings is a
     way to ask about somebody else's library. */
  const src = sourceId ? await getSource(c.env.DB, sourceId, user.id) : null;
  if (!src) return c.json({ error: "that video isn't here" }, 404);
  if (scope.includes(src.id)) return c.json({ ok: true, unchanged: true });

  const next = [...scope, src.id];
  const rules = await loadRules(c.env.DB, project.id);
  const out = await recomputeFromRules(c.env, {
    userId: user.id,
    projectId: project.id,
    rules,
    scope: next,
  });
  if (!out) return c.json({ error: "there is nothing in that video to cut from" }, 422);

  await c.env.DB
    .prepare(`UPDATE v2_projects SET scope=?, updated_at=? WHERE id=? AND user_id=?`)
    .bind(JSON.stringify(next), Date.now(), project.id, user.id)
    .run();

  /*
   * ATTACHING IS THE SIGNAL THAT THIS FOOTAGE WILL BE CUT.
   *
   * So it is where forced alignment starts — not at the cut, where doc 17
   * puts it and where a person who has just pressed a button would wait ten
   * minutes for word timings they never asked about. In the background, and
   * idempotent: the same video attached to four projects is aligned once.
   *
   * It does not block the attach and cannot fail it. A cut on recogniser
   * timings is a cut; a cut that would not happen because a background job
   * could not be queued is not.
   */
  if (await shouldAlign(c.env, src.id)) {
    const job = await createJob(c.env.DB, { user_id: user.id, type: "align", ref_id: src.id });
    await dispatch(c.env, c.executionCtx, {
      type: "align",
      jobId: job.id,
      userId: user.id,
      sourceId: src.id,
    }).catch(() => {});
  }

  await recordPass(c.env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: `Added ${src.title}`,
    result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)}`,
    /* BOTH, because the scope is what this pass changed and the rules are
       what re-produces the cut from it. Restoring only the rules would undo
       an "Added that video" pass and leave the video added — which is what
       the first version of this did, and driving it is how that was found. */
    undo: { cuts: null, order: null, rules: JSON.stringify(rules), scope: JSON.stringify(scope) },
    firstChange: null,
  }).catch(() => {});

  return c.json({ ok: true, kept: out.kept, secs: out.secs });
});

/**
 * LABELLING: what backs what.
 *
 * Phase 0's eval set, made from inside the product because the footage is.
 * A claim arrives in the query string so the page is shareable and a reload
 * comes back to the same claim — there is no state here worth losing.
 *
 * The claim row is created on FIRST SIGHT rather than on first judgement, so
 * a claim the library backs with nothing is still in the set. Those are the
 * ones that teach a threshold to answer "nothing here backs this", and a set
 * without them teaches the opposite.
 */
/*
 * EVERY JUDGEMENT IN THIS USER'S SET, FROM BOTH TABLES.
 *
 * eval_judgements carries the labeller; eval_labels predates it and cannot
 * (its key is claim and clip alone — see src/schema.ts). Rows that have no
 * successor are read under LEGACY_LABELLER rather than attributed to
 * whoever is labelling now, because an agreement figure between a person
 * and their own unnamed earlier answers would be reported as agreement
 * between two people.
 */
const EVERY_JUDGEMENT = `
  SELECT j.claim_id AS claim_id, j.clip_id AS clip_id, j.labeller AS labeller, j.verdict AS verdict
    FROM eval_judgements j JOIN eval_claims c ON c.id = j.claim_id
   WHERE c.user_id = ?
  UNION ALL
  SELECT l.claim_id, l.clip_id, '${LEGACY_LABELLER}', l.verdict
    FROM eval_labels l JOIN eval_claims c ON c.id = l.claim_id
   WHERE c.user_id = ?
     AND NOT EXISTS (SELECT 1 FROM eval_judgements j
                      WHERE j.claim_id = l.claim_id AND j.clip_id = l.clip_id)`;

app.get("/eval", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const text = (c.req.query("claim") || "").trim();
  /* Who is answering. A name rather than an account: a claim belongs to the
     user who wrote it, so two labellers is two people at one keyboard. */
  const by = labellerName(c.req.query("by"), user.email.split("@")[0] || "me");

  const [claims, every] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT c.id, c.text,
                (SELECT COUNT(DISTINCT l.clip_id) FROM eval_labels l WHERE l.claim_id = c.id)
              + (SELECT COUNT(DISTINCT j.clip_id) FROM eval_judgements j
                   WHERE j.claim_id = c.id
                     AND NOT EXISTS (SELECT 1 FROM eval_labels l2
                                      WHERE l2.claim_id = j.claim_id AND l2.clip_id = j.clip_id)) AS judged
           FROM eval_claims c WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 40`,
      )
      .bind(user.id)
      .all<{ id: string; text: string; judged: number }>(),
    c.env.DB
      .prepare(EVERY_JUDGEMENT)
      .bind(user.id, user.id)
      .all<{ claim_id: string; clip_id: string; labeller: string; verdict: string }>(),
  ]);

  const progress = setProgress(
    (every.results ?? []).map((r) => ({ claimId: r.claim_id, clipId: r.clip_id, labeller: r.labeller })),
  );

  /*
   * HOW OFTEN THE JUDGE AGREED WITH A PERSON, as two counts.
   *
   * Counted here rather than per row, and never handed to the page per
   * moment: a verdict beside something you are about to answer is an
   * anchor, and the agreement between a person and a judge they were shown
   * measures the anchor.
   *
   * "Agreed with a person" means it matched ANY labeller's answer for that
   * pair, which is the generous reading and the honest one while the set
   * has disagreements in it — holding the judge to a verdict two people
   * could not settle would be scoring it on a question with no answer.
   */
  const { results: machineRows } = await c.env.DB
    .prepare(
      `SELECT m.claim_id, m.clip_id, m.verdict FROM eval_machine m
         JOIN eval_claims c ON c.id = m.claim_id
        WHERE c.user_id = ? AND m.version = ?`,
    )
    .bind(user.id, JUDGE_VERSION)
    .all<{ claim_id: string; clip_id: string; verdict: string }>();

  const humanSaid = new Map<string, Set<string>>();
  for (const r of every.results ?? []) {
    const key = `${r.claim_id}\u0000${r.clip_id}`;
    humanSaid.set(key, (humanSaid.get(key) ?? new Set()).add(r.verdict));
  }
  const machine = (machineRows ?? []).length
    ? {
        judged: (machineRows ?? []).length,
        agreed: (machineRows ?? []).filter((m) =>
          humanSaid.get(`${m.claim_id}\u0000${m.clip_id}`)?.has(m.verdict),
        ).length,
      }
    : null;

  let claim: { id: string; text: string } | null = null;
  let candidates: EvalData["candidates"] = [];
  let foundNothing = false;

  if (text) {
    const existing = (claims.results ?? []).find((x) => x.text === text);
    if (existing) {
      claim = { id: existing.id, text: existing.text };
    } else {
      const id = ulid();
      await c.env.DB
        .prepare(`INSERT INTO eval_claims (id,user_id,text,created_at) VALUES (?,?,?,?)`)
        .bind(id, user.id, text, Date.now())
        .run();
      claim = { id, text };
    }

    /* The same retrieval the room and the cut use, so the set is about the
       thing that actually runs rather than about a second search built to
       be measured. */
    const found = await findMaterial(c.env, user.id, text, 8);
    const moments = found.how === "recent" ? [] : found.moments;
    foundNothing = moments.length === 0;

    /* THIS labeller's answers, not everyone's: the page is somebody making
       up their own mind, and showing them what the other person said is the
       one thing that would make the agreement figure meaningless. */
    const open = claim;
    const mine = (every.results ?? []).filter((r) => r.claim_id === open.id && r.labeller === by);
    const byClip = new Map(mine.map((r) => [r.clip_id, r.verdict]));
    /* How many OTHERS have answered each one, which is honest to show and
       does not say what they answered. */
    const others = new Map<string, number>();
    for (const r of every.results ?? []) {
      if (r.claim_id !== open.id || r.labeller === by) continue;
      others.set(r.clip_id, (others.get(r.clip_id) ?? 0) + 1);
    }

    candidates = moments.map((m) => ({
      id: m.id,
      quote: m.quote,
      sourceTitle: m.source_title,
      verdict: isVerdict(byClip.get(m.id)) ? (byClip.get(m.id) as Verdict) : null,
      alsoJudged: others.get(m.id) ?? 0,
    }));
  }

  return c.html(
    page(
      { title: "What backs what — Aldershot", view: "archive", screenLabel: "Labelling", email: user.email },
      renderEval({
        claim,
        candidates,
        claims: claims.results ?? [],
        labels: progress.judgements,
        labeller: by,
        labellers: progress.labellers,
        doubleJudged: progress.doubleJudged,
        machine,
        foundNothing,
      }),
    ),
  );
});

/** One judgement. Replaces any earlier answer — changing your mind is a
    correction, not a second opinion. */
/**
 * THE SET, AS A FILE.
 *
 * Phase 0's acceptance says "the set EXISTS IN THE REPO with a runner" — not
 * in a database on one machine. A set that lives only in D1 cannot be
 * reviewed in a diff, cannot be checked out beside the code it is measuring,
 * and cannot be re-run against a model six months from now to see whether a
 * number moved.
 *
 * JSONL, one claim per line: appendable, diffable, and readable without
 * this product. Every judgement carries the quote and the word span beside
 * the id, because an id is only meaningful next to the database it came
 * from and the whole point of a file is to outlive one.
 *
 * WHAT COMES OUT IS SOMEBODY'S TRANSCRIPT. It is their own footage and
 * their own words, so this hands it to them and does not decide where it
 * goes; committing it is a choice the person makes.
 */
/**
 * ASK THE JUDGE ABOUT EVERYTHING THAT HAS BEEN LABELLED.
 *
 * One model call per claim, over exactly the pairs a person has answered —
 * see src/judge-run.ts for why it is the human judgements rather than
 * today's retrieval that sets the question list.
 *
 * A JOB, because the set is meant to reach two hundred judgements and that
 * is minutes of calls. The page shows it running like any other work in
 * this product.
 */
/**
 * SCORE ONE CLAIM, SYNCHRONOUSLY, OPTIONALLY ON A NAMED MODEL.
 *
 * The eval runner walks eval/adversarial.jsonl and asks this per claim. It
 * runs the SHIPPING judge — same prompts, same schema, same structural
 * downgrade — because an eval against a reimplementation measures the
 * reimplementation. The only thing it overrides is which model answers.
 *
 * OWNER ONLY WHEN A MODEL IS NAMED. The id reaches an inference binding and
 * spends money, and "try this model" is a thing the person paying for the
 * product gets to say rather than anybody with an account. Without a model
 * it is the ordinary judge on the ordinary capability, and anybody may ask
 * for that.
 *
 * Synchronous rather than a job: the runner wants an answer per claim to
 * aggregate, and a queue would make it poll nineteen times for work that
 * takes one call each.
 */
app.post("/api/eval/score", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const body = await c.req.json<{
    claim?: string;
    candidates?: Array<{ id?: string; quote?: string; sourceTitle?: string }>;
    model?: string;
  }>().catch(() => null);

  const claim = body?.claim?.trim();
  const candidates = (body?.candidates ?? [])
    .filter((x) => x?.id && x?.quote)
    .map((x) => ({ id: String(x.id), quote: String(x.quote), sourceTitle: String(x.sourceTitle ?? "") }));
  if (!claim || !candidates.length) return c.json({ error: "a claim and at least one candidate" }, 422);

  let model: ReturnType<typeof asCandidateModel> | undefined;
  if (body?.model) {
    if (!user.is_owner) return c.json({ error: "naming a model is owner-only" }, 403);
    if (!isModelId(body.model)) return c.json({ error: "that is not a model id" }, 422);
    model = asCandidateModel(body.model);
  }

  const out = await judge(c.env, claim, candidates, model ? { model } : {});
  return c.json({
    model: out.model,
    tokensIn: out.tokensIn,
    tokensOut: out.tokensOut,
    /* The shipping shape, including what the structural downgrade did: a
       `backs` that pointed at nothing is a different answer from a `related`
       the model chose, and an eval that flattened them would hide the one
       rule the judge applies on the way out. */
    judgements: out.judgements.map((j) => ({
      clipId: j.id,
      verdict: j.said,
      raw: j.raw,
      downgraded: j.downgraded,
      why: j.why,
    })),
  });
});

app.post("/api/eval/judge", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const judged = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM eval_claims c
        WHERE c.user_id = ?
          AND (EXISTS (SELECT 1 FROM eval_judgements j WHERE j.claim_id = c.id)
            OR EXISTS (SELECT 1 FROM eval_labels l WHERE l.claim_id = c.id))`,
    )
    .bind(user.id)
    .first<{ n: number }>();
  /* Refused rather than queued: a job that can only report "nothing to do"
     is a thing somebody has to watch finish to learn what they could have
     been told immediately. */
  if (!judged?.n) return c.json({ error: "nothing has been labelled yet" }, 422);

  const job = await createJob(c.env.DB, { user_id: user.id, type: "judge", ref_id: null });
  await dispatch(c.env, c.executionCtx, { type: "judge", jobId: job.id, userId: user.id });
  return c.json({ ok: true, jobId: job.id, claims: judged.n });
});

app.get("/api/eval/export", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const [claims, judgements, machine] = await Promise.all([
    c.env.DB
      .prepare("SELECT id, text, created_at FROM eval_claims WHERE user_id=? ORDER BY created_at")
      .bind(user.id)
      .all<{ id: string; text: string; created_at: number }>(),
    c.env.DB
      .prepare(
        `SELECT j.claim_id, j.clip_id, j.labeller, j.verdict,
                cl.quote AS quote, cl.start_word AS start_word, cl.end_word AS end_word,
                s.title AS source_title
           FROM (${EVERY_JUDGEMENT}) j
           LEFT JOIN v2_clips cl ON cl.id = j.clip_id
           LEFT JOIN sources s ON s.id = cl.source_id`,
      )
      .bind(user.id, user.id)
      .all<{
        claim_id: string;
        clip_id: string;
        labeller: string;
        verdict: string;
        quote: string | null;
        start_word: number | null;
        end_word: number | null;
        source_title: string | null;
      }>(),
    /* What the judge said, so the file carries both answers and
       `npm run eval:set` can compute the judge's two figures without a
       database, a model or a network. */
    c.env.DB
      .prepare(
        `SELECT m.claim_id, m.clip_id, m.version, m.model, m.verdict, m.raw, m.downgraded, m.line, m.why
           FROM eval_machine m JOIN eval_claims c ON c.id = m.claim_id
          WHERE c.user_id = ?`,
      )
      .bind(user.id)
      .all<{
        claim_id: string;
        clip_id: string;
        version: string;
        model: string;
        verdict: string;
        raw: string;
        downgraded: number;
        line: string | null;
        why: string | null;
      }>(),
  ]);

  const saidBy = new Map<string, (typeof machine.results)[number]>();
  for (const m of machine.results ?? []) saidBy.set(`${m.claim_id}\u0000${m.clip_id}`, m);

  const byClaim = new Map<string, typeof judgements.results>();
  for (const j of judgements.results ?? []) {
    const list = byClaim.get(j.claim_id) ?? [];
    list.push(j);
    byClaim.set(j.claim_id, list);
  }

  const lines = (claims.results ?? []).map((cl) =>
    JSON.stringify({
      claimId: cl.id,
      claim: cl.text,
      at: cl.created_at,
      /*
       * WHAT THE JUDGE SAID, once per claim rather than once per labeller:
       * it answered the pair, not the person, and repeating it under each
       * labeller would make a set with two labellers look like two
       * judgements from the model.
       */
      machine: [...new Set((byClaim.get(cl.id) ?? []).map((j) => j.clip_id))]
        .map((clipId) => saidBy.get(`${cl.id}\u0000${clipId}`))
        .filter((m) => m)
        .map((m) => ({
          clipId: m!.clip_id,
          verdict: m!.verdict,
          raw: m!.raw,
          downgraded: Boolean(m!.downgraded),
          line: m!.line,
          why: m!.why,
          version: m!.version,
          model: m!.model,
        })),
      judgements: (byClaim.get(cl.id) ?? []).map((j) => ({
        clipId: j.clip_id,
        labeller: j.labeller,
        verdict: j.verdict,
        quote: j.quote ?? "",
        sourceTitle: j.source_title ?? "",
        /* The backing utterance as a WORD SPAN, which is what Phase 0 asks
           for and what survives a re-alignment — milliseconds do not. Null
           on a moment scored before spans were written. */
        span: j.start_word === null || j.end_word === null ? null : [j.start_word, j.end_word],
      })),
    }),
  );

  return new Response(lines.join("\n") + (lines.length ? "\n" : ""), {
    headers: {
      "content-type": "application/x-ndjson",
      "content-disposition": 'attachment; filename="eval-set.jsonl"',
    },
  });
});

app.post("/api/eval/:claimId/:clipId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ verdict: string; by?: string }>(c);
  if (!isVerdict(b.verdict)) return c.json({ error: "no such answer" }, 400);

  /* Ownership is checked on the CLAIM, which carries the user — a label row
     has no user of its own. */
  const owns = await c.env.DB
    .prepare(`SELECT id FROM eval_claims WHERE id=? AND user_id=?`)
    .bind(c.req.param("claimId"), user.id)
    .first<{ id: string }>();
  if (!owns) return c.json({ error: "not found" }, 404);

  /* The labeller rides on the body because the page knows who is answering
     and the row's key needs it. Same cleaning as the page does, so "ann" and
     "ann " cannot become two labellers who agree perfectly. */
  const by = labellerName(b.by, user.email.split("@")[0] || "me");

  await c.env.DB
    .prepare(
      `INSERT INTO eval_judgements (claim_id,clip_id,labeller,verdict,created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(claim_id,clip_id,labeller)
         DO UPDATE SET verdict=excluded.verdict, created_at=excluded.created_at`,
    )
    .bind(c.req.param("claimId"), c.req.param("clipId"), by, b.verdict, Date.now())
    .run();

  return c.json({ ok: true });
});

/** The plan on screen: the claim, the beats, and where the flow got to. */
app.get("/plan/:id", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const plan = await getPlan(c.env.DB, c.req.param("id"), user.id);
  if (!plan) return c.notFound();

  return c.html(
    page(
      { title: `${plan.topic} — Aldershot`, view: "essay", screenLabel: "The plan", email: user.email },
      renderPlan({
        id: plan.id,
        topic: plan.topic,
        claim: plan.claim,
        state: plan.state,
        projectId: plan.projectId,
        beats: plan.beats.map((b) => ({
          id: b.id,
          role: b.role,
          name: b.name,
          need: b.need,
          kept: b.kept,
          found: b.found.length,
          backed: b.backed,
          /* The same sentence findForBeats gives, recomputed rather than
             stored: it is a fact about what this product can do, not about
             this plan, and storing it would freeze today's answer into a row
             that outlives it.
             The other gap — "nothing here says it" — IS about this plan and
             is derived from the stored count, so it survives a reload the
             way the thin mark does. */
          gap:
            b.role === "outside"
              ? "a voice that isn't yours — nothing here can find that yet"
              : b.backed === 0 && b.found.length
                ? "nothing here says it — the moments are about it, not of it"
                : null,
        })),
      }),
    ),
  );
});

/**
 * START A PLAN. The claim and the beats, and then it stops.
 *
 * Nothing is searched and nothing is cut: this is the cheap, reversible half,
 * and the flow holds here until the beats are answered. 11-BUILD-ORDER's
 * acceptance says it stops exactly once, and this is the once.
 */
app.post("/api/plans", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ topic: string }>(c);
  const topic = (b.topic || "").trim();
  if (!topic) return c.json({ error: "what is it about?" }, 400);

  const draft = await draftPlan(c.env, topic);
  if (!draft.beats.length) {
    return c.json({ error: "Couldn't find an argument in that — try saying what it should argue." }, 422);
  }

  const planId = await createPlan(c.env.DB, {
    userId: user.id,
    topic,
    claim: draft.claim,
    beats: draft.beats,
  });
  return c.json({ planId, claim: draft.claim, beats: draft.beats.length });
});

/** Keep or cut one beat — the answer to the stop, beat by beat. */
app.post("/api/plans/:id/beats/:beatId", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const plan = await getPlan(c.env.DB, c.req.param("id"), user.id);
  if (!plan) return c.json({ error: "not found" }, 404);

  const beatId = c.req.param("beatId");
  if (!plan.beats.some((x) => x.id === beatId)) return c.json({ error: "no such beat" }, 404);

  const b = await body<{ kept: boolean }>(c);
  await setBeatKept(c.env.DB, plan.id, beatId, Boolean(b.kept));
  return c.json({ ok: true });
});

/**
 * PAST THE STOP: find footage for every kept beat.
 *
 * The expensive half, and it does not run until the beats have been answered
 * — which is the point of the stop. Each beat's `need` goes through the same
 * retrieval the room's search box uses, so the plan and the library can never
 * disagree about what is in it.
 */
app.post("/api/plans/:id/find", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const plan = await getPlan(c.env.DB, c.req.param("id"), user.id);
  if (!plan) return c.json({ error: "not found" }, 404);

  const kept = plan.beats.filter((x) => x.kept);
  if (!kept.length) return c.json({ error: "every beat is cut — keep at least one" }, 422);

  /* The compose — retrieval, the judge, the rerank — is src/beat-find.ts,
     where the degradation can be tested: a judge that throws must cost the
     ordering and the coverage, never the beat. */
  const found = await findForBeats(kept, (need) => candidatesFor(c.env, user.id, need));

  await setFound(
    c.env.DB,
    plan.id,
    new Map(found.map((f) => [f.beatId, { ids: f.clipIds, backed: f.backed }])),
  );
  return c.json({
    ok: true,
    beats: found.map((f) => ({
      beatId: f.beatId,
      found: f.clipIds.length,
      backed: f.backed,
      thin: f.thin,
      gap: f.gap,
    })),
  });
});

/**
 * CUT IT. The plan becomes a project.
 *
 * 11-BUILD-ORDER's acceptance: "Cut it saves a project the Editor restores
 * with the plan's order as rule 03". The plan's order is a RULE rather than
 * baked into the beats, so it can be switched off like any other — which is
 * invariant 1 holding even for an order somebody spent a planning flow
 * arriving at.
 */
app.post("/api/plans/:id/cut", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const plan = await getPlan(c.env.DB, c.req.param("id"), user.id);
  if (!plan) return c.json({ error: "not found" }, 404);
  if (plan.state === "beats") return c.json({ error: "find the footage first" }, 422);
  if (plan.projectId) return c.json({ ok: true, projectId: plan.projectId, already: true });

  const clipIds = plan.beats.filter((b) => b.kept).flatMap((b) => b.found);
  if (!clipIds.length) return c.json({ error: "nothing was found for any beat" }, 422);

  const pool = await listMoments(c.env.DB, user.id, CANDIDATE_POOL);
  const wanted = new Set(clipIds);
  const moments = pool.filter((m) => wanted.has(m.id));
  if (!moments.length) return c.json({ error: "that footage is no longer here" }, 422);

  const project = await createProject(c.env.DB, {
    user_id: user.id,
    title: titleFromBrief(plan.topic, "An essay"),
    kind: "essay",
    source_id: null,
    brief: plan.claim || plan.topic,
    /* Scoped to whatever the beats actually found, so the cut draws on the
       footage the plan was built from and not the whole library. */
    scope: [...new Set(moments.map((m) => m.source_id))],
  });

  /*
   * THE PLAN'S ORDER, AS A RULE. Beat order is not chronological and not by
   * thread — it is the argument — so it arrives as a `cids` keep rule listing
   * the moments in the order the beats put them, and an order rule saying to
   * run them as given.
   */
  const ordered = clipIds.filter((id) => moments.some((m) => m.id === id));
  const rules: Rule[] = [
    {
      id: "r-keep-plan",
      kind: "keep",
      cids: ordered,
      on: true,
      text: "Keep what the plan found.",
    },
    { id: "r-order", kind: "order", order: "time", on: true, text: "Run it as the plan has it." },
  ];

  const out = await recomputeFromRules(c.env, {
    userId: user.id,
    projectId: project.id,
    rules,
    scope: [...new Set(moments.map((m) => m.source_id))],
  });
  if (!out) return c.json({ error: "that footage is no longer here" }, 422);
  await saveRules(c.env.DB, project.id, rules);
  await setPlanProject(c.env.DB, plan.id, project.id);

  await recordPass(c.env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: plan.claim || plan.topic,
    result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)} · from the plan`,
    firstChange: null,
  }).catch(() => {});

  return c.json({ ok: true, projectId: project.id, href: `/p/${project.id}/cut`, kept: out.kept });
});

/**
 * THIS CUT, AS A TIMELINE SOMEBODY ELSE'S EDITOR CAN OPEN.
 *
 * Doc 09's escape hatch and Phase 1's last acceptance item. It is a GET that
 * downloads, because that is what an escape hatch should be: no job, no
 * queue, no waiting — the edit is already data, and this is the data.
 *
 * Built from `edlForProject`, which is the SAME function the render uses. A
 * second path to "what is in this cut" would be a second answer, and the
 * whole claim of an interchange file is that it is the film you were just
 * watching.
 */
app.get("/api/projects/:id/timeline.otio", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const built = await edlForProject(c.env, project, user.id);
  if (!built || !built.edl.cuts.length) {
    return c.json({ error: "there is nothing in this cut to export yet" }, 422);
  }

  /*
   * WHAT EACH CLIP'S FILE IS CALLED, so an editor can relink it.
   *
   * The timeline points at filenames rather than at our storage — every URL
   * this product could write is presigned and expires, and an .otio that
   * relinks to nothing next week is worse than one that asks to be pointed
   * at a folder. So the names have to come from somewhere, and the somewhere
   * is the user's own sources.
   */
  const sources = await listSources(c.env.DB, user.id, "newest");
  const media = new Map(
    sources.map((s) => [
      s.r2_key,
      { name: s.filename || `${s.title}.mp4`, durationMs: s.duration_s ? s.duration_s * 1000 : null },
    ]),
  );

  const timing = await timingForProject(c.env, project.id);
  const body = otioJson(built.edl, { name: project.title, media, timing: timing.source });
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${(project.title || "timeline").replace(/[^\w.\- ]/g, "_")}.otio"`,
    },
  });
});

/**
 * THE CUE SHEET, which ships with the file.
 *
 * Doc 09 lists it among the export formats beside the subtitle file and the
 * provenance manifest, and Phase 6 accepts on it arriving "without user
 * action" — so there is no setting and nothing to tick. A cut with no
 * generated or stock pictures gets a document that says so, rather than a
 * 404: "there are none" is an answer somebody may need to show.
 */
app.get("/api/projects/:id/cuesheet", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const entries = await cueSheetFor(c.env.DB, project.id);
  const name = (project.title || "cue-sheet").replace(/[^\w.\- ]/g, "_");
  return new Response(cueSheetText(entries, project.title || "Untitled"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${name} cue sheet.txt"`,
    },
  });
});

/**
 * THE DISPUTE FILE, assembled as the video is made.
 *
 * Doc 09 is emphatic that this exists BEFORE a claim arrives, not after one:
 * a document written in answer to a complaint is written by somebody with a
 * reason to shade it, and it lands weeks late. Nothing here is computed on
 * demand except the division — the ledger, the missions and the attributions
 * were all written as the cut was built.
 *
 * The runtime comes from the same EDL the render is built from, so the ratio
 * is about the file somebody would actually publish rather than about the
 * blocks on the page. Where there is no EDL to measure, the file says the
 * runtime is not known rather than reporting nought to one.
 */
app.get("/api/projects/:id/dispute", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const entries = await disputeFor(c.env.DB, project.id);
  const built = entries.length ? await edlForProject(c.env, project, user.id) : null;
  const totalS = built ? built.edl.durationMs / 1000 : null;
  const clipS = entries.reduce((n, e) => n + usedSeconds(e), 0);

  const name = (project.title || "dispute-file").replace(/[^\w.\- ]/g, "_");
  return new Response(
    disputeText(entries, commentary(totalS, clipS), project.title || "Untitled"),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${name} dispute file.txt"`,
      },
    },
  );
});

/**
 * BEFORE YOU POST.
 *
 * Doc 09's checklist, assembled from everything that was written down as the
 * cut was made — the dispute file's rows, the cue sheet's, the captions the
 * EDL produces, and the loudness of the last export of this project.
 *
 * NOTHING IS COMPUTED SPECIALLY FOR IT and nothing is asked of a model. If a
 * line here could only be answered by going and looking at the video now,
 * that line would be a promise this product makes once and breaks whenever
 * the job is slow.
 *
 * THE LOUDNESS IS THE LAST RENDER'S, and is "not measured" before there is
 * one. A cut that has never been exported has no loudness — the number is a
 * property of a finished file, not of a plan — and saying so is better than
 * predicting it.
 */
app.get("/api/projects/:id/before-post", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const external = await disputeFor(c.env.DB, project.id);
  const pictures = await cueSheetFor(c.env.DB, project.id);
  const built = await edlForProject(c.env, project, user.id);
  const cues = built ? captionCues(built.edl) : [];

  const last = await c.env.DB
    .prepare(
      `SELECT lufs, true_peak, caption_style FROM renders
        WHERE project_id=? AND user_id=? AND state='ready'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(project.id, user.id)
    .first<{ lufs: number | null; true_peak: number | null; caption_style: string | null }>();

  const lines = beforePost({
    external,
    commentary: commentary(
      built ? built.edl.durationMs / 1000 : null,
      external.reduce((n, e) => n + usedSeconds(e), 0),
    ),
    pictures,
    loudness: loudnessVerdict({
      lufs: last?.lufs ?? null,
      truePeak: last?.true_peak ?? null,
      lra: null,
    }),
    tooFast: overTheLimit(cues),
    sidecar: sidecarWanted(last?.caption_style ?? null),
    cueCount: cues.length,
    everRendered: Boolean(last),
    hasClaim: Boolean(
      await c.env.DB
        .prepare(`SELECT 1 AS n FROM plans WHERE project_id=? AND user_id=? AND claim IS NOT NULL LIMIT 1`)
        .bind(project.id, user.id)
        .first<{ n: number }>(),
    ),
  });

  const name = (project.title || "before-you-post").replace(/[^\w.\- ]/g, "_");
  return new Response(checklistText(lines, project.title || "Untitled"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${name} before you post.txt"`,
    },
  });
});

/**
 * THE PROVENANCE MANIFEST.
 *
 * Doc 09's Provenance record row, which it marks "always on". Every source,
 * every edit, and what was left out and by which rule — the rules being the
 * edits, because invariant 1 says a cut IS its rules.
 *
 * The left-out list is computed from the same compute() the editor's Footage
 * tab reads, over the same scoped pool, so the manifest and the screen cannot
 * disagree about which rule removed what. Computing it any other way would
 * make this a second opinion about the cut rather than a record of it.
 */
app.get("/api/projects/:id/manifest", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const rules = await loadRules(c.env.DB, project.id);
  const pool = inScope(await listMoments(c.env.DB, user.id, CANDIDATE_POOL), scopeOf(project));
  const judged = rules.length ? compute(rules, { set: toFootageSet(pool, momentTags) }).st : [];

  /* What each rule says, by its own name, so leftOut reads in the person's
     words rather than in rule ids. */
  const saysOf = new Map(rules.map((r, n) => [String(r.id), r.text ?? `rule ${n + 1}`]));
  const leftOut: LeftOut[] = judged
    .filter((m) => !m.in && m.dropId !== null)
    .map((m) => ({
      momentId: String(m.id),
      text: m.text,
      rule: saysOf.get(String(m.dropId)) ?? "a rule that is no longer in the set",
    }));

  const external = await disputeFor(c.env.DB, project.id);
  const pictures = await cueSheetFor(c.env.DB, project.id);

  /* The sources this cut actually draws on: the user's own, plus whoever the
     external clips belong to. */
  const own = await listSources(c.env.DB, user.id, "newest");
  const used = new Set(pool.map((m) => m.source_id));
  const sources: ManifestSource[] = own
    .filter((srcRow) => used.has(srcRow.id) || srcRow.id === project.source_id)
    .map((srcRow) => ({ id: srcRow.id, title: srcRow.title, from: "yours" }));
  for (const e of external) {
    sources.push({
      id: e.ledgerId,
      title: e.sourceTitle ?? e.channel ?? "an external clip",
      from: e.platform ?? "elsewhere",
      ...(e.url ? { url: e.url } : {}),
    });
  }

  /* The claim and its beats, where this cut came from a plan. */
  const planRow = await c.env.DB
    .prepare(`SELECT id, claim FROM plans WHERE project_id=? AND user_id=? LIMIT 1`)
    .bind(project.id, user.id)
    .first<{ id: string; claim: string | null }>();
  let claim: Parameters<typeof buildManifest>[0]["claim"] = null;
  if (planRow?.claim) {
    const { results } = await c.env.DB
      .prepare(`SELECT name, need, found FROM plan_beats WHERE plan_id=? AND kept=1 ORDER BY idx`)
      .bind(planRow.id)
      .all<{ name: string; need: string; found: string | null }>();
    claim = {
      text: planRow.claim,
      beats: (results ?? []).map((b) => ({
        name: b.name,
        need: b.need,
        found: b.found ? (JSON.parse(b.found) as string[]) : [],
      })),
    };
  }

  const built = await edlForProject(c.env, project, user.id);

  /*
   * AND WHAT WAS STRUCK, which for most cuts is the whole of the editing.
   *
   * `leftOut` above covers moments a rule removed, and on a cut made by
   * striking text it is empty — there are no scored moments, so the engine
   * judged nothing. buildBlocks is the one place that says what a cut IS, so
   * the struck blocks come from there, exactly as the render does.
   */
  const { blocks } = await blocksForProject(c.env.DB, project, user.id);
  const struckOut = blocks
    .filter((b) => b.struck && b.text.trim())
    .map((b) => ({ blockId: b.id, text: b.text.trim() }));

  const body = manifestJson(
    buildManifest({
      projectId: project.id,
      title: project.title || "Untitled",
      runtimeS: built ? Math.round(built.edl.durationMs / 1000) : null,
      sources,
      rules,
      leftOut,
      struckOut,
      pictures,
      external,
      claim,
      madeAt: Date.now(),
    }),
  );

  const name = (project.title || "manifest").replace(/[^\w.\- ]/g, "_");
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${name} provenance.json"`,
    },
  });
});

/**
 * THE RECEIPTS PAGE A VIEWER READS.
 *
 * PUBLIC, and deliberately the only thing here that is. No requireUser, no
 * cookie, no referrer check: a link in a video description has to work for
 * somebody who has never heard of this product, on a phone, in one tap.
 *
 * The token is the whole of the authorisation and it is unguessable; a
 * revoked page is gone, and an unknown token is a plain 404 rather than
 * anything that distinguishes "never existed" from "taken down". Somebody
 * guessing tokens learns nothing either way.
 *
 * It is rebuilt from the rows on every request rather than stored as HTML.
 * A receipt that could drift from the ledger behind it is not a receipt, and
 * a maker who corrects an attribution should not have to republish.
 */
app.get("/r/:token", async (c) => {
  await ensureV2Schema(c.env.DB);
  const token = c.req.param("token");

  const page = await c.env.DB
    .prepare(`SELECT project_id, user_id FROM receipt_pages WHERE token=? AND revoked_at IS NULL`)
    .bind(token)
    .first<{ project_id: string; user_id: string }>();
  if (!page) return c.text("There is no receipts page here.", 404);

  const project = await getProject(c.env.DB, page.project_id, page.user_id);
  if (!project) return c.text("There is no receipts page here.", 404);

  const planRow = await c.env.DB
    .prepare(`SELECT claim FROM plans WHERE project_id=? LIMIT 1`)
    .bind(project.id)
    .first<{ claim: string | null }>();

  const body = receiptsHtml(
    receiptsPage({
      title: project.title || "Untitled",
      claim: planRow?.claim ?? null,
      external: await disputeFor(c.env.DB, project.id),
      pictures: await cueSheetFor(c.env.DB, project.id),
    }),
  );
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      /* Fresh enough that a corrected credit shows up, cheap enough that a
         link in a popular description does not re-read the ledger per view. */
      "cache-control": "public, max-age=300",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
});

/**
 * Publish the receipts page, or take it down.
 *
 * A form post rather than a fetch, so this needs nothing in client.ts — and
 * because publishing something to the public web should feel like pressing a
 * button on a page rather than like a thing that happened while you were
 * looking elsewhere.
 */
app.post("/api/projects/:id/receipts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const wants = String(form?.get("do") ?? "publish");

  if (wants === "revoke") {
    /* Revoked, not deleted: a page that was never published and a page
       somebody took down are different facts, and only one of them is worth
       being able to answer a question about later. */
    await c.env.DB
      .prepare(`UPDATE receipt_pages SET revoked_at=? WHERE project_id=? AND user_id=?`)
      .bind(Date.now(), project.id, user.id)
      .run();
  } else {
    /*
     * A NEW TOKEN EVERY TIME IT IS PUBLISHED.
     *
     * Republishing after a revoke has to mint a fresh one, or the old link
     * in somebody's cached description comes back to life the moment the
     * maker changes their mind twice.
     */
    const token = `${ulid()}${Math.random().toString(36).slice(2, 10)}`.toLowerCase();
    await c.env.DB
      .prepare(
        `INSERT INTO receipt_pages (project_id, user_id, token, published_at, revoked_at)
         VALUES (?,?,?,?,NULL)
         ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,
           published_at=excluded.published_at, revoked_at=NULL`,
      )
      .bind(project.id, user.id, token, Date.now())
      .run();
  }
  return c.redirect(`/api/projects/${project.id}/receipts`, 303);
});

/**
 * Where the maker manages it: the state, the link, and the one press.
 *
 * A small page of its own rather than a panel in the editor, because it is
 * the only control in this product that puts something on the public web and
 * it should be somewhere a person arrives on purpose.
 */
app.get("/api/projects/:id/receipts", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const row = await c.env.DB
    .prepare(`SELECT token, revoked_at FROM receipt_pages WHERE project_id=? AND user_id=?`)
    .bind(project.id, user.id)
    .first<{ token: string; revoked_at: number | null }>();
  const live = row && row.revoked_at === null ? row.token : null;
  const url = live ? new URL(`/r/${live}`, c.req.url).toString() : null;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipts for viewers — ${esc(project.title || "Untitled")}</title>
<style>
  body{margin:0;padding:40px 20px;background:#131316;color:#ececf1;
       font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  main{max-width:620px;margin:0 auto}
  h1{font-size:22px;letter-spacing:-0.02em;margin:0 0 10px}
  p{color:rgba(236,236,241,0.6)}
  code{display:block;padding:12px 14px;margin:18px 0;border-radius:8px;
       background:rgba(255,255,255,0.05);word-break:break-all;color:#d8b96a}
  button{font:inherit;font-weight:600;padding:9px 18px;border:0;border-radius:8px;cursor:pointer}
  .go{background:#ececf1;color:#131316}
  .stop{background:rgba(255,255,255,0.08);color:#ececf1}
  a{color:#d8b96a}
</style></head><body><main>
<h1>Receipts for viewers</h1>
${
  url
    ? `<p>This page is live. Anyone with the link can read what this video quoted and where from — nothing else about your footage is on it.</p>
       <code>${esc(url)}</code>
       <p><a href="${esc(url)}">Open it &nearr;</a></p>
       <form method="post" action="/api/projects/${esc(project.id)}/receipts">
         <input type="hidden" name="do" value="revoke">
         <button class="stop" type="submit">Take it down</button>
       </form>
       <p>Taking it down stops the link working. Publishing again makes a new link, so the old one stays dead.</p>`
    : `<p>Publish a page your viewers can read: every clip in this cut that came from somebody else, the words, the link to the original, and whether it was checked. It does not list your own footage, your rules or anything you cut.</p>
       <form method="post" action="/api/projects/${esc(project.id)}/receipts">
         <input type="hidden" name="do" value="publish">
         <button class="go" type="submit">Publish it</button>
       </form>
       <p>Nothing is public until you press this.</p>`
}
</main></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
});

app.get("/api/projects/:id/renders", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);
  return c.json({ renders: await listRenders(c.env.DB, project.id, user.id) });
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
  /* cuts carry BOTH keys: sourceKey is the master a render is cut from,
     previewKey is the editing copy the preview plays. See src/edl.ts. */
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

  /*
   * INVARIANT 8, AT THE ONE PLACE IT CAN BITE TODAY.
   *
   * "Generated is never photoreal and never over a claim or its proof."
   * `generated` and `stock` are two of the five kinds this route accepts,
   * so this is where a picture that is not the user's own footage actually
   * enters a cut — and the line it lands against decides whether it may.
   *
   * CLASSIFIED HERE RATHER THAN STORED, because the answer is needed
   * exactly once, at the moment of the insert, and a stored move goes
   * stale the moment somebody edits the line it was about. The whole cut
   * goes into the call because a move is a statement about a line IN
   * CONTEXT — a turn is only a turn against what came before it.
   *
   * AND IT REFUSES WHEN IT DOES NOT KNOW. An unanswered line is `claim`
   * (src/classify.ts), which wants the speaker's own footage and nothing
   * else — so a failed or skipped classification costs a generated card,
   * never a generated card over somebody's proof. That is the direction
   * the invariant demands.
   */
  if (kind === "generated" || kind === "stock") {
    const source: PictureSource = kind === "generated" ? "generated" : "world";
    const lines = (await blocksForProject(c.env.DB, project, user.id)).blocks
      .filter((x) => x.text.trim())
      .map((x) => ({ id: x.id, text: x.text }));
    /* The line it lands against: the one at the seam, or the last one when
       it is going on the end. */
    const against = lines[Math.min(at, lines.length - 1)];
    if (against) {
      let move: Move = UNSURE;
      try {
        move = (await classify(c.env, lines)).lines.find((x) => x.id === against.id)?.move ?? UNSURE;
      } catch {
        /* Unknown, which is `claim`, which refuses. */
      }
      const no = allowed(move, { id: "new", source, kind: source === "generated" ? "synthetic" : "illustration" });
      if (no.reason) return c.json({ error: no.reason }, 422);
    }
  }

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

  /*
   * Attach FIRST, store second.
   *
   * The other order let an unauthorised call write its bytes to R2 before
   * anything checked whose beat it was — free storage on someone else's
   * account, even once the attach itself started failing. setBeatMedia only
   * matches a beat inside one of this user's own projects.
   */
  const beatId = c.req.param("beatId");
  const key = `u/${user.id}/beats/${beatId}.webm`;
  const mine = await setBeatMedia(c.env.DB, beatId, user.id, key, Number(c.req.header("x-duration-ms") || 0));
  if (!mine) return c.json({ error: "not found" }, 404);

  await c.env.MEDIA.put(key, audio, { httpMetadata: { contentType: "audio/webm" } });

  /*
   * AND THEN FIND OUT WHAT IT ACTUALLY IS.
   *
   * The length above came from x-duration-ms — a number the BROWSER sent
   * about a file the server had not looked at, and a cut built on it is a
   * cut whose length is whatever the client said. Aligning the take to the
   * line measures it, and says whether it reads that line at all: a forced
   * aligner will happily place a script over a recording of something else
   * and report times for every word.
   *
   * IN THE BACKGROUND, because the take is already stored and already
   * usable. Making somebody wait for a container before their own
   * recording appears would be paying for correctness with the one thing
   * recording a line is supposed to be: quick.
   */
  const job = await createJob(c.env.DB, { user_id: user.id, type: "take", ref_id: beatId });
  await dispatch(c.env, c.executionCtx, {
    type: "take",
    jobId: job.id,
    userId: user.id,
    beatId,
  }).catch(() => {});

  return c.json({ ok: true, key });
});

/**
 * SAY IT INSTEAD OF TYPING IT.
 *
 * Nothing in this market lets you speak an edit instruction — four search
 * angles turned up only voice OUTPUT, text-to-speech and cloning and dubbing.
 * The likely reason is a real one: editing is issue-then-review, voice is good
 * at issuing and bad at reviewing, and review is where the time goes.
 *
 * So this transcribes and hands the words back. It does NOT run a pass. You
 * speak it, you read it in the composer, you change it if it heard you wrong,
 * and then you press the button. Voice is the fast way in, not a way to spend
 * minutes and money on a sentence nobody checked.
 *
 * No job, no queue: an instruction is a few seconds of audio, so it answers
 * in the request. Nothing is stored — the audio is read, transcribed and
 * dropped. It never becomes a source, so it never counts against storage.
 */
app.post("/api/dictate", async (c) => {
  const user = await requireUser(c);
  const audio = await c.req.arrayBuffer();
  if (!audio.byteLength) return c.json({ error: "nothing was recorded" }, 400);

  /* A minute of speech at the recorder's bitrate is comfortably under this.
     An instruction that long is a paragraph, and a paragraph is typed. */
  if (audio.byteLength > 4_000_000) return c.json({ error: "that was too long — try a sentence" }, 413);

  try {
    const heard = await transcribeOnce(c.env, audio, {});
    const text = (heard.text || "").trim();
    if (!text) return c.json({ error: "I didn't catch that" }, 422);

    /*
     * Metered like every other model call — with a real number this time.
     *
     * source_minutes was 0, and computeCost multiplies the neuron rate BY
     * source_minutes, so every dictation booked exactly $0.00 while making a
     * genuine Whisper call. "A job that does not meter is a bug" applies to a
     * job that meters zero just as much.
     *
     * The length is the audio's own, from the model rather than guessed: the
     * upload is capped at 4 MB above, which at the recorder's bitrate is a
     * sentence or two, so this is fractions of a cent — but fractions of a
     * cent times every press of the mic button is a line on the invoice, and
     * an unmetered one is a line nobody can see.
     */
    await meter(c.env.DB, {
      user_id: user.id,
      job_type: "transcribe",
      source_minutes: heard.duration / 60,
    }).catch(() => {});
    return c.json({ text });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "I didn't catch that" }, 502);
  }
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
/**
 * What this inserted block says.
 *
 * There was no way to write it. You could add a block, and then it sat there
 * as the words "Your voice" with nothing to do — the "building blocks" the
 * owner remembered, added and inert. Both things that can fill one need this
 * first: recording reads it back to you, and TTS refuses without it
 * ("there's nothing written on this beat yet").
 */
/**
 * Throw a take away.
 *
 * A recording you are not happy with has to be removable, or "Another take"
 * is the only way out and the block can never go back to empty. The R2 object
 * goes too — an abandoned take is not something to keep paying to store.
 */
app.post("/api/beats/:id/unrecord", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

  const beat = await c.env.DB
    .prepare(
      `SELECT b.id, b.media_r2_key FROM beats b JOIN v2_projects p ON p.id = b.project_id
        WHERE b.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
    )
    .bind(c.req.param("id"), user.id)
    .first<{ id: string; media_r2_key: string | null }>();
  if (!beat) return c.json({ error: "not found" }, 404);

  if (beat.media_r2_key) await c.env.MEDIA.delete(beat.media_r2_key);
  await c.env.DB
    .prepare(`UPDATE beats SET media_r2_key=NULL, recorded_at=NULL, dur_ms=NULL WHERE id=?`)
    .bind(beat.id)
    .run();
  return c.json({ ok: true });
});

app.post("/api/beats/:id/text", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{ text?: string }>(c);

  /* Ownership through the project, the same join the other beat routes use —
     a beat id alone says nothing about who it belongs to. */
  const beat = await c.env.DB
    .prepare(
      `SELECT b.id FROM beats b JOIN v2_projects p ON p.id = b.project_id
        WHERE b.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
    )
    .bind(c.req.param("id"), user.id)
    .first<{ id: string }>();
  if (!beat) return c.json({ error: "not found" }, 404);

  const text = (b.text ?? "").trim().slice(0, 2000);
  await c.env.DB.prepare(`UPDATE beats SET text=? WHERE id=?`).bind(text || null, beat.id).run();
  return c.json({ ok: true, text });
});

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
    /* The TTS route already fetched this beat through a user join, so this
       cannot fail — but it takes the user like every other caller, so the
       check cannot be forgotten if that lookup ever changes. */
    await setBeatMedia(c.env.DB, beat.id, user.id, key, wavDurationMs(bytes));
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

  /* Cut material only. A Clipping short is an export of a moment, not
     something you can put in a beat. */
  const clips = await cutClips(c.env.DB, project.source_id, user.id);
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
  /* A SHORT DEFAULTS TO CAPTIONED. The full export panel defaults to None
     because you choose there and a finished file cannot be un-burned; a short
     is the one export watched with the sound off, and the landing page has
     always promised "captions burned in". Both callers used to send "None"
     and this defaulted to it too, so no short ever got any. */
  const captionStyle = CAPTION_STYLES.includes(b.captionStyle as never) ? (b.captionStyle as string) : "Bold";

  const renderId = await createShortRender(c.env.DB, { userId: user.id, clipId: clip.id, aspect, captionStyle });
  /* The render, not the clip — see the note on the cut export's job. */
  const job = await createJob(c.env.DB, { user_id: user.id, type: "render", ref_id: renderId });

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

/**
 * A PASTED BRIEF BECOMES RULES.
 *
 * Phase 5's acceptance: "hooks in 2s, 20–40s, no politics, we need 8"
 * compiles to four visible rules with a shortlist diff.
 *
 * THE DIFF IS THE RULES PANE, not a second thing built for this. Every rule
 * there already carries `effectLine` — what it is doing right now, computed
 * by diffing the cut with and without it — so a compiled brief is four rows
 * that each say what they took off the shortlist, in the place a person
 * already looks. A separate diff view would be a second answer to the same
 * question.
 *
 * What the response adds is the one thing the pane cannot say: whether the
 * number was reached. A shortlist of five when eight were asked for is the
 * thing a person most needs to be told and the thing five rows do not say.
 */
app.post("/api/projects/:id/brief", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ brief: string }>(c);
  const brief = (b.brief || "").trim();
  if (!brief) return c.json({ error: "paste a brief first" }, 400);

  const asked = compileBrief(brief);
  /* Nothing in it was a rule. Say what would be, rather than applying
     nothing and reporting success. */
  if (!asked.rules.length) return c.json({ error: honestReply([brief]) }, 422);

  const before = await loadRules(c.env.DB, project.id);
  let next = before;

  /*
   * A BRIEF IS A FILTER, AND A FILTER NEEDS SOMETHING TO FILTER.
   *
   * The engine starts with nothing in and `keep` rules mark moments in, so
   * a brief made only of length, count, subject and hook rules computes a
   * shortlist of zero — correct arithmetic and a useless answer to
   * somebody who just pasted four requirements.
   *
   * So a project with no keep rule gets one, and it is a RULE like any
   * other: visible in the pane, switchable, and saying plainly that it was
   * added rather than asked for. Found by pasting the acceptance's own
   * brief at a real project and getting nought back.
   */
  const keeps = (rs: Rule[]) => rs.some((r) => r.on && r.kind === "keep" && !r.hand);
  if (!keeps(before) && !asked.rules.some((r) => r.kind === "keep")) {
    next = applyRule(next, {
      kind: "keep",
      tag: "core",
      on: true,
      text: "Start from everything you have.",
      id: ruleKey({ kind: "keep", tag: "core", on: true }),
    });
  }

  for (const r of asked.rules) next = applyRule(next, { ...r, id: ruleKey(r) });

  const out = await recomputeFromRules(c.env, {
    userId: user.id,
    projectId: project.id,
    rules: next,
    scope: scopeOf(project),
  });
  if (!out) return c.json({ error: "there is no footage left to cut from" }, 422);
  await saveRules(c.env.DB, project.id, next);

  /* The same set the recompute just ran over, so the diff describes the cut
     that was saved rather than one computed from a different library. */
  const pool = inScope(await listMoments(c.env.DB, user.id, CANDIDATE_POOL), scopeOf(project));
  const diff = shortlistDiff(next, { set: toFootageSet(pool, (m) => momentTags(m)) });

  await recordPass(c.env.DB, {
    projectId: project.id,
    sourceId: null,
    instruction: brief,
    result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)}`,
    undo: { cuts: null, order: null, rules: JSON.stringify(before) },
    firstChange: null,
  }).catch(() => {});

  return c.json({
    ok: true,
    rules: next.filter((r) => r.on).length,
    kept: out.kept,
    short: diff.short,
    /* Per rule, for the reply — the pane shows the same thing in place. */
    diff: diff.rules.map((r) => ({ text: r.rule.text ?? r.rule.kind, removed: r.removed, added: r.added })),
  });
});

/** An extra instruction against what the pass already found. */
app.post("/api/projects/:id/passes", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const project = await getProject(c.env.DB, c.req.param("id"), user.id);
  if (!project) return c.json({ error: "not found" }, 404);

  const b = await body<{ instruction: string }>(c);
  const instruction = (b.instruction || "").trim();
  if (!instruction) return c.json({ error: "say what you want" }, 400);

  /*
   * WHAT THE ASSISTANT CAN DO TO AN EDIT WITH NO TRANSCRIPT OF ITS OWN.
   *
   * A cut assembled from the library is blocks pulled out of other videos, and
   * a selecting pass reads a transcript to decide what to keep — there is not
   * one here yet, because a pulled block does not carry its source's words
   * (src/blocks.ts, `words: []`).
   *
   * Reordering does not need words: it works on the blocks themselves. So a
   * library edit takes an arrange instruction and refuses a selecting one in
   * plain words, rather than returning "not found" about a project that is
   * plainly right there.
   */
  /*
   * ON AN ASSEMBLED CUT, A SENTENCE IS A RULE.
   *
   * This used to refuse everything but a reorder: "there is no transcript to
   * read yet — but I can put it in a different order." That was true when a
   * selecting pass meant reading a transcript, and a pulled block carries
   * none. It stopped being true when the rule engine landed. Selection on an
   * assembled cut is not a reading problem at all — the moments are already
   * chosen and tagged, and "lose the hedging", "keep it under 90 seconds",
   * "the start drags" are all rules the engine can apply with no model call
   * and no transcript.
   *
   * Deterministic, synchronous, and no job: there is nothing to wait for.
   * That is the point of rules rather than passes — the cut is re-produced
   * from them, and re-producing it is arithmetic.
   */
  if (!project.source_id) {
    const asked = parseRules(instruction);
    if (asked.rules.length) {
      const before = await loadRules(c.env.DB, project.id);
      let next = before;
      for (const r of asked.rules) {
        /* Saying what a rule already on the board does adds nothing. */
        const same = next.some((x) => x.on && x.kind === r.kind && x.tag && x.tag === r.tag);
        if (!same) next = applyRule(next, { ...r, id: ruleKey(r) });
      }

      const out = await recomputeFromRules(c.env, { userId: user.id, projectId: project.id, rules: next, scope: scopeOf(project) });
      if (!out) return c.json({ error: "there is no footage left to cut from" }, 422);
      await saveRules(c.env.DB, project.id, next);

      await recordPass(c.env.DB, {
        projectId: project.id,
        sourceId: null,
        instruction,
        result: `${out.kept} moment${out.kept === 1 ? "" : "s"} · ${fmtSecs(out.secs)}`,
        /* The RULE SET as it stood, not the cuts — on a rules-backed project
           the rules are the state and the beats are the consequence. */
        undo: { cuts: null, order: null, rules: JSON.stringify(before) },
        firstChange: null,
      }).catch(() => {});

      return c.json({ ok: true, kept: out.kept, secs: out.secs });
    }

    /*
     * Nothing in it was a rule. Say what would be, rather than the old line
     * about transcripts — which named the wrong reason and offered the one
     * thing that is now only a special case of the right one.
     */
    return c.json({ error: honestReply([instruction]) }, 422);
  }

  const job = await createJob(c.env.DB, { user_id: user.id, type: "pass", ref_id: project.id });
  await dispatch(c.env, c.executionCtx, {
    type: "score",
    jobId: job.id,
    userId: user.id,
    sourceId: project.source_id ?? "",
    projectId: project.id,
    brief: instruction,
  });
  /* A pass CHANGES the cut now, so it needs an undo like every other edit —
     and the change lands minutes later, so the state to go back to is the one
     that exists right now. The editor holds it until the job finishes. */
  return c.json({
    jobId: job.id,
    before: { cuts: project.cuts ?? null, order: project.block_order ?? null },
  });
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

  /*
   * Editor means the EDITOR.
   *
   * This page was Home again: a composer, then the same footage under "Or open
   * something already here", then the same edits under "Pick up an edit" —
   * three lists in different words, with half the screen empty below them.
   * Home answers "what needs you" and owns picking one up; a nav item called
   * Editor that shows a list of things is the same failure as Clipping and
   * Footage both showing clips.
   *
   * So it opens what you were last in. listProjects is already ordered by
   * updated_at, so the first row is that. With nothing made yet it falls
   * through to intake, which is what the route was always for.
   */
  if (projects.length) return c.redirect(`/p/${projects[0].id}/cut`);

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
      }),
      user.email,
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
  return copy ? c.json({ ok: true, ...copy, href: `/p/${copy.id}/cut` }) : c.json({ error: "not found" }, 404);
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

/**
 * The signed-out site, while signed in.
 *
 * Settings has linked to /landing since it was built and nothing has ever
 * served it — the marketing page renders at / when there is no session, so
 * the only way to see it was to sign out. A dead link on a shipped page, and
 * found by pressing it rather than by reading it.
 *
 * No account state reaches it: it renders exactly what a stranger sees, which
 * is the whole reason to look at it.
 */
/**
 * The mark, as a tab icon.
 *
 * There was none, so every tab in every browser showed the generic globe —
 * on a product whose wordmark is three coloured bars and whose whole pitch is
 * that it was designed. It is the first thing anybody sees of it and the last
 * thing to get made.
 *
 * The bars themselves, at the wordmark's own proportions and opacities, in
 * the gold that leads on Home. SVG rather than .ico: it stays sharp at every
 * size, it is 300 bytes, and it is the same three rectangles the nav draws
 * rather than a second drawing of the same thing that can drift from it.
 */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${C.canvas}"/>
  <rect x="6"  y="9" width="5" height="14" rx="2" fill="${ACCENT.gold}"/>
  <rect x="13.5" y="9" width="5" height="14" rx="2" fill="${ACCENT.gold}" opacity="0.5"/>
  <rect x="21" y="9" width="5" height="14" rx="2" fill="${ACCENT.gold}" opacity="0.22"/>
</svg>`;

app.get("/favicon.svg", (c) =>
  c.body(FAVICON, 200, {
    "content-type": "image/svg+xml",
    "cache-control": "public, max-age=86400",
  }),
);

/* Browsers ask for this by name whatever the page says, and a 404 per
   navigation is noise in every log. Served the same drawing. */
app.get("/favicon.ico", (c) =>
  c.body(FAVICON, 200, {
    "content-type": "image/svg+xml",
    "cache-control": "public, max-age=86400",
  }),
);

app.get("/landing", async (c) => {
  return c.html(
    renderLanding({ sentTo: null, devLink: null, error: null, google: googleConfigured(c.env) }),
  );
});

app.get("/settings", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);

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
  /* The owner is metered and never blocked — checkCap and checkStorage both
     pass them — so a ceiling here would be a number nothing enforces. What
     they have used is the point, and it stays. */
  const uncapped = Boolean(user.is_owner);
  const meters = [
    {
      label: "Processing minutes",
      used: Math.round(roll.source_minutes),
      cap: limits.sourceMinutes,
      uncapped,
      unit: "",
      color: ACCENT_CYAN,
      /*
       * WHAT IT SAYS IS NOW WHAT IT COUNTS.
       *
       * This promised the meter covered rendering and captions. checkCap sums
       * usage_events WHERE job_type = 'transcribe' and nothing else, so a
       * render has never once moved this number. Three surfaces said it
       * anyway: here, and twice on the landing page.
       *
       * The copy is what changes, not the charge. Whether a render SHOULD cost
       * a customer minutes is a pricing decision and not one to make by
       * quietly starting to bill for it; exports being free is also the better
       * thing to be true, so it is said out loud instead.
       */
      note: "Spent reading your footage. Cutting and exporting from it are free. Resets on the 1st.",
    },
    {
      label: "Storage",
      used: Math.round((storedNow / 1e9) * 10) / 10,
      cap: limits.storageGb,
      uncapped,
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
      user.email,
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
  const b = await body<{ filename: string; contentType: string; bytes: number; brief?: string; durationS?: number }>(c);
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

  /*
   * IS IT A VIDEO, and is there room in the month for it?
   *
   * Neither was asked. The comment above this block is headed "THE CAP, BEFORE
   * THE BYTES" and only storage was checked — the MINUTES cap ran at
   * src/ingest.ts, after the whole file was up. A free user with twenty
   * minutes left could spend forty minutes uploading four gigabytes to be
   * told no. The browser has already measured the duration; it just was not
   * being sent.
   *
   * Nothing checked the type either, and both drop handlers bypass the
   * picker's accept="video/*", so a PDF uploaded in full and failed somewhere
   * downstream where the reason made no sense.
   */
  const type = String(b.contentType || "");
  if (type && !/^(video|audio)\//.test(type)) {
    return c.json({ error: "That is not a video. Add a video or an audio file." }, 415);
  }

  const mins = Number(b.durationS) > 0 ? Number(b.durationS) / 60 : 0;
  if (mins > 0) {
    const cap = await checkCap(c.env.DB, user.id, user.plan, mins);
    if (!cap.ok) return c.json({ error: cap.message }, 413);
  }

  /* The sentence rides with the footage. It cannot be acted on until there is
     a transcript, and the page that typed it may be gone by then — see
     src/schema.ts on sources.brief. */
  const src = await createSource(c.env.DB, {
    user_id: user.id,
    filename,
    origin: "upload",
    brief: (b.brief || "").trim(),
  });
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

  /* The real size, from R2 rather than from what the client claimed. It is
     what the storage meter counts, so it has to be the object's own. */
  const object = await c.env.MEDIA.head(src.r2_key);

  // The upload is done; its bookkeeping is no longer resumable state.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM upload_parts WHERE source_id=?`).bind(src.id),
    c.env.DB.prepare(`DELETE FROM uploads WHERE source_id=?`).bind(src.id),
    c.env.DB.prepare(`UPDATE sources SET bytes=? WHERE id=?`).bind(object?.size ?? null, src.id),
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
/*
 * POST /api/intent was here: it classified a sentence and returned the label.
 *
 * Nothing called it, and it was the one route on this worker with no
 * requireUser — so the only thing it did was offer an unauthenticated model
 * classifier to anyone who found it. readIntent and intentLabel are still
 * used, by /api/begin, where the answer is actually needed.
 */

/** Begin — one sentence becomes the right kind of work. */
app.post("/api/begin", async (c) => {
  await ensureV2Schema(c.env.DB);
  const user = await requireUser(c);
  const b = await body<{
    sourceId: string;
    sourceIds?: unknown[];
    ledgerIds?: unknown[];
    brief: string;
    upgrade: boolean;
  }>(c);

  /*
   * THE GHOSTS THAT WERE ATTACHED, checked before anything is made.
   *
   * Same check as `sourceIds` and for the same reason: an id off a form is a
   * claim. minesOwn joins each one back through its run to a project of this
   * user's, so an id from somebody else's library is simply not there.
   */
  const askedGhosts = Array.isArray(b.ledgerIds) ? b.ledgerIds.filter((x) => typeof x === "string") : [];
  const ghosts = askedGhosts.length
    ? [...(await minesOwn(c.env.DB, user.id, askedGhosts as string[]))]
    : [];

  /*
   * A BRIEF WITH NO VIDEO MEANS "OUT OF EVERYTHING I HAVE".
   *
   * This used to refuse — "pick a video first" — and that refusal was the
   * whole single-source assumption in one line: an edit had to begin with one
   * file. Say what you want without choosing a video and it searches the
   * library instead, by meaning where the index exists and by words where it
   * does not, and assembles what it finds into a cut with no source of its own.
   *
   * Still refuses an empty request: no video AND no sentence is not a brief,
   * it is a stray press.
   */
  if (!b.sourceId) {
    const brief = (b.brief || "").trim();
    if (!brief) return c.json({ error: "pick a video, or say what you want" }, 400);

    /*
     * ATTACHED FOOTAGE, WHEN THEY ATTACHED SOME.
     *
     * `sourceId` is one video and takes the single-source path. This is the
     * many-video answer: say what you want with two videos attached and the
     * rules apply to those two, which is what "tighten this" means when you
     * have pointed at something. Ids are checked against the user's own
     * sources rather than trusted, because a scope is a filter and a filter
     * taking arbitrary strings is a way to ask about somebody else's library.
     */
    const asked = Array.isArray(b.sourceIds) ? b.sourceIds.filter((x) => typeof x === "string") : [];
    let scope: string[] | null = null;
    if (asked.length) {
      const mine = new Set((await listSources(c.env.DB, user.id, "newest")).map((x) => x.id));
      scope = asked.filter((id) => mine.has(id));
      if (!scope.length) return c.json({ error: "those videos aren't here any more" }, 422);
    }

    const made = await assembleFromLibrary(c.env, { userId: user.id, brief, scope });
    if ("error" in made) return c.json({ error: made.error }, 422);
    /*
     * THE MISSIONS ARE OPENED AFTER THE PROJECT EXISTS, not before.
     *
     * A mission belongs to a cut. Writing one against a project that the
     * assemble might refuse to make would leave a mission for a cut that
     * does not exist, and invariant 6 means it would stay there.
     */
    if (ghosts.length) await openMissions(c.env.DB, made.projectId, ghosts);
    return c.json({
      intent: "assemble",
      projectId: made.projectId,
      jobId: null,
      href: `/p/${made.projectId}/cut`,
      used: made.used,
    });
  }

  const src = await getSource(c.env.DB, b.sourceId, user.id);
  if (!src) return c.json({ error: "not found" }, 404);

  const result = await begin(
    c.env,
    {
      userId: user.id,
      sourceId: src.id,
      brief: b.brief || "",
      upgrade: b.upgrade,
      sourceTitle: src.title,
      cutTitle: src.cut_title,
    },
    c.executionCtx,
  );

  /* A sentence about ONE video can still carry ghosts — attach a find, then
     attach a video, then run it. begin() returns the project it made. */
  if (ghosts.length && "projectId" in result && typeof result.projectId === "string") {
    await openMissions(c.env.DB, result.projectId, ghosts);
  }

  /* begin() dispatches its own work now — it is the only thing that knows
     which job the sentence asked for. Dispatching here as well ran every
     brief through a scoring pass on top of whatever it actually wanted. */
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
async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  await ensureV2Schema(env.DB);

  const { results } = await env.DB
    .prepare(
      `SELECT DISTINCT user_id FROM jobs WHERE state IN ('queued','running')
       UNION
       SELECT DISTINCT user_id FROM sources WHERE transcript_state='pending' AND deleted_at IS NULL`,
    )
    .all<{ user_id: string }>();

  await reapRateLimits(env.DB);

  /* Footage read before naming existed still shows its filename. Bounded, and
     outside the per-user loop because it is scoped by what is unnamed rather
     than by who has work in flight. */
  try {
    await nameUnnamedSources(env);
  } catch (err) {
    console.log(`[sweep] naming: ${err instanceof Error ? err.message : String(err)}`);
  }

  /* Extracted audio from before it was deleted at the end of a read. Bounded
     per sweep and idempotent, so it works through the backlog an hour at a
     time and costs nothing once there is none left. */
  try {
    const freed = await reapUsedAudio(env.DB, env.MEDIA);
    if (freed) console.log(`[sweep] freed ${Math.round(freed / 1e6)}MB of used audio`);
  } catch (err) {
    console.log(`[sweep] audio: ${err instanceof Error ? err.message : String(err)}`);
  }

  /* Footage read before the editing copy existed. OFF by default now — this
     was four x264 transcodes an hour on a standard-4, forever, billing about
     $40 a month to an account nobody was using. proxyFirst gives the video you
     actually open its copy on demand, which is the only moment it matters. The
     limit is a parameter, so working a backlog off deliberately is one number
     here rather than a code change. See src/proxy.ts. */
  try {
    const made = await backfillProxies(env);
    if (made) console.log(`[sweep] made ${made} editing cop${made === 1 ? "y" : "ies"}`);
  } catch (err) {
    console.log(`[sweep] proxy: ${err instanceof Error ? err.message : String(err)}`);
  }

  /*
   * THE MEANING INDEX CATCHES UP WITH THE LIBRARY.
   *
   * Deliberately here rather than at the three places clips are written. A
   * call site you have to remember is one a fourth call site will forget —
   * that is exactly how the signed-in avatar ended up missing on half the app.
   * Every clip lands with embedded_at NULL, so the sweep finds it whatever
   * wrote it, and a new way of making clips is indexed without anyone wiring
   * anything.
   *
   * Cheap and self-terminating, unlike the proxy backfill that used to live
   * here: no container, no encode, a couple of hundred short strings through
   * an embedding model, and nothing at all to do once the library is caught
   * up. It costs roughly a thousandth of a cent per clip.
   *
   * A no-op until someone creates the index — see docs/SETUP.md.
   */
  try {
    const added = await backfillClipIndex(env);
    const gone = await reapClipIndex(env);
    if (added || gone) console.log(`[sweep] meaning index: +${added} -${gone}`);
  } catch (err) {
    console.log(`[sweep] index: ${err instanceof Error ? err.message : String(err)}`);
  }

  /* Videos that failed because a container slot was busy rather than because
     anything was wrong with them. The queue retries within a job now; this is
     for the ones that failed before it did. */
  try {
    const back = await requeueTransientReads(env, ctx);
    if (back) console.log(`[sweep] put ${back} video(s) back in the queue`);
  } catch (err) {
    console.log(`[sweep] requeue: ${err instanceof Error ? err.message : String(err)}`);
  }

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
