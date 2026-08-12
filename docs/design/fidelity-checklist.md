# Fidelity checklist — real app vs. the round-3 design prototype

This is the living source of truth for "does the real app actually match what
Claude Design worked out." It exists because self-reported "done" is not the
same thing as a literal comparison, and the difference between those two
turned out to be large (see the audit that prompted this file).

**Reference prototype**: `Aldershot v2.dc.html` (round 3, 2983 lines) —
the file every finding below cites line numbers against. Treat it as the
spec. If a future design round supersedes it, re-run the audit against the
new file before trusting this checklist again — it's a snapshot, not a
live diff.

**How to use this file**: before claiming a view is "done" or "matches the
design," find its section below and check every row. `✅` means verified
against a real screenshot with real data, not just written and assumed
correct. When you fix something, flip its row and note the commit. When you
deliberately diverge (a judgment call, a real-vs-fake tradeoff, a missing
data concept), say so explicitly in the "Why" column — an unmarked gap is a
bug, a marked one is a decision.

Legend: ✅ matches · ⚠️ deliberate divergence (reasoned) · ❌ not built

---

## The Desk

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Progress bar reflects beat *resolution* (matched/needs-vo/search-web), not beat *kind* | ✅ | Fixed — `beatResolutionStatus()`, app.js |
| 2 | "Since you were last here" digest: video/clip/discover/highlight entries | ✅ | Real data via GET /api/desk |
| 3 | Digest: cross-thread cluster surfaced entry | ✅ | `getCrossThreadClusters()`, GET /api/threads/cross |
| 4 | "Worth your attention": Essay idea, Top highlight, Studio idea | ✅ | All three now real |

## Archive

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Clips clustered by thread (not flat grid) | ✅ | `clipThreadMap()`, GET /api/clips?withThreads=1 |
| 2 | Cluster header: index, title, description, count | ✅ | Synthesized description from real sample clips |
| 3 | Cluster "Spans" cross-thread indicator | ✅ | Bridge-clip signal (tag-based union-find), independent of essay data to avoid circularity |
| 4 | "Ask the archive" Q&A | ✅ | `askArchive()`, POST /api/archive/ask, grounded |
| 5 | Thread filter chips + type filter chips | ✅ | Type = Manual/AI-detected (real taxonomy; prototype's Dialogue/B-roll/Analysis has no data-model equivalent) |
| 6 | "See thread breakdown..." cross-nav to Threads | ✅ | |
| 7 | Dynamic header stats line | ✅ | Real clip/thread counts |
| 8 | Real waveform bar visualization on clip cards | ❌ | Decorative-only in the prototype (no real waveform data anywhere); not worth building fake waveforms |
| 9 | Inline per-card "add to essay" select | ✅ | |

## Threads

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Grouped by kind (People/Shows/Topics) | ✅ | `describeThread()` LLM classification, cached per thread |
| 2 | Synopsis text per thread | ✅ | Same call as above; degrades gracefully to no synopsis when the AI call fails (sandbox egress limit) |
| 3 | Source count / clip count / theme count stat row | ✅ | Real: distinct video ids / clip count / distinct tags |
| 4 | Growth label text ("+N this week") | ✅ | |
| 5 | Colored initial-letter avatar | ✅ | |
| 6 | Card accent border-top (not border-left) | ✅ | |
| 7 | Inline rename (vs. modal) | ❌ | Cosmetic-only interaction difference; modal is functionally equivalent |
| 8 | Merge as inline `<select>` (prototype: preview-only, unapplied) | ⚠️ | Real merge actually applies — functionally ahead of the prototype, not behind |

## Discover

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Beat-grounding flow (pending banner, "Ground this beat →") | ✅ | Solid-teal CTA now matches |
| 2 | Results tagged with matched thread + color | ✅ | `matchDiscoverToThreads()`, one batched call per search |
| 3 | "Why it matches" + confidence % | ✅ | Same call |
| 4 | Thumbnail box + "{platform} · {channel}" line | ❌ | Being added — task in flight |
| 5 | Persistent "Added ✓" state | ✅ | |
| 6 | Search icon inline + onchange trigger | ❌ | Cosmetic; button+Enter is equivalent |

## Sources

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Grid: paste-URL quick add | ✅ | |
| 2 | Grid: status pills + filter chips | ✅ | Real per-project worst-case status |
| 3 | Grid: thread tag + clip count per card | ⚠️ | Clip count real; thread tag omitted (would force a full clustering pass on every Sources load — see Archive's own opt-in-cost reasoning) |
| 4 | Cross-nav to Clipping | ✅ | |
| 5 | Detail: AI-summary callout | ✅ | `summarizeTranscript()`, cached per video |
| 6 | Detail: lightweight plain-transcript reading pane (not the full editor) | ✅ | New `openSourceReview()` page is now the default landing point; full multi-video editor kept one click away ("Open full editor →") since it's real functionality the prototype's single-video model never needed |
| 7 | Detail: custom-clip thread-match step | ✅ | `renderCustomClipPanel()` using `bestThreadMatchForText()`; built a working save+essay-picker flow rather than reproducing the prototype's own state-management bug that makes its confirmation unreachable |
| 8 | Detail: always-on Suggested Edits sidebar | ✅ | `loadSourceSuggestions()` runs automatically on page load in the new review page |

## Essays List

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Stage-grouped sections (Ready to export / In progress / Drafting) | ✅ | `computeEssayStage()` |
| 2 | Per-card progress bar + stage pill | ✅ | |
| 3 | "est. {duration}" | ✅ | Real sum of resolved beat durations, not a guess |
| 4 | Whole card clickable | ✅ | |
| 5 | 3-step wizard (Idea → Clarify → Research preview) | ✅ | Angle chips added alongside Audience (real, kept) |
| 6 | "Story ideas the archive surfaced" | ✅ | Cross-thread clusters with no existing covering essay; "Start this essay →" pre-selects threads in the wizard |

## Essay Builder shell

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Right rail: Notes (chat-directed drafting) + Comments + persistent Review&export link | ✅ | Real drafting via direction-steered `draftEssayActBeat()`, not scripted replies |
| 2 | Finder: thread + type filters, match count | ✅ | |
| 3 | Finder "+" adds directly to Assemble | ⚠️ | Adds to Script's chosen act instead — real structural adaptation to a unified beat-list data model, not a UI oversight |

## Premise / Script / Assemble / Export

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Per-act needsHint guidance (drafting panel, empty-act flags, coherence check) | ✅ | |
| 2 | Production readiness bar | ✅ | |
| 3 | "Grounded in" label | ✅ | |
| 4 | Premise text not italic | ✅ | |
| 5 | Tension-arc SVG | ✅ | Explicitly stylized/fixed-shape, not derived from real data (nothing measures dramatic tension) |
| 6 | Coherence check reads the assembled cut (short-draft, single-thread-bias) | ✅ | 2 of the prototype's 4 checks — "breakdown vs analytical" needs a tagging concept that doesn't exist anywhere in this data model |
| 7 | Citation attacher on vo beats; structured source card on grounded research beats | ✅ | |
| 8 | Assemble: preview overlay (block index/thread/quote) | ✅ | Real, time-driven against actual per-beat durations |
| 9 | Assemble: Music lane | ✅ | Decorative, matches prototype's own inert version |
| 10 | Export: publish Title/Description, Sources cited, style toggles, 16:9+chapter bar | ✅ | |
| 11 | Preflight copy matches verbatim | ✅ | |

## Studio

| # | Item | Status | Why |
|---|---|---|---|
| 1 | "My videos" grid (per-recording workspace) | ✅ | `renderStudioGrid()`; Suggested-cuts/Clip-candidates filtered per selected video, Video-ideas deliberately left unfiltered (see reasoning below) |
| 2 | Suggested-cuts persistent tint + click-to-cut | ✅ | Real, Studio-scoped only |
| 3 | Clip candidates "Send to Archive" | ✅ | |
| 4 | Subcopy under all 3 headings | ✅ | |
| 5 | No duplicate inner headings | ✅ | |
| 6 | Header copy (explicit-send framing) | ✅ | |

## Generative

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Resolution setting (720p/1080p) | ⚠️ | Stored + shown in UI; NOT wired into the actual Veo call — the field mapping for that API is unconfirmed against the live catalog (same standing caveat this file already had for the Veo integration generally). Wiring it would mean guessing an unverified parameter. |
| 2 | Per-shot duration | ✅ | Real: `shotTypeDuration()` keyword-matched, actually used in generation + saved clip length |
| 3 | Essay-beat chips: per-essay grouping, visible title, auto-advance | ✅ | |
| 4 | "View in Archive" thread filter | ✅ | Real when the shot came from a beat chip; honestly unfiltered otherwise (no fake "streaming" fallback) |
| 5 | Saved-feed: last 4 reversed, colored by resolved thread | ⚠️ | Shows 5 not 4, colored by first tag not resolved thread object — minor, not yet fixed |

## Clipping

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Score badge shown | ✅ | |
| 2 | Source-video credit line | ✅ | |
| 3 | "Sent to Archive ✓" label | ✅ | |
| 4 | Duration badge m:ss | ✅ | |
| 5 | Persistent card grid (not one-at-a-time reel) | ✅ | `clipRenderShortGrid()` — grid sits below the reel rather than replacing it; the reel's scrub/step interaction is real, added value the prototype doesn't have |
| 6 | Format badge / format choice | ✅ | Always "9:16" — real and fixed, since `produceShort()` always renders a vertical reframe; no per-short format choice exists to display honestly beyond that |

## Settings / Trash / Help / Command palette

| # | Item | Status | Why |
|---|---|---|---|
| 1 | Settings: 4 real tabs | ✅ | Billing & Usage uses real account activity, not invented numbers |
| 2 | Settings entry point (avatar vs. gear icon) | ⚠️ | Gear icon kept, consistent with the rest of the rail's icon pattern |
| 3 | Trash: two-section layout, forever-delete, timestamps | ⚠️ | Net superset of the prototype (prototype has neither) — not a gap |
| 4 | Trash subtitle copy | ✅ | |
| 5 | Help icon + modal + 3-step onboarding | ✅ | |
| 6 | Command palette: jump to Essay/Thread by name | ✅ | |
| 7 | Toast/confirm system | ⚠️ | Net superset of the prototype (prototype has neither) — not a gap |

---

## Known real-vs-fake tradeoffs (won't be "fixed" — building fake versions would be worse)

- **No literal AI dead-air/false-start detection pass** distinct from the composition-suggestion model already in place — Studio's tint/cut mechanic reuses the real Suggested Edits output rather than a second AI feature that doesn't exist.
- **No multi-track compositing** in Assemble/Export — the real renderer produces one sequential ffmpeg EDL. Visual differentiation (colored borders, a legend, a chapter bar) stands in for lanes that don't exist in the render pipeline.
- **No emotional-breakdown / analytical-framing clip tagging** — the 4th coherence check needs this and it exists nowhere in the data model.
- **No real waveform data** on Archive clip cards.
- **Veo resolution parameter** — genuinely unconfirmed against the live Workers AI catalog; stored but not sent rather than guessed.
- **Studio "My videos" grid: Video-ideas panel not filtered per-video** — its drag-reorder/remove logic indexes positionally into `state.timeline[group]`; filtering the displayed list without also switching that to a stable-id lookup would make remove/reorder silently operate on the wrong real segment. Suggested-cuts and Clip-candidates (read-only lists) are filtered; Video-ideas is not, deliberately.

## Regression guard

`scripts/check-fidelity.sh` spot-checks a curated set of exact prototype
copy strings / hex values against `public/app.js` and `public/style.css`.
It is not a substitute for this checklist or for screenshotting real views
with real data — it only catches the narrow case of a fixed string silently
disappearing in a later edit. Run it before claiming any view "still
matches" after a refactor.
