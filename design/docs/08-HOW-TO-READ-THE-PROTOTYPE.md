# 08 — How to read `Aldershot.dc.html`

You will open this file expecting HTML and find something slightly unfamiliar. Read this first or you will misread the product.

## What the file is

One document containing three things:

1. **A template** — the markup between `<x-dc>` and `</x-dc>`. Ordinary HTML with **inline styles only**, plus:
   - `{{ name }}` holes — a value supplied by the logic class. Dotted lookups only, never expressions.
   - `<sc-for list="{{ items }}" as="item">…</sc-for>` — repetition. `$index` is in scope.
   - `<sc-if value="{{ flag }}">…</sc-if>` — conditional. **This is how surfaces are switched**: each screen is an `<sc-if>` on `isHome`, `isCut`, `isEssay`, `isShorts`, `isArchive`, `isProjects`, `isSettings`.
   - `style-hover` / `style-active` / `style-focus` attributes — pseudo-state styles.
   - `onclick="{{ handler }}"` — the handler is a function from the logic class.
2. **A logic class** — `class Component extends DCLogic`, a React class component without `render()`. `renderVals()` returns every value the template consumes. All behaviour lives here.
3. **Props metadata** — the tweakable props JSON. Ignore it for implementation.

`support.js` is the runtime that renders this. It is a design-tool runtime — **do not port it, do not depend on it, do not treat it as app architecture.** It exists so the prototype runs in a browser.

## How to extract the spec from it

- **Surfaces:** search `data-screen-label` and the `<sc-if value="{{ isX }}">` blocks. Each is one page.
- **State:** the `state = { … }` initialiser near the top of the logic class lists every piece of UI state the product has. It is the most compact description of the app's behaviour in the file — read it line by line.
- **Behaviour:** `renderVals()` is long and branches per view (`if (v === "cut") { … }`). The branch for a view contains everything that view computes and every handler it exposes.
- **Constants:** `MOMENTS`, `CLIPS`, `WORKS`, `DONE_LIST`, `THREADS` are the fixture data. Their **shape** is the API contract; their content is sample data. `03-DATA-MODEL.md` is these shapes turned into tables.
- **Copy:** every user-facing string is a literal in the template or in `renderVals()`. Grep for them; do not paraphrase them.
- **Styling:** inline styles are the source of truth. Every hex, px, radius, and gap in the built product should be greppable back to this file.

## What the prototype does NOT tell you

- Server behaviour, persistence, auth, and jobs — those are in `04-API-AND-JOBS.md`.
- Real timings. Progress percentages are simulated; real ones come from job rows.
- Video playback is simulated with frame stills and a moving position — the built product uses Cloudflare Stream.

## Do not

- Port the DC runtime, `sc-for`/`sc-if`, or the `{{ }}` template syntax into the app. Use whatever your stack renders with.
- Copy the fixture arrays as seed data. They are sample content, not defaults.
- Treat the inline-style approach as an instruction for the app. It is a constraint of the design tool. In the app, use whatever styling system you like — **but the resulting computed values must match**.
