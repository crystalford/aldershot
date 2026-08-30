# Open questions for the owner

Per `design/docs/07-CLAUDE-CODE-BRIEF.md` §"How to handle uncertainty": ask
rather than invent. Each item below is a place where the prototype does not
answer a question the build has to answer. Nothing here is blocking — each has
a defensible interim behaviour, noted — but each is a decision that should be
yours, not mine.

## 1. The editor with nothing open

**Status:** interim behaviour shipped.

`/editor` is in the nav, but the prototype has no "editor with no project"
state — you always arrive at the editor through a project. A fresh account
clicking Editor has to see something.

Interim: it shows Projects' own real empty line, "Nothing in Projects yet —
start something above." That is true and uses no invented copy.

Options: (a) keep that, (b) redirect `/editor` → `/projects` when nothing is
open, (c) write a real line for it.

## 2. The demo card promises specifics that must become true

**Status:** rendered as designed; the action does not work yet.

Home's fresh state carries "A 48-minute podcast, already read. Twelve clips
found, nothing kept yet." That is a factual claim about a specific demo source.
Before this reaches anyone, we need an actual 48-minute video we have the right
to ship, ingested and scored, whose clip count really is twelve — or the copy
has to change to match whatever we do ship.

Needed from you: the demo video itself, or permission to change the line.

## 3. Fonts are loaded from Google at runtime

**Status:** matches the prototype; flagged as a production concern.

The prototype loads Instrument Sans and IBM Plex Mono from
`fonts.googleapis.com`, and the build does the same. That means a third-party
request on every page load and a flash of fallback type on a cold cache.
Self-hosting the woff2 files is strictly better for a paid product.

Recommendation: self-host before launch. Not urgent, and not a fidelity
question — the rendered type is identical either way.

## 4. Diarization tier — the `speaker` field is unverified

**Status:** wired as an opt-in upgrade, not yet exercised.

Per your instruction, transcription follows the same pattern as reasoning: a
good default (`whisper-large-v3-turbo`) and a paid upgrade that tells speakers
apart (`@cf/deepgram/nova-3`, ~10x the cost).

The catch, from the model audit: Nova-3's `diarize` *input* parameter is
documented, but Cloudflare's documented *output* schema does not list a
`speaker` field. Deepgram's own API returns one, so this reads as a docs gap —
but until we run it on real audio we do not know. Phase 5 verifies it before
any UI depends on speaker labels, and degrades to un-diarized segments rather
than inventing speakers.

No decision needed now — recording it so the risk is visible.

## 5. Domain

`aldershot.io`, being registered. Needed for Phase 9 (auth, the signed-out
landing site, and the `/r/:token` review links, which the prototype renders as
`aldershot.to/r/…` — that "to" is presumably a placeholder and should become
`aldershot.io`, but confirm).
