/**
 * EVERY SURFACE A PERSON CAN SEE, DERIVED RATHER THAN LISTED.
 *
 * Two scripts kept their own hand-written list of pages: `check-fidelity.cjs`
 * had nine route literals and `walk.cjs` six surfaces, four of which were
 * retired pages. Between them they never reached Words, Shorts, five of
 * Footage's seven tabs, /eval, /plan/:id, /r/:token, the Scout board, /home,
 * /sources/:id or the signed-out landing page — ten surfaces, several with no
 * test either. Every defect the prototype comparison found this month was on a
 * page one of those lists had simply never mentioned.
 *
 * A list maintained by hand goes stale the first time somebody adds a route
 * and does not think of it. So this reads `src/index.ts` and works out which
 * routes render HTML, and the two scripts read this.
 *
 * HOW IT DECIDES A ROUTE IS A PAGE: the handler returns a document — `c.html(`
 * or a Response declaring `text/html`. Both, because /r/:token does the
 * second, and a detector that only knew the first missed THE ONLY PAGE THIS
 * PRODUCT SHOWS THE PUBLIC. A route whose handler is a named function
 * (`app.get("/", roomHandler)`) is followed to that function, and one that
 * calls a named handler inside its own body is followed too.
 *
 * WHAT IT CANNOT DO. A redirect is not a page and is not listed — /projects
 * and /clipping 303 and 302 into surfaces that are. An overlay reached by
 * pressing something (Before you post, the recorder, the export fan) has no
 * URL and cannot appear here; those are driven, not crawled.
 */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const SRC = join(__dirname, "..", "src", "index.ts");

/**
 * What counts as returning a document.
 *
 * `c.html(` is the usual way and `text/html` on a hand-built Response is the
 * other. /r/:token takes the second route — `new Response(body, { headers: {
 * "content-type": "text/html; charset=utf-8" } })` — so a detector that knew
 * only about c.html left the one page shown to the public out of every crawl.
 */
const RENDERS = /c\.html\(|text\/html/;

/** Assets and endpoints that answer with bytes or JSON, never a document. */
const isPage = (route) => !route.startsWith("/api/") && !/\.(js|svg|ico)$/.test(route);

/**
 * Every route whose handler returns a document, as declared.
 *
 * Returns the route patterns, `:param` and all. Expansion into real URLs
 * needs a running server and lives in `expand` below.
 */
function declared(source = readFileSync(SRC, "utf8")) {
  /*
   * A HANDLER ENDS AT THE NEXT TOP-LEVEL STATEMENT, whatever kind it is.
   *
   * Two wrong versions before this one, both of which mislabelled a route:
   *
   * 1. "from one app.get to the next app.get at column 0" swallowed anything
   *    between them. /projects is a one-line redirect followed by
   *    `const roomHandler = ...`, so its window picked up roomHandler's
   *    `c.html(` and a 303 was listed as a page — which would have put a
   *    redirect in the crawl and reported a surface under a URL nobody uses.
   *
   * 2. Balancing the call's own parentheses, which this file defeats: the
   *    bodies are full of template literals holding `${...}` and the odd
   *    nested backtick, so the scan ran past the close and swallowed later
   *    handlers. /media/* and /api/projects/:id/receipts both came back as
   *    pages, and neither returns a document.
   *
   * The boundary that actually holds is the next line beginning at column 0
   * with a statement — another route, a const, a function. Every route in
   * src/index.ts is written that way, and so is every named handler.
   */
  const lines = source.split("\n");
  const TOP = /^(app\.(?:get|post|put|patch|delete|all|on|use)\(|const |let |function |async function |export )/;

  const bodyFrom = (i) => {
    let end = i + 1;
    while (end < lines.length && !TOP.test(lines[end])) end += 1;
    return lines.slice(i, end).join("\n");
  };

  /* Named handlers, so `app.get("/", roomHandler)` can be followed. */
  const named = new Map();
  lines.forEach((line, i) => {
    const m = /^const (\w+)\s*=\s*async \(c[:\s)]/.exec(line);
    if (m) named.set(m[1], bodyFrom(i));
  });

  const pages = [];
  const htmlUnderApi = [];
  lines.forEach((line, i) => {
    const m = /^app\.get\("([^"]+)"\s*,\s*(.*)$/.exec(line);
    if (!m) return;
    const route = m[1];
    let body = bodyFrom(i);
    /*
     * FOLLOW THE HANDLERS, both ways they are written.
     *
     * `app.get("/home", homeHandler)` passes one, and `/` CALLS one — it is
     * `visitor ? roomHandler(c) : homeHandler(c)`, so its own body holds no
     * `c.html(` at all and the root of the product was missing from this list.
     * Which is also the fact worth knowing about it: signed out, / renders the
     * landing site, so it is two surfaces at one URL.
     */
    const ref = /^(\w+)\s*\)\s*;/.exec(m[2].trim());
    if (ref && named.has(ref[1])) body = named.get(ref[1]);
    for (const [name, handler] of named) {
      if (new RegExp(`\\b${name}\\(c\\b`).test(body)) body += "\n" + handler;
    }
    if (!RENDERS.test(body)) return;
    if (isPage(route)) pages.push(route);
    else htmlUnderApi.push(route);
  });

  /*
   * ROUTES A CATCH-ALL ALREADY SWALLOWED.
   *
   * `/p/:id/:stagePath` matches `/p/<id>/receipts` and `/p/<id>/before-post`
   * too, and answers notFound for anything not in EDITOR_PATHS. Hono matches
   * in registration order, so a literal sibling registered AFTER it is dead:
   * it 404s on every request and nothing says why.
   *
   * This has happened twice — the receipts admin page and the Before you post
   * sheet — and both times the route looked completely correct in isolation.
   * /p/:id/scout escaped it only by being declared further up the file.
   */
  const shadowed = [];
  const order = [...source.matchAll(/^app\.get\("([^"]+)"/gm)].map((m) => ({ route: m[1], at: m.index }));
  for (const wild of order) {
    const parts = wild.route.split("/");
    if (parts.length !== 4 || !parts[2].startsWith(":") || !parts[3].startsWith(":")) continue;
    for (const other of order) {
      if (other.at <= wild.at) continue;
      const bits = other.route.split("/");
      if (bits.length !== 4 || bits[1] !== parts[1] || !bits[2].startsWith(":") || bits[3].startsWith(":")) continue;
      shadowed.push({ route: other.route, by: wild.route });
    }
  }

  return { pages, htmlUnderApi, shadowed };
}

/**
 * The query enumerations, read out of the types that define them.
 *
 * A tab list copied into this file would be a second place to add a tab, and
 * the first thing anybody forgets. `RoomTab` and `FootTab` are exported unions
 * and `EDITOR_PATHS` is a Set literal, so all three are read where they live.
 */
function enums() {
  const read = (file) => readFileSync(join(__dirname, "..", "src", file), "utf8");
  const union = (text, name) => {
    const m = new RegExp(`export type ${name} =([^;]+);`).exec(text);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  const setOf = (text, name) => {
    const m = new RegExp(`const ${name} = new Set\\(\\[([^\\]]+)\\]`).exec(text);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  return {
    roomTabs: union(read("ui/pages/room.ts"), "RoomTab"),
    footTabs: union(read("ui/pages/footage.ts"), "FootTab"),
    editorPaths: setOf(read("index.ts"), "EDITOR_PATHS"),
    /* Footage's three tabs INSIDE a project. They are query parameters on an
       editor path, so nothing above expands them: the crawl visited
       /p/:id/footage and never the two tabs beside it, which is exactly the
       blind spot this file exists to close. */
    projFootTabs: union(read("ui/pages/cut.ts"), "ProjFootTab"),
  };
}

/**
 * Real URLs, with ids discovered from the running server.
 *
 * `fetchJson` is injected so this stays testable without a server, and the
 * ids come from the product's own endpoints rather than from a fixture file:
 * a crawl that only ever visits made-up ids is a crawl of pages nobody has.
 */
async function expand(opts) {
  const { base, fetchJson } = opts;
  const { pages, htmlUnderApi, shadowed } = declared();
  const E = enums();

  const first = async (path, key) => {
    try {
      const body = await fetchJson(base + path);
      const rows = body?.[key] ?? [];
      return rows[0]?.id ?? null;
    } catch {
      return null;
    }
  };

  const sourceId = await first("/api/sources", "sources");
  const projectId = await first("/api/projects", "projects");
  /* GET /api/plans exists so this can reach /plan/:id. Nothing listed plans
     before, which made the page unreachable for a person AND for every check
     — a page the product cannot list is a page nothing can find. */
  const planId = opts.planId ?? (await first("/api/plans", "plans"));

  /*
   * One entry per DECLARED route, so a route with nothing to expand it with is
   * reported rather than silently dropped. `why` is what a person reads when a
   * surface could not be reached — "no project in this account" is a fixture
   * problem and "no rule for this route" is a bug in this file.
   */
  const out = [];
  const add = (route, urls, why) => out.push({ route, urls, ...(why ? { why } : {}) });

  for (const route of pages) {
    if (route === "/") {
      add(route, ["/", ...E.roomTabs.map((t) => `/?tab=${t}`)]);
    } else if (route === "/footage") {
      add(route, ["/footage", ...E.footTabs.map((t) => `/footage?tab=${t}`)]);
    } else if (route === "/p/:id/:stagePath") {
      add(
        route,
        projectId
          ? E.editorPaths.flatMap((p) =>
              p === "footage"
                ? [`/p/${projectId}/footage`, ...E.projFootTabs.map((t) => `/p/${projectId}/footage?tab=${t}`)]
                : [`/p/${projectId}/${p}`],
            )
          : [],
        projectId ? null : "no project in this account",
      );
    } else if (route === "/plan/:id") {
      add(route, planId ? [`/plan/${planId}`] : [], planId ? null : "no plan in this account");
    } else if (route === "/p/:id/before-post") {
      /* The checklist a person reads before posting. It answered only as a
         .txt download until 28 Oct, so no crawl had ever seen it. */
      add(route, projectId ? [`/p/${projectId}/before-post`] : [], projectId ? null : "no project in this account");
    } else if (route === "/p/:id/receipts") {
      /* Where the maker publishes or takes down the public receipts page. It
         answered at /api/projects/:id/receipts until 28 Oct — the second
         human page found at a machine URL by this inventory. */
      add(route, projectId ? [`/p/${projectId}/receipts`] : [], projectId ? null : "no project in this account");
    } else if (route === "/p/:id/scout") {
      /* The Scout board. It answered at /api/projects/:id/scout/board until
         28 Oct, which is why no crawl had ever reached it. */
      add(route, projectId ? [`/p/${projectId}/scout`] : [], projectId ? null : "no project in this account");
    } else if (route === "/sources/:id" || route === "/sources/:id/edit") {
      const suffix = route.endsWith("/edit") ? "/edit" : "";
      add(
        route,
        sourceId ? [`/sources/${sourceId}${suffix}`] : [],
        sourceId ? null : "no source in this account",
      );
    } else if (route === "/r/:token") {
      add(route, [], "a receipt page needs a published token; pass receiptToken to include it");
    } else if (route === "/auth/callback") {
      /* A one-time sign-in token. Visiting it without one renders the refusal
         page and nothing else, and visiting it WITH one consumes somebody's
         link. The copy on it is read by test/auth.test.ts instead. */
      add(route, [], "needs a one-time sign-in token, and visiting it spends one");
    } else if (/:/.test(route)) {
      add(route, [], "no rule in scripts/surfaces.cjs for this route's parameters");
    } else {
      add(route, [route]);
    }
  }

  /* A receipt page is the one surface that cannot be discovered: its token is
     minted when somebody publishes one, and there is no listing by design —
     the page is public and the token IS the permission. */
  if (opts.receiptToken) {
    const row = out.find((r) => r.route === "/r/:token");
    if (row) {
      row.urls = [`/r/${opts.receiptToken}`];
      delete row.why;
    }
  }

  return { surfaces: out, urls: out.flatMap((r) => r.urls), htmlUnderApi, shadowed, enums: E };
}

module.exports = { declared, enums, expand, isPage };
