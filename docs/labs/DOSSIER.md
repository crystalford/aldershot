# The Dossier and acquisition — memory that compounds, clips that arrive

7 Oct 2026, from pass 11, with the founder's "Neolog trap" warning as the test for every idea. Nothing here is built except the Scout screen's acquisition states in labs.

## The one-line version

**Video is slow, so make the slowness compound.** Every upload, search and question is an investment: the Dossier remembers what was asked, what was found, and what was a dead end. It stays buildable only as **a relational ledger of moments, sources and searches with embeddings — never a knowledge graph** (GraphRAG indexing cost ~600× hybrid search in the cited benchmarks). Acquisition is **hybrid**: Aldershot fetches files itself only where downloads exist by design; everywhere else — YouTube included — the user grabs the clip on a *mission* and the system matches it back to the scouted moment by its words.

## Feature verdicts (feasibility · cost · complexity · value)

| Feature | Verdict | Simplest viable version |
|---|---|---|
| Persistent memory + delta search | **v1** · cheap | A ledger of `sources_examined` and `searches_run` with yield and a dead-end flag; re-runs filter by `publishedAfter` and skip unchanged hashes. Most of the value is *recording dead ends*. |
| Living timelines | **v1 as a derived view** | Moments sorted by source date. No event extraction — "last March" relative dating and event merging is where entity-resolution hell starts; later, and only as a suggestion the user accepts. |
| Threads that grow | **v1** · cheap | A thread = a saved hybrid query + the judge + a label; new moments auto-file above a threshold; counts are SQL. Cap ~25 active threads per entity. |
| **Contradiction engine** | **v2, scoped — never always-on** | See below. |
| Discourse map | v2 lite | "Who else quoted this" via search on the distinctive quote; framing labels on demand, cached on the channel. Full map infeasible (no Reddit commercial access, no Twitch chat API). |
| Night shift | v1.5 · bounded | Standing queries + new-source scans only; a hard per-user nightly budget; a morning briefing that also reports "nothing found". |
| Questions that never expire | **v1** | A standing query = search spec + cadence + watermark. Powers the night shift. |
| Ingest your own research | **v1** | PDFs and notes chunked into the same moment table with provenance `yours-doc`; page anchors replace timestamps. These eleven passes become searchable next to footage. |
| Coverage and gap maps | v1.5 | Beats × date buckets × source types; a cell is a count; "dark" means zero after N searches. Gaps become the next Scout run. |
| Corpus sizing up front | **v1** | Pre-flight: API result counts + index hits + transcript availability → "huge / moderate / thin — plan original footage". |
| Projects write back | **v1** (used / cut) | On publish, mark moments used or cut so the next cut avoids repeats or calls them back on purpose. Viewer response later. |
| Shared vs private memory | v2 (schema in v1) | Share only public-source *pointers* (URL, timestamps, quote, transcript hash). Never briefs, conclusions, confirmations, uploads — or **which entity a user is investigating**, which is itself sensitive for a journalist. |

### The contradiction engine — scoped is buildable, always-on is the trap

- NLI-only detection over-fires (81.6% recall at **37.3% precision** on legal documents). Zero-shot LLM over documents over-fires too (83 flags, **56 false**). A second, focused verification pass removes most false positives (55 of 56 caught, 22 of 27 true confirmed). Even a strong system reported 88% precision while experts agreed with only 70% of its findings.
- For an investigative creator a false "he contradicted himself" is a defamation-grade error. **A human confirms every one. Nothing enters a script unconfirmed.**
- Pipeline: user-triggered, scoped to one entity and one thread → claims extracted lazily from that thread's moments (20–200) and cached → embed, pull similar pairs from *different dates*, cheap stance pre-filter → frontier model judges each pair with both quotes and ±30 s, returning *direct contradiction / changed position over time / different topics / sarcasm or quoting someone else / insufficient context* → both receipts side by side → confirm.
- ≈ 100 claims → 50 pairs → ~100K tokens → **$0.30–0.50 per run.** Most hits will be *changed position over time* — label them that way; it's more accurate and more useful editorially.

## Context and cost

- **Raw transcripts never enter the main context.** The orchestrator sees moment cards (60–120 tokens: quote, one-line context, source, date, ids).
- **A per-entity summary with receipts**: 300–600 tokens, every sentence ending in moment ids, updated *incrementally* (old summary + only the new cards); rebuilt from scratch only past a diff threshold.
- **Dossier first, internet second**: every Scout run queries private and shared indexes before any external search runs for the delta.
- Scanning 100 hours of transcript on a small model ≈ 1.2M tokens ≈ **$0.05**. Per entity per month: embeddings and storage are rounding error; incremental summaries ≈ $0.30; two contradiction runs ≈ $0.60–1.00; the night shift ≤ its cap. **The real costs are frontier-model calls and transcribing sources that have no transcript.** Instrument `searches.cost_usd` and `new_count` from day one so Aldershot can report its own measured savings.

## Guardrails against the Neolog trap (explicit)

1. **Extract lazily, never speculatively** — claims, events and stance labels only when a user action needs them, then cached.
2. **Closed schemas** — fixed entity kinds, roles, provenance and acquisition states; LLM output must fit the schema or the call fails visibly.
3. **IDs before names** — merges need a shared platform id or human confirmation; the model may *suggest*, never perform.
4. **Every background job has a cost estimate, a budget check and a cap**; no chasing leads of leads beyond depth 1 overnight.
5. **Every stored fact carries moment ids.** No receipts, not stored.
6. **One retrieval path** — the same hybrid + judge serves Scout, threads, standing queries and contradiction candidates. No second index, no graph store.
7. **Kill-switch metrics per feature** — cost per user per month and acceptance rate of its suggestions; a rarely-accepted feature is demoted to on-demand.
8. **No silent partial failure** — every run reports "examined N, M failed (reason), K new".

## Acquisition — the platform reality

| Source | Server-side | Class |
|---|---|---|
| Podcast RSS enclosures | public media URL by design (only ~6% carry a transcript tag — expect to transcribe) | **reliable** |
| C-SPAN | free clip downloads; federal coverage usable non-commercially with attribution; bug must not be covered | reliable, with terms |
| Internet Archive TV News | short clips viewable/embeddable; no sale or licence | semi-open |
| Council / government archives | often direct MP4/HLS | mostly open |
| Twitch clips | official download — **broadcaster/editor authorisation only**; no plans for unauthorised file URLs; VODs expire 7/14/60 days | owner-scoped |
| Vimeo · Dailymotion | file links for your own account / partner content | owner-scoped |
| **YouTube** | datacenter IPs blocked regardless of PO tokens; tokens now bound to video id; **and the Developer Policies ban the route anyway** | **fragile → mission by default** |
| TikTok · X · Instagram · Kick · Rumble | unofficial extractors only | fragile → mission |

Paid download APIs (TikHub, FastSaverAPI, Apify, SocialKit, self-hosted Cobalt) are wrappers whose outages become our silent failures and whose every call carries a policy flag. **Not in v1.** Competitors' URL import is fragile too (Descript caps and has pulled the feature; OpusClip logged repeated import incidents; Kapwing warns of downtime) — which validates the mission model rather than embarrassing it.

### The hybrid strategy

1. **Auto-acquire** from sources that are open by design plus the user's own channels via OAuth — marked *auto*, verified by duration and hash.
2. **Mission** for everything else. Scout's output *is* the mission card: deep link at the in-point, in/out, quote, source, context, why it matters, expiry badge.
3. **Capture assist**: a browser extension that opens the source at the in-point, starts tab capture, stops at the out-point plus a 2-second handle and uploads with the moment id attached — that one detail makes matching trivial. Tab capture (`getDisplayMedia`) as the universal fallback (Chromium-only audio; quality = playback quality, so instruct 1080p and theatre mode; re-mux and validate duration server-side). Mobile: native screen recording + a share target. **The founder's old Windows app returns as the v2 companion** — most reliable for the user, highest maintenance for one developer.
4. **Match-back**, cheapest first: hint (the attached id — verify, don't search) → **transcript alignment** (fuzzy n-grams against the scouted quote and source window; survives watermarks, crops, re-encodes because the words don't change) → **landmark audio fingerprinting** for noisy or music-heavy clips (Chromaprint/AcoustID are the *wrong* tools — built for near-identical whole recordings, not speech or snippets) → **vPDQ frame hashes** for silent clips (a 4-second re-encode matched its 22-second source at 100% coverage in one qualification; TMK+PDQF is *not* a dedup authority). Verdicts: `verified` (≥90% coverage, ±1 s) · `partial` (show the missing words) · `mismatch` (say so plainly). Never silently accept a near-miss.

**States**: `scouted → mission → acquired → verified → used`, plus `failed` with a reason. **Batch mode** walks card to card (expiring first, then beat order): with the extension, 10–20 s of attention per clip plus runtime. **Progress** per project: "9 of 14 moments verified".

## Attribution — automatic, through the timeline

- Standards: identify the source clearly, **including when it's a rival** (Reuters); "the internet" or "YouTube" is neither ethical nor informative (WITNESS); C-SPAN's bug stays visible. The founder's instinct to credit a detractor's channel is exactly what the standard requires.
- **Default credit**: a small lower-third, *Source: [channel] · [platform] · [date]*, for the clip's first 3–4 s (whole clip if under 6 s), in the safe area away from captions, channel name exact. Chains credit the original: *Source: [streamer] via [compilation channel]*, both linked.
- **Description / end credits** auto-generated: a timestamped source list in order of appearance.
- **Through the timeline**: attribution lives in OTIO clip metadata under an `aldershot` namespace (moment id, credit text, URL, platform, date, chain parent) so it survives export; optional C2PA ingredient with `digitalSourceType` for manifest-less sources — stating where it came from without vouching for it.
- **Override**: credit text editable per clip; **removal requires an explicit toggle**. The default stays honest.

## UX and restrained gamification (for the design)

**Principle: the reward is evidence quality. Every visible number means something editorially. Celebrate state changes, not activity volume. Nothing punishes absence.**

- **A sourcing meter per project** — "Sourced 9/14 · Verified 7", segmented by beat, with moments the user already owns pre-filled as *legitimate* head-start progress (the endowed-progress effect: a 12-stamp card with two pre-filled stamps finished faster than a 10-stamp card). Never fake progress.
- **The "clip acquired" moment**: the card flips from outline to solid with a tick and the quote highlights in place — under 400 ms, no confetti, no sound. A subtler second state for *used in cut*.
- **Dossier growth** on each entity page: "312 moments · 41 sources · 18 threads · last new find 2 days ago" and a monthly sparkline — research depth **without a streak counter** (when GitHub silently removed streaks, long-running streaks were abandoned and weekend activity fell: the counter was driving the behaviour).
- **Coverage map as the completeness game**: beats × years; empty cells read *dark — searched 4×, nothing* vs *not yet searched*; click an unsearched cell to launch a scoped Scout run.
- **Open loops as resumption cues**, capped at three and dismissible: "3 moments waiting for you to grab", "1 VOD expires Friday". (The Ovsiankina resumption tendency is reliable; the Zeigarnik memory effect isn't.)
- **Milestones sparingly**, as quiet text: "100 verified moments", "first fully sourced project". **No points, levels, leaderboards, daily streaks, confetti, XP, mascots, streak-loss warnings or "you're on fire" copy.** Newsroom tone: *Verified against source at 12:34*, not *Nice catch!* External rewards crowd out intrinsic motivation in already-motivated professionals — keep every mechanic informational.

## What this changes in Aldershot

- **The Scout screen gains the acquisition flow** *(built, labs)*: every row shows its route — *ALREADY YOURS · AUTO (open feed) · MISSION (you grab it)* — and walks `scouted → mission → matching → acquired · verified`; the podcast row fetches itself; YouTube and Twitch rows become mission cards; the header carries the sourcing meter; each row shows the credit line that will be burned in.
- **"Footage and Scout finds are the same object."** A moment carries provenance — *yours · external, linked · external, captured · yours-doc* — and shares the one tagging and retrieval system. Home's archive gets *Mine · External · All*; attaching an external moment works like attaching anything else.
- **The Dossier is a new entity page in the product's vocabulary**, not a new surface: timeline (a sorted view), threads with counts, coverage, open loops — and *Check consistency* as a one-click report with mandatory confirm, never a background engine.
- **Corpus sizing and dead-end memory belong in the Read**: "huge corpus, high confidence" / "thin record — plan original footage" before anything is invested; "searched 4×, nothing" so the same research is never re-run.
- **Night shift briefings** are the "since you were away" surface done honestly: short cards, including "2 standing queries found nothing" and "1 VOD expires in 4 days".
- **Attribution is automatic and travels with the clip** — joins *Before you post*'s attribution-at-first-use with the exact credit format.
- **For the handoff**: the eleven tables (entities, sources, moments, moment_entities, threads, searches, sources_examined, claims, contradictions, standing_queries, project_usage, attributions) on D1 + a per-user Durable Object + Vectorize namespaces + R2; the matcher pipeline; the extension; the build list — ledger → delta search and sizing → provenance and missions → matcher v1 → auto-acquire connectors → attribution → threads and summaries → the meter → standing queries and night shift → extension → matcher v2 → scoped contradictions → shared pointer index → later: events, companion app, C2PA, viewer write-back.

**Big swings that stay feasible**: a *receipts page* published with every video (moment, quote, original link, verification state) · the shared quote-hash index as the network effect ("this clip is a re-upload of [stream] at 1:02:13", instantly, built from verification work users already do) · **expiry rescue** ("a moment matching your thread is in a VOD expiring in 3 days" — cheap, uniquely valuable) · contradiction *dossiers* as a one-click consistency report with confirm, the headline feature made safe by scoping.

## Sources

- Memory and graphs: Microsoft LazyGraphRAG; TREX (arXiv 2503.02922, Table 1). Contradictions: LegalWiz (arXiv 2510.03418); PAPEL (arXiv 2409.14879); FutureHouse ContraCrow (arXiv 2409.13740).
- Acquisition: yt-dlp issue threads and maintainer statements through mid-2026 (PO tokens, SABR, datacenter blocks); Twitch Helix Get Clips Download and retention docs; Vimeo and Dailymotion API scopes; Podcast Standards Project transcript-tag adoption; Internet Archive TV News and GDELT TV 2.0; C-SPAN terms; Descript, OpusClip and Kapwing import notes; paid wrapper pricing pages (vendor claims).
- Matching: Chromaprint/AcoustID author statements; audfprint/Panako/olaf landmark hashing; Meta vPDQ and TMK+PDQF evaluations; Chromium `getDisplayMedia` constraints and the 1-second-file issue.
- Attribution: Reuters Handbook of Journalism; WITNESS guidance; OpenTimelineIO metadata; C2PA 2.4 `digitalSourceType`.
- Gamification: Moldon, Strohmaier & Wachs (ICSE 2021); Ghibellini & Meier (2025, *Humanities and Social Sciences Communications*); Nunes & Drèze endowed progress; self-determination theory.
- Costs: Workers AI, Vectorize, D1 list prices — estimates; contradiction figures are from legal, privacy and scientific text, not spoken video (expect worse on sarcasm and quoted speech).
