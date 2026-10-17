# PR 1 — hygiene: make the repo read the current design

Branch: `phase-0/hygiene`. One PR, mechanical, no product behaviour changes. Everything below is a file move, a copy, a path change or a doc edit. Do it in this order; each step leaves the repo buildable.

## 1. Retire the old design and docs

```
git mv design docs/archive/design-v1
git mv docs/decisions docs/archive/decisions-v1      # keep for history; superseded by handoff/13-DECISIONS.md
git mv docs/design docs/archive/design-notes-v1
git mv docs/research docs/archive/research-v1
```
Leave `docs/LAUNCH.md` and `docs/SETUP.md` where they are (operational, still true).

## 2. Bring in the current prototype and the handoff

Copy from the design project into the repo:

```
prototype/
  Aldershot One Take.dc.html  # the room (Home + Editor, one surface)
  Scout.dc.html               # Scout, imported by the room
  Aldershot.dc.html           # Settings
  Aldershot Manual.dc.html    # the user-facing manual
  Landing.dc.html             # the signed-out site
  Scout.dc.html               # the Scout character component
  footage.js                  # the reference rule engine
  support.js                  # the DC runtime (unchanged)
  assets/                     # frames, stills
  labs/                       # Directed plan, Scout, Essay to video, Footage sets, Meet Recce, plan-sample.js, README.md and the research write-ups
docs/handoff/                 # 00–17 + PR-1 + CLAUDE.md + Aldershot System.dc.html
```
Add `docs/handoff/CLAUDE.md` to the repo root as `CLAUDE.md` (replace the existing one; the old one goes to `docs/archive/CLAUDE-v1.md`).

## 3. Repoint the fidelity scripts

`scripts/check-fidelity.cjs`:
- `APP_PROTO` → read **all** of `prototype/Aldershot One Take.dc.html` and `prototype/Aldershot.dc.html` (concatenate); `LANDING_PROTO` → `prototype/Landing.dc.html`.
- The **layout law** block: delete the 960px check. The room is three fluid columns (two with no project); Settings is `min(960px,100%)`. Replace with: no page may set a fixed `width:` in px on its root (fluid `max-width` and `min-width:0` are fine).
- `ROUTES` in `checkStrings`: `['/', '/landing', '/settings', '/editor']` — `/projects`, `/footage`, `/clipping` no longer exist and must 404.
- `SIGNED_OFF`: start empty. Every entry in the old map described copy for a retired surface. New copy is checked against the new prototypes; anything deliberately different gets a fresh entry with its reason.
- The **icons** check stays as is (eight hand-drawn SVGs; the new prototypes carry the same geometry — verify, and add the Scout component's shapes to the exemption since it is a character, not an icon).
- The **hex** check stays. Add the new prototype files to `PROTO` so the palette (`#5EB8C9 #5EC98F #B08CD4 #D9B36A #E06A6A` and the greys) resolves.

`scripts/shoot.cjs`:
- `PROTO` becomes a map: `room → prototype/Aldershot One Take.dc.html`, `room-project → prototype/Aldershot One Take.dc.html?open=1`, `settings → prototype/Aldershot.dc.html`, `landing → prototype/Landing.dc.html`. Shoot each file directly instead of clicking nav items.
- Default `WIDTH` 1280 is fine; add a 960 run — the new layouts must reflow.

## 4. Rewrite the README's first section

Replace everything above "## Setup" with:

> Aldershot is a hands-off video editor: attach footage, say what you want in a sentence, get a finished cut built from rules you can see and switch off, with a receipt for every claim. Two surfaces (Home, Editor) plus Settings. **Read `docs/handoff/00-START-HERE.md` first.** The prototype in `prototype/` is the behavioural spec; `prototype/footage.js` is the reference rule engine. `CLAUDE.md` is the short manual. The code currently implements the previous design — see `docs/handoff/16-STATE-OF-PLAY.md` for what to keep, replace and build.

Delete "Editing is reading now" and every mention of Clipping, Projects and Footage as pages.

## 5. Declare the dead-letter queue (the one behaviour change allowed)

In `wrangler.jsonc`, add `dead_letter_queue: "aldershot-jobs-dlq"` to the `aldershot-jobs` consumer and declare the queue. Add a consumer that writes `failed_terminal` to the job row and logs. This is `10-OPERATIONS-AND-PRICING.md`'s first requirement and the one thing in the repo that loses user work silently today.

## 6. Acceptance

- `node scripts/check-fidelity.cjs` runs with the new prototypes and reports only findings that are real differences between code and the current design (expect many — that is the point; they become the Phase 2–3 work list, not things to fix in this PR).
- `make dev` serves `/`, `/landing`, `/settings`; `/projects`, `/footage`, `/clipping` return 404.
- `docs/archive/` holds every retired file; nothing in `docs/` or the root still names `design/Aldershot.dc.html` as authoritative.
- The DLQ exists and a forced retry-exhaustion in staging lands a message in it.

## What this PR does not do

No rule engine, no new pages, no schema changes beyond the DLQ. Phase 0 (the eval set) and Phase 2 (porting `footage.js`) are the next two PRs — see `11-BUILD-ORDER.md`.
