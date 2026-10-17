# 06 — Build plan

Build in this order. Each phase ends in something the owner can actually use on real footage. Do not start a phase before the previous one's acceptance criteria pass.

## Phase 0 — Skeleton (½ day)
Workers + D1 + R2 + Queues wired, migrations from `03-DATA-MODEL.md` applied, the design's shell (nav, wordmark with per-surface `markLead`, ⌘K, `?`, toasts) rendered from the real app.

**Accept:** every surface routes, empty states match the prototype, no console errors, 960px width law holds on every page.

## Phase 1 — Ingest and read (2–3 days)
Upload to R2 (multipart, resumable), probe, frames every 5s, Whisper transcribe in a Container with word timestamps, Stream copy for preview. Jobs table + Durable Object progress. Per-plan minute cap enforced **before** work starts. `usage_events` written by every consumer.

**Accept:** drop a 90-minute video, watch honest staged progress, read the full transcript with word-level timing, see real frames as thumbnails, and see the job's cost in `usage_events`.

## Phase 2 — The claim: Pick what stays + Script (3–4 days)
Score pass with the user's sentence. Keep/drop blocks with thumbnails, timecodes, and `why`. Skipped stretches openable. Word-level striking in Script mode, where deleting text deletes video. Clean-up chips (filler removal, pause tightening, flagged cuts) computed from the transcript. Undo on everything, ⌘Z, trash pile.

**Accept:** an hour of footage becomes a watchable cut in under five minutes without ever seeing a timeline; ⌘Z reverts every kind of edit; struck words show as strikethrough and are absent from the render.

## Phase 3 — Render and export (2 days)
Beats → ffmpeg concat → R2 + Stream. Formats from Settings. SRT written alongside. Exports history per project. Webhook + Buffer handoff.

**Accept:** the cut in the browser and the downloaded MP4 are frame-identical; re-rendering after an edit produces a new version without losing the old.

## Phase 4 — Clipping (2 days)
Scored vertical shorts: reframe to 9:16/1:1/4:5, burn captions, score with reasons, keep/skip. "Ask for a specific clip" = transcript search. Runs standalone from the nav and as an editor stage (nav stays on Editor).

**Accept:** one video in → 8 scored shorts out with real captions and real posters; each says why it scored and where it was found.

## Phase 5 — Footage and threads (2–3 days)
Every kept clip lands in Footage with its trail. Vectorize embeddings, thread formation, meaning vs exact search, Ask over the library. Sources tab opens straight into the editor.

**Accept:** a clip kept in Clipping is findable by meaning in Footage five seconds later, and its "used in" count is right.

## Phase 6 — Build stage: voice, reactions, cross-video (3 days)
Beat editing with `+` seams, in-browser recording for vo/react beats, ElevenLabs TTS with the user's key, inserting clips from other sources, reaction placement pass.

**Accept:** a reaction project can be recorded end to end in the browser and rendered, with the user's audio ducking the clip audio underneath.

## Phase 7 — Essays (3 days)
Essay outline pass over threads, acts, beats marked `generated`/`stock` when no clip matches, stock footage search, act-level progress.

**Accept:** a topic with no source video produces an act structure whose every claim is backed by a real clip or an honestly-marked gap.

## Phase 8 — The owner cost panel and caps (1 day)
`/api/usage/month` rolled up from `usage_events`; the Settings panel exactly as designed (this month, per finished video, at-this-pace, five stage lines, export the month). Reconcile against Cloudflare's GraphQL Analytics API.

**Accept:** the panel's monthly total is within 5% of the real Cloudflare invoice for the same period.

## Phase 9 — Landing, auth, plans (2 days)
`Landing.dc.html` as the signed-out site, email-link auth, plan gates matching the caps in `05`.

## Explicitly out of scope for v1
YouTube/TikTok OAuth publishing. Multi-user workspaces. Mobile app. Channel watching (platforms block it — dropped for good). Auto-deletion of anything.
