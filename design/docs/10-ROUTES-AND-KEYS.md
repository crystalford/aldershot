# 10 — Routes, keyboard, and state

## Routes

The prototype switches surfaces on a single `view` string. The built app must give each one a real URL so work is linkable and the back button works — the prototype's biggest limitation.

| `view` | URL | Nav item lit |
|---|---|---|
| `home` | `/` | Home |
| `cut` | `/p/:id/pick` | Editor |
| `essay` | `/p/:id/build` | Editor |
| `transcript` | `/p/:id/script` | Editor |
| `shorts` (from a project) | `/p/:id/shorts` | Editor |
| `shorts` (standalone) | `/clipping` | Clipping |
| `archive` | `/footage` (`?tab=moments|threads|sources`) | Footage |
| `projects` | `/projects` | — |
| `settings` | `/settings` | — |
| landing | `/` when signed out | — |

The same view (`shorts`) lights a different nav item depending on context — that is `shortsCtx: "editor" | "nav"` in the prototype. Preserve that behaviour; it is why the editor feels like one place.

Deep links that must work: a project stage, a thread (`/footage?thread=:id`), a clip, a render, and a review link (`/r/:token`, read-only, no auth).

## Keyboard map

Implement all of it. The prototype's `componentDidMount` handler is the reference.

| Key | Where | Does |
|---|---|---|
| ⌘K / ⌃K | anywhere | open search / ask |
| `?` | anywhere | shortcut sheet |
| `Esc` | anywhere | close the topmost overlay (sheet, then search, then panel) |
| `G` then `H / P / C / F / S` | anywhere | go Home / Projects / Clipping / Footage / Settings |
| `Space` | any editor stage | play / pause |
| `J / K / L` | any editor stage | back 5s / stop / forward 5s |
| `← →` | any editor stage | nudge one second |
| `↑ ↓` | Pick, Build | move between blocks |
| `X` or `⌫` | Pick, Build | keep or drop the selected block |
| ⌘Z | anywhere | undo the last change |

Rules: keyboard actions and their mouse equivalents must route through the **same** undo-wrapped handler, or ⌘Z will only revert half of them (this was a real bug in the prototype and is fixed there). Never bind keys while focus is in an `input` or `textarea`.

## State that must persist server-side

From the prototype's `state`, these are real product state and must survive reload, not live in memory:

`beats` order and content · `struck` words per beat · `cutOn` (kept/dropped per moment) · `trCut` / `trSegCut` (transcript cuts) · `splits` / `merges` · project `title`, `kind`, `brief` · `passList` (the Passes log) · `shortsKept` and `shortEdits` · `exportsLog` · `overnightQueue` · `trash` · `prefs` (export defaults) · `plan` · `elevenKey` (encrypted) · `styles` (saved brief presets) · `mutedCats` (drop categories the user has taught it to stop surfacing).

These are UI-only and should stay client-side: `playing`, `playPos`, `selBeat`, `expandedMoment`, `notifOpen`, `searchOpen`, `keysOpen`, `scrubFor`, `dragging`.

## Autosave

Every edit writes immediately (debounced 400ms) — there is no Save button anywhere in the design, and adding one would be wrong. Show nothing on success; show a persistent banner on failure with a retry that keeps the user's edit.
