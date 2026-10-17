# Scout — finding clips that aren't yours yet

7 Oct 2026, from the Scout pass (pass 9) and the conversation that framed it. Nothing here is built. Scout is an add-on behind the editor, not a prerequisite for it.

## The one-line version

**The archive answers "what do I have?" Scout answers "what exists out there that proves my point?"** A small research agent turns a thesis into observable behaviours and their counterpoints, searches in parallel query families, scans transcripts in narrow chunks with a cheap model, writes every candidate to a typed ledger with an exact quote and time, verifies each one by plain string match — no model — and stops when finds level off *and* every beat is covered. **Scouting is separated from acquiring:** Scout finds and links; footage enters the archive only by open licence, by the user, or by a companion app on the user's own machine.

## The constraint that shapes everything: access, not engineering

- **YouTube** (official API): search, metadata, comments, chapters — yes. **Captions for videos you don't own — no** (`captions.download` needs edit permission). Scraping and undocumented endpoints are banned by policy; datacenter download is blocked and carries anti-circumvention risk in the US and Canada. *A SaaS dies from account bans and takedowns, not bad code.*
- **Twitch**: `Get Clips` returns `vod_offset` and `view_count` — a legitimate crowd-highlight signal; **no supported VOD-chat API**; VODs expire in 7/14/60 days.
- **Reddit**: free tier is non-commercial only; commercial access is contract-only.
- **Open sources with transcripts**: podcast RSS (`<podcast:transcript>`), Internet Archive TV News (since 2009), C-SPAN (search and embed only), council and government archives (often open licence). *This is where Scout can ingest legitimately.*
- **The founder's old Windows app worked because it ran on the user's machine.** That's the companion-app tier: capture happens locally under the user's control; Aldershot's servers never touch YouTube.

So **Scout v0 treats YouTube as a link-and-metadata source** and reads transcripts only from open sources and what the user supplies.

## The pipeline

**0. Behaviour-first decomposition.** The lead model rewrites the thesis as things a viewer could point to on camera, and **refuses psychological claims** ("he's narcissistic" → "berates live chat", "blows up at backseaters", "bans viewers mid-stream", "responds to critics by name"). Each behaviour is a beat with a scene role. **Counterpoint beats are mandatory, generated systematically**: for every Subject beat, its inverse ("berates chat" → "explains his chat rules / apologises / laughs it off"), plus STORM-style personas (his own moderator, a sympathetic long-time viewer, a critic, a neutral journalist) each writing 3–5 queries, plus **detractor conduct** — because a "battle" shown from one side is the structural bias a fairness defence would expose.

**1. Four query families, in parallel.** *Direct* (the behaviours in plain words) · *Community vocabulary* — a discovery pass over the top 30–50 results' titles, descriptions, Reddit and wiki pages harvests nicknames, catchphrases, meme names, critic channels; each becomes a query (pseudo-relevance feedback on the fandom's own lexicon — how you find moments fans have already named) · *Crowd-indexed* (compilations, "best of", Reddit threads with `hh:mm:ss`, fan-wiki incident lists, Twitch clips by view count) · *Counterpoint* (interviews, podcasts, Q&As, apologies, chat rules). Then a HyDE-style step: write what each behaviour would *sound like* ("chat, I'm not going to tell you again…") and search transcripts with that — transcripts contain spoken phrasing, not the brief's abstract labels.

**2. Metadata triage before any transcript is read.** Title/description overlap with beat vocabulary, duration (6-hour VODs score high for behaviour beats, short interviews for counterpoints), view count, original channel vs re-uploader, count of timestamp comments, whether a Twitch clip's `vod_offset` points into it. Keep 5–10 per beat. (`videos.list` is 1 quota unit per 50 ids; `search.list` is 100 — the scarce resource.)

**3. Map–reduce transcript scan with a ledger.** *Map*: ~2,000-token windows, ~15% overlap, word timings kept; a **small model answers one narrow question per window** ("Does the streamer address or insult a chat member? Exact quote + start time, or NONE") — one question per pass, abstention allowed. *Reduce*: the frontier model sees only **verified** rows, a few hundred tokens each, ranks them against beats, marks duplicates (the same incident in a compilation and the original VOD). **The lead never sees a transcript — only ledger rows and counts.** Ledger row: `moment_id · beat · role · quote_exact · t_start · t_end · source_url · source_type (original / reupload / compilation / clip) · found_by_family · verified · match_score · crowd_signal_count`, plus ±90 s of surrounding transcript so the editor can see the provocation before the outburst.

**4. Verify deterministically.** Normalise both strings → exact match inside the chunk the model saw, **timestamp taken from word timings, never from the model** → else fuzzy match within ±60 s: accept ≥ 0.9, flag 0.8–0.9 as "paraphrase — human check", reject below. **Log the rejection rate per model and prompt from day one** — it's our measured hallucination rate, better than any published average.

**5. Snowball.** Mine verified rows for seeds: recurring phrases, games that co-occur with blow-ups, critics named, incident dates (to find the original VOD), compilations (to trace to originals). A few queries per seed, each tagged by family so we can measure which family finds distinct moments.

**6. Stop on two conditions, both required.** *Diminishing returns* — the knee rule: cumulative distinct verified moments against queries issued; stop when the slope after the knee is under one-sixth of the slope before (Cormack–Grossman), with a minimum-effort floor. *Coverage* — every Subject beat has ≥ 2 verified moments and every Counterpoint beat ≥ 1, **or the beat is listed as a gap with the queries that were tried**. Cross-check with capture–recapture: if the direct and crowd families overlap little, Lincoln–Petersen says the pool is bigger than what we have — keep going. (The knee method alone missed an entire campaign in TREC; coverage is why it isn't optional.)

**7. The Scout board.** Rows grouped by beat: moment · verified quote · link with `t=` offset · source type · crowd signals · status. A **balance meter** (Subject vs Counterpoint counts). A **gap list** with attempted queries, so the editor can tell "doesn't exist" from "not found yet". An exportable **diligence log** (queries run, sources checked, counterpoints sought).

## Why these choices (the evidence)

- **Token budget and parallelism beat prompt cleverness.** Anthropic's lead-plus-subagents beat a single agent by 90.2% on its internal eval; token spend explained 80% of BrowseComp variance. Multi-agent costs ~15× a chat — so Scout runs on-demand per brief, not as background chatter.
- **Retrieval quality is the second lever**: on a fixed corpus GPT-5 went 55.9% → 70.1% swapping BM25 for a strong embedding, with fewer searches. Scout reuses the archive's hybrid retrieval.
- **Chunk-and-scan beats stuffing.** On NoLiMa, 11 of 13 models fell to ≤ 50% of baseline at 32K tokens on non-literal matching; GPT-4o's effective length was ~8K. "Find where he berates a backseater" is exactly that. A 6-hour VOD is ~66K tokens; scanned in windows by a small model it costs cents.
- **Multi-perspective questioning broadens coverage** (STORM: +10% breadth, +25% organisation as judged by Wikipedia editors) — the mechanism behind the counterpoint branch.
- **Query expansion works, once per round**: query2doc lifted BM25 3–15% but took latency from 16 ms to >2 s; small models gave marginal gains. Frontier model, once per round, not per query.
- **Crowd signals predict highlights**: chat-based extraction reached P@K of 70–90% from one labelled video — and **chat lags the moment by ~20 s**, so scan windows start 30–60 s before each crowd timestamp.
- **Shouted speech breaks transcription**: Whisper turbo at 29.6% WER on shouted/distanced speech vs <8% averages. **Rage moments are where captions are worst** — so rage beats are also found through non-transcript signals (clip offsets, comment timestamps, Reddit citations).

## Cost per hour of transcript (planning assumptions; confirm rate cards)

Map scan with a small model, 4 narrow questions: ≈ $0.005–0.015/hr · reduce/rank on verified rows only: ≈ $0.01–0.02 · transcription if none exists: $0.03/hr (Whisper-turbo class) to $0.31/hr (premium). Stuffing a whole 6-hour VOD into a frontier model is ≈ $0.20 per pass *and* less accurate. **Rule: chunk-and-scan for every "find the moment" task; one long-context call only for whole-video questions with no needle, and then over a summary of chunks.**

## Provenance and fairness

- **Trace compilations to originals** (date, game, quote → the original VOD's transcript); mark rows *original-confirmed* or *compilation-only*. Prefer the streamer's own channel; flag re-upload-only rows; check for cuts across the quote span.
- Tooling where useful: keyframe reverse-image search, audio fingerprinting against the original, Content Credentials where present (rare on streamer content — absence isn't evidence).
- **Fairness as product rules, not advice**: behaviour-first decomposition (the planner rejects diagnoses and motives) · a mandatory counterpoint branch with the balance meter · every board claim links to an original-source verified quote with context · the diligence log. These map onto Canada's responsible-communication factors (*Grant v Torstar*: public interest, diligence, "whether the plaintiff's side of the story was sought") and the US public-figure standard (opinion on disclosed true facts). *Have a media lawyer review before commercial publication.*

## Acquiring — the tiers

1. **Open sources ingest automatically**: public domain, Creative Commons, government and council video, podcast RSS, licensed stock.
2. **The user brings the rest**: uploads or links they have the right to use.
3. **A companion desktop app** captures transcripts, chat logs and clips on the user's machine and uploads them as user-supplied material. Responsibility sits with the user; Aldershot never touches the platform's servers.
4. Once a clip is in, the react-mode rules apply (`SCRIPT-AND-TIMING.md`): commentary adjacent to every clip, ratio warning, clip length by need, the ±30–60 s fairness check.

## Evaluation

Recall against fan-curated timestamp lists (Reddit and wiki incident lists, compilation chapters) for 10–20 creators, within ±30 s · precision by human rating "on-beat and correctly attributed" · **verification pass rate** (the hallucination metric) · counterpoint coverage · time to first good clip · cost per useful, accepted moment · saturation calibration (spend a held-out extra budget after stopping; count new finds — low is good) · blind A/B of boards. Ablate: counterpoint branch, vocabulary discovery, chunk size, one vs several questions per window, stuffing vs scanning. ~20 representative briefs is enough to see large effects.

## Phases (none block the editor)

- **v0 — search and links, no downloading.** Decomposition, the four families, YouTube metadata and comment triage, Twitch clip offsets, deep links, the board with crowd-signal counts. Transcripts only from open sources and user-pasted text. Ships as the **External** source on Home's canvas.
- **v1 — transcript scanning and verification.** The map–reduce scanner, the ledger, the deterministic verifier, knee-plus-coverage stopping, the gap list, the diligence-log export, the eval harness.
- **v2 — companion capture.** The desktop app, reborn from the founder's Windows tool.
- **v3 — standing monitors.** Saved beats run on a schedule against new uploads, new clips (timed to VOD expiry), new episodes: *"she contradicted her March statement today — here's the clip."* The editor becomes a newsroom.

**Big swings**: a persisted community-vocabulary lexicon per fandom (each new brief about the same creator starts with years of crowd vocabulary — a compounding moat) · the fairness-by-construction board sold as defamation-risk reduction · crowd-signal fusion as a lag-calibrated "notability" prior · licensed transcript partnerships instead of scrapers · an open "open-web moment search" benchmark from fan-curated lists.

## What this changes in Aldershot

- **Scout is a fourth source, not a surface.** The Directed plan already has `shot new · archive · scout · generated` per block, and `PICTURES.md`'s source order is *own footage → documents → open world → generated*. Scout *is* the open-world step, made real. Its board rows are moments with `source_type: external`; attaching one works like attaching anything else.
- **The Scout board is the Home canvas in another state.** Beats are the plan's blocks; the balance meter and gap list are the same "weak-spot flags" `EDIT-ENGINE.md` describes ("point three has no visual proof"). No new UI vocabulary.
- **Behaviour-first decomposition is already the Read's rule** ("observable, not psychological") — now it's also the scout's. The "DSP break from reality" brief becomes "what did he say, on camera, about X" automatically.
- **Verified-quote-or-nothing** extends the footage system's judge to external sources; the ledger row is the same shape as the evidence ledger.
- ***Before you post* gains the honest line about external clips**: linked, not downloaded; captured only by you or your companion app; traced to the original where possible. *(Product copy updated.)*
- **Deferred, deliberately**: nothing of Scout ships before the editor does. v0 is small enough to be an afternoon once the archive's retrieval exists.

## Sources

- Anthropic, "How we built our multi-agent research system" (13 Jun 2025) and Opus 4.6 release notes; BrowseComp and BrowseComp-Plus; Tongyi DeepResearch technical report; OpenAI and Gemini Deep Research self-reports.
- STORM (Shao et al., NAACL 2024); query2doc (Wang, Yang & Wei, EMNLP 2023); HyDE; NoLiMa (Adobe Research, 2025).
- Cormack & Grossman, TREC 2016 Total Recall (knee and target methods); Lincoln–Petersen capture–recapture.
- LIGHTOR (ICDE 2020); BERSt shouted-speech benchmark; AMI meeting WER figures.
- YouTube Data API v3 quota and Developer Policies (III.D.7, III.E.6); Twitch Helix (Get Videos, Get Clips) and VOD retention; Reddit Data API terms; `<podcast:transcript>` (Podcasting 2.0; Apple adoption Mar 2024); Internet Archive TV News; C-SPAN Video Library terms; Filmot, YouGlish, AVCEE, TVEyes, SnapStream.
- *Grant v Torstar*, 2009 SCC 61; US public-figure defamation standard (not legal advice).
- Cloudflare Workers AI pricing (Whisper turbo 46.63 Neurons/min; Nova-3) — confirm; model token prices are planning assumptions.
