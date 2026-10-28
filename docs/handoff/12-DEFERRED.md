# 12 · Deferred — decided, parked, in order

None of these blocks launch. Each has been decided far enough that it can be picked up without re-litigating.

## Direct integrations (the user wants these; build in this order)

**Prototyped 15 Oct 2026:** items 1, 2, 3 and 5 exist in the prototype — pictures as Home's **Stock** tab (search by tag, source filter, licence and credit per asset, attach writes the credit); podcasts as a **source you add** behind + Add footage, whose episodes become External moments searchable by what was said and as Settings → Connected services (keyless sources on by default; Pixabay on a shared key with your own optional). Build these first; they need no agreements.

1. **Pixabay** — images and video, free, no credit required; 24 h response cache; copy assets to storage.
2. **NASA Image & Video Library** — images, video, audio, captions; credit NASA, no endorsement.
3. **Internet Archive / Prelinger** — PD, CC0 and CC-BY items only, checked per item.
4. **Epidemic Sound Partner API** — music and SFX, licensed in perpetuity once used. **Apply now; onboarding has lead time.**
5. **Podcast RSS** — public audio by design; transcribe where no transcript ships (~$0.03/hr); short excerpts with credit.
6. **GDELT TV** — the one legitimately word-searchable news source; quote and link; **one test call first** (live status unconfirmed in 2026).
7. **Connected accounts** — your YouTube uploads and captions, your Twitch clips (including clip-from-VOD), your Vimeo; read-only, own content.
8. **Pexels** — only if a key is already held (new keys paused).

Every stored asset carries licence, source URL and credit beside its file. Searchable by words: GDELT, podcasts, the user's own captures. Everything else by title and tag. Corrections to earlier assumptions: C-SPAN forbids all unlicensed commercial use (floor proceedings excepted); Freesound and Jamendo free APIs are non-commercial; X is paid per call with no reuse; Canadian legislative footage is non-commercial without permission.

## Built, measured, and not wired (28 Oct 2026)

Two of Scout's stopping inputs are computed by code that works and fed
numbers that are not the truth. Both are written here rather than estimated,
because an estimate in a stopping rule is a run that stops for a reason
nobody can check.

- **Capture–recapture.** `recapture()` in `src/scout-stop.ts` compares what
  the `direct` query family found against what the `crowd` family found and
  reads the overlap as how much is still out there. It is called with
  `(0, 0, 0, 0)`, because nothing records which family found a given source:
  `scout_sources` has no family column, and `writeSources` uses
  `INSERT OR IGNORE` on `UNIQUE(run_id, adapter, external_id)` — so a source
  BOTH families found is stored once and the second find, which is precisely
  the overlap the estimate needs, is discarded on the way in.
  `scout_ledger.found_by_family` exists for this and is written by nothing,
  for the same reason: the scan cannot know what it was never told.
  To wire it: carry the family from `runSearches`' per-request candidate lists
  (`found: SourceCandidate[][]`, which already knows) into a
  `(run, source, family)` row, and read n1/n2/m off it.
  **The zeroes are the safe direction**, which is why this is a deferral and
  not a bug: `decideStop` only ever reads `moreOutThere` to REFUSE a stop, so
  an absent estimate makes a run stop at the knee instead of looking longer.
  It cannot stop a run early for a reason that is not true.

- **Per-source loudness matching.** The prototype's cut carries a note
  reading "Levels matched across 3 sources". The build says "Loudness set for
  the platform" instead, because the first is a claim this render cannot keep:
  `LOUDNORM` in `src/loudness.ts` normalises the PROGRAMME, applied once to the
  finished mix in `container/render.mjs`, whose own comment explains why
  normalising each part separately is the wrong thing to do. "Matched across 3
  sources" asserts a per-source pass that does not exist.
  To restore the stronger line: measure each source's loudness during the read,
  stage per-source gain in the EDL, and keep the programme pass after it. That
  is a render-pipeline change plus a new measurement, and it was not the thing
  to do immediately before building a container for the first time. Changing
  the sentence cost a line; invariant 4 cuts both ways, and a status line is a
  claim like any other.

- **Model spend, per run.** `runCounters` sums `scout_searches.cost_usd`, so
  the $1.50 budget now fires on real search spend. The model calls — decompose,
  expand, scan, reduce — compute their token counts and no row attributes them
  to a run, so they are not in the figure. The cap therefore fires later than
  it should rather than never. To wire it: give `usage_events` the run id it
  already has a `job_id` column for, and add that sum here.

## Scout v2 and v3

- **Companion desktop app** (the founder's earlier Windows tool reborn) and a **browser extension**: open the source at the in-point, tab-capture to the out-point plus a handle, upload with the moment id attached. Positioned as capture for the user's own lawful use, never as a downloader.
- **Standing queries and the night shift**: saved beats run on a schedule against new uploads, clips (timed to VOD expiry) and episodes; a morning briefing that also reports "nothing found"; a hard nightly budget per user. "She contradicted her March statement today — here's the clip."
- **Expiry rescue**: "a moment matching your thread is in a VOD expiring in 3 days."
- A shared index of public-source pointers (quote hashes → original) as the network effect; never briefs, conclusions or which entity a user is investigating.

## The Dossier, further

Living timelines with event extraction (only as suggestions the user accepts); the discourse map ("who else quoted this"); coverage maps as the completeness game; a persisted community-vocabulary lexicon per subject.

## Elastic length and liquid video

One control from 15 s to full length, re-solved from the stored policy; canonical variants pre-rendered; locale and reading-level variants with type and captions composited client-side; packaging personalisation (hook, thumbnail, length) before any change to substance; a publish kit (transcript, chapters, clip markup, provenance manifest, cut ledger); an agent endpoint exposing `search_moments`, `get_clip`, `get_receipts`, `render_variant` with the integrity envelope enforced server-side. An open "liquid video package" spec is the big swing.

## Generation

Real-time generated inserts (always labelled), explainable reconstructions quarantined as illustration, a style LoRA on the user's approved frames (never on reference artists), a generation marketplace routed per shot to the cheapest provider that passes the critic.

## Notes intake (parked, 16 Oct 2026)

Paste your own research — notes, links, an article — before an Essay's plan, and it pulls out possible points, quotes and fetchable clips, each with Add / Skip; what you add seeds the claim and the beats. Useful for essays, optional for everything else. It existed on the retired Home (`archive/rooms/`) and was deliberately not carried into the room.

## Tabled — not the direction

- **A voice profile, style profile, preference-trained "voice" model, or voice clone.** Light editing of a plain-register draft is enough when the material is facts plus argument. Revisit only as a per-account feature if the SaaS needs it.
- An always-on contradiction engine (the scoped, human-confirmed report stays).
- Viewer-driven branching; thumbnails and titles beyond promise-checking from the claim (no evidence worth building on yet).

## Research still worth commissioning

1. **A legal and policy pack** — fair dealing (Canada) and fair use (US) for react and commentary; privacy and consent for footage of other people; provider terms on calling APIs with a customer's own key; EU labelling in practice. Read by a media lawyer.
2. **Audio ingest measured on speech under game audio and crosstalk** — denoise, de-reverb, intelligibility scoring, ducking tools.
3. **The pre-production ladder, observed** — ten real briefs through the plan flow, watching where people actually stop.
4. **Competitor pricing** — Opus Clip, Captions, Kapwing, CapCut, InVideo, HeyGen, Synthesia, Pictory — before prices are final.

Already answered; do not commission again: retrieval, the gavel problem, visual supply, formats, the edit engine, strategy, Scout, the Dossier, sources, operations.
