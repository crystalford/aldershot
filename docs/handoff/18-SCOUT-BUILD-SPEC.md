# 18 · Scout — the build spec

Doc 07 says what Scout is for. This one says how to build it. It brings together `labs/SCOUT.md` (the pipeline and its evidence), `labs/SOURCES.md` (what each platform allows), `labs/DOSSIER.md` (memory, acquisition, match-back, attribution) and the labs prototypes (`labs/Scout.dc.html`, `labs/scout-sample.js`, `Scout.dc.html`). When this document and a labs file disagree, this one wins. Go to labs for the evidence and the numbers behind a choice.

## 0. What Scout is, for the engineer

A **per-project research agent**. When the user brings Scout into a project (Settings → Scout: On · Per project · Off; or "Bring Scout in" on the plan), he works through the project's **beats**. For each beat he finds outside material that would make the video better: proof for a claim, the other side, the original a clip came from, context. Each find goes into the project as an **external moment**, with a verified quote and exact timestamps. He can also be **asked directly** ("Scout, find his latest stream") outside any plan.

He never downloads from a platform that forbids it. He finds and links. Media enters only through an open licence, the user's own upload, or a **mission** the user completes.

The thing Scout is judged on: **every quote he hands back is in the source, word for word, at the time he says, and a model never typed that timestamp.**

## 1. Architecture

```
room (UI)  ──▶  POST /projects/:id/scout/runs        ┌──────────────── Scout run (Workflow) ────────────────┐
                GET  /projects/:id/scout/runs/:rid   │ 1 decompose   (frontier, 1 call)                     │
                GET  /projects/:id/scout/board       │ 2 expand      (frontier, 1 call per round)           │
                POST /projects/:id/missions/:mid/... │ 3 search      (adapters, parallel, quota-aware)      │
                                                     │ 4 triage      (deterministic + small model)          │
                                                     │ 5 scan        (small model, map over windows)        │
                                                     │ 6 verify      (deterministic, no model)              │
                                                     │ 7 reduce      (frontier, verified rows only)         │
                                                     │ 8 snowball → back to 2, until stop()                 │
                                                     └──────────────────────────────────────────────────────┘
                                                        writes: searches · sources_examined · ledger · missions
```

- One **Workflow** per run with one **item** per search, per scanned source and per verification (see `10-OPERATIONS-AND-PRICING.md`: the completion invariant and DLQs apply).
- Model calls go through capability contracts: `Decompose`, `Expand`, `ScanWindow`, `Rank`. Each output is tagged with its model version and gated by the eval.
- **The lead model never sees a transcript.** It sees beats, ledger rows (≤ 300 tokens each) and counts.
- A run has a **budget**: max rounds (default 4), max sources scanned (default 40), max spend (default $1.50, shown before Run). Hitting any of them ends the run with the reason, never silently.

## 2. Data

These extend `03-DATA-MODEL.md`. Write them as migrations.

```sql
scout_runs(id, project_id, trigger: plan|ask|react|standing, brief, status: queued|running|done|stopped|failed,
           stop_reason: knee_and_coverage|budget_rounds|budget_sources|budget_spend|user, rounds, spend_usd,
           model_versions_json, created_at, finished_at)

beats(id, project_id, run_id, role: subject|counter|outside, name, behaviour, need_min, status: covered|thin|gap,
      queries_tried_json)             -- shared with the plan; Scout reads and updates coverage

searches(id, run_id, beat_id, family: direct|vocab|crowd|counter|seed, adapter, query, issued_at,
         results_n, new_verified_n, quota_units, cost_usd)

sources_examined(id, run_id, adapter, external_id, url, title, channel, published_at, duration_s,
                 kind: vod|clip|compilation|interview|podcast|news|reupload, transcript: native|transcribed|none,
                 triage_score, scanned bool, yield_n, dead_end bool, expires_at)

ledger(id, run_id, beat_id, role, source_id, quote_exact, quote_norm, t_start_s, t_end_s,   -- times from word ids
       word_span_json, context_before, context_after,                                     -- ±90 s, for fairness
       found_by_family, verify: verified|paraphrase|rejected, match_score, crowd_signals_n,
       original_of?: ledger_id, is_compilation_only bool, model_version, created_at)

crowd_signals(id, source_id, kind: comment_ts|twitch_clip|chapter|reddit|wiki, t_s, lag_corrected_t_s, weight, text)

missions(id, project_id, ledger_id, in_s, out_s, quote, url_at_in, expires_at,
         state: scouted|mission|fetching|matching|acquired|verified|used|failed, how: auto|capture|upload,
         verdict: verified|partial|mismatch, coverage, offset_s, fail_reason)

attributions(moment_id, credit_text, url, platform, date, chain_parent?, removed bool)
lexicon(entity, term, kind: nickname|catchphrase|meme|critic_channel, source_count, first_seen)  -- persists across projects
```

An external moment is `moment(provenance: external, acq: …)`, pointing at its `ledger` row. It uses the same table and engine as the user's own moments. A **ghost** is any external moment whose `acq` is not `verified`.

## 3. The steps

### 3.1 Decompose (frontier model, once per run)

Input: the claim, the plan's beats if there are any, the brief, and the archive summary.
Output (closed schema; the call fails if the output doesn't fit):

```json
{ "beats": [ { "id": "B1", "role": "subject", "name": "The pattern",
               "behaviour": "Berates live chat during streams; addresses chat as an adversary", "need_min": 2 } ],
  "counter": [ { "id": "C1", "inverts": "B1", "behaviour": "Explains his chat rules; apologises; laughs it off", "need_min": 1 } ],
  "personas": [ { "name": "his own moderator", "queries": ["…"] }, { "name": "a sympathetic long-time viewer", "queries": ["…"] },
                { "name": "a critic", "queries": ["…"] }, { "name": "a neutral journalist", "queries": ["…"] } ],
  "rejected": [ { "said": "he is narcissistic", "why": "a diagnosis, not a behaviour" } ] }
```

Rules the prompt states and a validator enforces:
- Every behaviour must be something **a viewer could point to on camera**. Validator: a stoplist of diagnosis and motive words (narcissist*, psychopath*, insecure, jealous, can't handle, wants to, because he…). A hit gets one regeneration; a second hit drops the beat and lists it under `rejected`.
- Every subject beat has at least one counter beat. Detractor conduct is a required counter beat when the brief is about a conflict.
- 4–8 beats in total. A plan's existing beats are kept; Scout may add counter beats only with the user's tap.

### 3.2 Expand (frontier model, once per round)

For each beat, write queries in four families, plus a HyDE line for each family:

| Family | Comes from | Example |
|---|---|---|
| direct | the behaviour in plain words | "DarksidePhil bans viewer live" |
| vocab | the community's own terms, harvested from the top 30–50 results' titles, descriptions and chapters, plus the persisted `lexicon` | "the Khan compilation", "this is why I don't read chat" |
| crowd | places where fans have already indexed moments | "best of", compilations, incident lists, timestamp threads, Twitch clips by views |
| counter | the counter beats and personas | interviews, Q&As, apologies, chat rules |
| (HyDE) | what the behaviour *sounds like* when said | "chat, I'm not going to tell you again" — used for transcript search only |

Cap at 6 queries per beat per family per round. De-duplicate against `searches` for this entity (the Dossier never re-runs a dead end; see `labs/DOSSIER.md`).

### 3.3 Search (adapters, in parallel, quota-aware)

Each adapter implements `search(query, family) → SourceCandidate[]` and `metadata(ids) → Source[]`, and declares its quota. **None of them fetch audiovisual media.**

| Adapter | Gives | Limits and rules |
|---|---|---|
| `youtube` | titles, descriptions, chapters, durations, views, comment timestamps | **100 `search.list` calls a day per project** (June 2026 model); `videos.list` / `commentThreads.list` cost 1 unit (50 ids each). Discovery goes through channel RSS (`feeds/videos.xml?channel_id=`, 0 units), WebSub push, and the web-search adapter; `search.list` is spent only on what a user typed. Store ids and our own notes; refresh metadata every 30 days; never store or fetch audiovisual content; no third-party captions (`captions.download` requires ownership). |
| `twitch` | clips (`vod_offset`, `view_count`, title), VOD metadata | Helix; app token. VODs expire after 7, 14 or 60 days, so set `expires_at`. Clip download only for the user's own channel (tier 4). No VOD chat API. |
| `websearch` | discovery across the open web (Reddit threads, fan wikis, articles) by URL | Brave Search API, about $5 per 1,000 requests; store URLs and snippets per its terms. Reddit content is not fetched (commercial use needs a contract). |
| `podcast` | episode list, audio enclosure URL, `<podcast:transcript>` where present | RSS is public by design, so audio may be fetched and transcribed (~$0.03/hr). About 6% of feeds ship a transcript. |
| `gdelt_tv` | US TV caption search, 15-second blocks, clip links | Keyless. Quote and link only; broadcasters own the footage. **Make one live test call before building on it.** |
| `user_captures` | the user's own uploads and missions | Fully readable; part of the archive. |

The adapter layer enforces quotas and returns `quota_exhausted` as a typed error. The run moves on to other adapters and records the reason. Every call writes a `searches` row.

### 3.4 Triage (deterministic, then a small model)

Score each candidate before reading any transcript:

```
score = 0.30·overlap(title+desc+chapters, beat vocab+lexicon)
      + 0.20·duration_fit(kind, beat)          // long VOD for behaviour beats, short interview for counter beats
      + 0.15·log(views) normalised
      + 0.15·crowd(comment_ts count, twitch clips pointing in, reddit/wiki citations)
      + 0.10·originality(original channel 1.0 · reupload 0.4 · compilation 0.6 until traced)
      + 0.10·recency_or_date_match(beat dates)
```

Keep the top 5–10 per beat. A source with no readable transcript **is still useful**: its crowd signals become `CROWD` rows on the board, and its clips can become missions.

**Crowd timestamps.** Parse comments with `(?:(\d{1,2}):)?(\d{1,2}):(\d{2})`, keep only timestamps that fall inside the video's duration, and cluster within 20 s. **Chat lags the moment by about 20 s**, so set `lag_corrected_t_s = t − 20` and start any scan window 30–60 s before it. Twitch `vod_offset` points straight into the VOD.

### 3.5 Scan (small model, map over windows)

Only for sources with a readable transcript (native, transcribed, or the user's own capture).
- Windows of **~2,000 tokens with ~15% overlap**, carrying word ids. Start windows at crowd timestamps where there are any.
- **One narrow question per window** ("Does the streamer address or insult a chat member? Give the exact quote and the first word's id, or NONE."). Several beats means several passes, never one combined question.
- Output schema: `{ "answer": "QUOTE" | "NONE", "quote": "…", "first_word_id": "w_…" }`. NONE is a valid, expected answer.
- **Never stuff a whole VOD into a long context.** Non-literal matching collapses past about 8–32K tokens; chunk-and-scan is cheaper and more accurate.

### 3.6 Verify (deterministic, no model)

```
norm(s) = lowercase → strip punctuation → collapse whitespace → expand contractions → numbers to digits
1. exact: norm(quote) is a substring of norm(window text)         → verified; span = the matching word ids
2. else fuzzy within ±60 s of first_word_id: best token-level ratio (Levenshtein over word tokens)
      ≥ 0.90 → verified    0.80–0.90 → paraphrase (human check)    < 0.80 → rejected
3. t_start_s / t_end_s come from the matched word ids' timings. Never from the model.
4. context_before / context_after = ±90 s of transcript around the span (the provocation before the outburst).
```

Record `verify` and `match_score` on every row, and **log the rejection rate per model and prompt version from day one**. That rate is Scout's measured hallucination rate, and it gates model swaps.

### 3.7 Reduce (frontier model, verified rows only)

Input: verified and paraphrase rows (a quote, ±20 s of context, source, date and crowd count; ≤ 300 tokens each). Output: a ranking per beat, duplicate links (the same incident in a compilation and in the original, giving `original_of`), and a one-line *why it's here* per row. The model **may not** add rows, change quotes or change times.

### 3.8 Snowball and stop

**Seeds** come from verified rows: recurring phrases, named critics, incident dates (to find the original VOD), compilations (to trace back to originals), and games or topics that co-occur with the behaviour. Each seed generates 1–3 queries, tagged `seed`.

**Stop only when both conditions hold:**
- **Knee.** Plot cumulative distinct verified moments `V(q)` against queries issued `q`. Find the knee as the point of maximum distance from the line between the first and last points. Stop when `slope_after < slope_before / 6` (Cormack–Grossman), and **never before 20 queries**.
- **Coverage.** Every subject beat has ≥ 2 verified moments and every counter beat ≥ 1 — **or** the beat is marked `gap` with `queries_tried`. A gap is a result, not a failure.

Cross-check with **capture–recapture**. Take the distinct verified moments found by the direct family (`n1`) and the crowd family (`n2`), with `m` found by both. The estimate is `N̂ = n1·n2/m`. If `N̂ > 1.5 × found`, keep going, budget permitting. The budget overrides all of this; if it ends the run, the stop reason says so.

## 4. The board, and how it reaches the room

- **Rows by beat.** `VERIFIED` (a quote, a `t=` link and the source type), `CROWD` (a place the crowd points to that Scout couldn't read; a mission candidate), `TRACE` (a compilation whose original hasn't been found yet).
- **Gaps first** (a beat with nothing, and what was tried), then the **balance meter** (subject against counter, shown as effort and as results: "sought 6 searches, found 2"), then the verified rows.
- A **diligence log export**: queries run, sources examined, counterpoints sought, rejections. Part of the dispute file.
- **In the room**, the board is not a separate page. Verified rows become **external moments** under Footage → Highlights → External, and each beat in the plan shows its finds. Attaching one makes a **ghost** in the cut. Scout's character shows the run's state (looking, found, thin, mission). See doc 07 for the copy and the character.

## 5. Acquisition and match-back

- **Auto** only where downloading is allowed by design: podcast enclosures, public-domain archives, the user's connected own accounts. Each is fetched, transcribed, then verified by duration and hash.
- **Mission** for everything else, YouTube included. `missions` are **generated from the cut**: only external moments the cut uses, in timeline order, expiring sources first. Cutting a block deletes its mission. A mission card has the deep link at the in-point, in/out, the quote, the source, why it matters, and an expiry badge.
- **Match-back** when a file arrives, cheapest method first:
  1. the attached mission id (verify, don't search);
  2. transcript alignment: transcribe the upload, then fuzzy n-gram align against the scouted quote and the source window;
  3. landmark audio fingerprinting (audfprint/Panako class, *not* Chromaprint/AcoustID) for noisy or music-heavy clips;
  4. vPDQ frame hashes for silent clips.

  Verdicts: `verified` (≥ 90% word coverage, ±1 s offset), `partial` (show the missing words), `mismatch` (say so plainly). **Never silently accept a near-miss.**
- **The video never ships with a silent hole.** At final render, every remaining ghost asks: hold for the grab, drop the beat (the solver re-cuts), or use a quote card with the attributed words.

## 6. Attribution

For every external clip, written automatically at verify time: a lower-third *Source: [channel] · [platform] · [date]* for the clip's first 3–4 s; chains credit the original (*via* the compilation); a timestamped source list in the description; OTIO clip metadata (`metadata.aldershot`) so it survives export. Editable per clip; **removal needs an explicit toggle**.

## 7. Fairness, as product rules

These are not legal advice; have a media lawyer review before commercial publication. The planner refuses diagnoses and motives. Counter beats are mandatory and shown. Every board claim links to an original-source verified quote with ±90 s of context. The React rules apply once a clip is used: commentary next to every clip, a warning below 1:1, clip length set by need, and a ±30–60 s check that the clip's meaning survives its context. Together these map onto *Grant v Torstar*'s responsible-communication factors (diligence; was the subject's side sought).

## 8. Cost (planning figures; confirm rate cards)

Per hour of readable transcript: map scan with a small model and 4 narrow questions ≈ $0.005–0.015; reduce ≈ $0.01–0.02; transcription where none exists ≈ $0.03 (turbo class) to $0.31 (premium). Decompose and expand ≈ $0.05–0.15 per round. **A typical run (4 rounds, ~30 sources, ~12 readable hours) is ≈ $0.40–1.20.** Show the estimate before Run. Multi-agent research costs about 15× a chat, so Scout runs per project on demand, never as background chatter (standing queries are deferred).

## 9. Phases and acceptance tests

**v0 — find and link (no transcripts beyond open sources and the user's).** Decompose; the four families; the YouTube, Twitch, websearch and podcast adapters; triage; crowd signals; the board with VERIFIED/CROWD/TRACE; external moments in the room; ghosts; missions from the cut; attribution.
- *Accept:* a brief with "he's narcissistic" returns only observable beats and lists the diagnosis as rejected. Every subject beat has a counter beat. No code path fetches audiovisual content from YouTube or Twitch (a test greps for media-fetch calls on those adapters). `search.list` spend stays under the daily cap on the 20-brief eval. A dropped `quota_exhausted` is recorded, never silent.

**v1 — scan and verify.** Windowed scan, the deterministic verifier, reduce, snowball, knee + coverage + capture–recapture stopping, the gap list, the diligence log, match-back by words.
- *Accept:* on a deliberately hallucinated row (the model returns a quote not in the window), the verifier rejects it. Every verified row's times equal its word ids' times. The run stops with every beat covered or listed as a gap with its queries. A dropped capture matches its mission at ≥ 90% coverage, or is reported as partial or mismatch.

**v2 — capture.** The browser extension (open at the in-point, tab-capture to out-point + 2 s, upload with the mission id) and the companion desktop app. Positioned as capture for the user's own lawful use, never as a downloader.

**v3 — standing monitors** (deferred; see `12-DEFERRED.md`).

**Eval** (from `labs/SCOUT.md`): 10–20 creators with fan-curated timestamp lists (Reddit and wiki incident lists, compilation chapters) as recall ground truth within ±30 s. Measure precision ("on-beat and correctly attributed", human-rated), verification pass rate, counterpoint coverage, time to first good clip, cost per accepted moment, and saturation (spend held-out extra budget after stopping, count new finds). Run ablations on the counter branch, vocabulary discovery, window size, and one versus several questions per window. About 20 briefs shows large effects.

## 10. The worked example

`labs/scout-sample.js` is a complete, illustrative run of the DarksidePhil brief: beats B1–B6 and counter beats C1–C4, rejected claims, the four query families with real-shaped queries, sources with the access note for each, scan windows with the exact question asked, crowd rows with lag correction, snowball seeds, and per-round counts for the knee. Its quotes and sources are invented to show the shape, not real findings. `labs/Scout.dc.html` is the board built on it, including acquisition states and the cut with ghosts. Use them as fixtures for the v0 and v1 tests.
