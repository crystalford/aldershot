# 03 · Data model

Relational tables plus embeddings. **Never a knowledge graph** (indexing cost ~600× hybrid search for no gain here). Every stored fact carries moment ids. Closed schemas: model output must fit a schema or the call fails visibly.

## Sources

A video, audio file or document the user brought or Scout linked.

`source(id, kind: video|audio|document|image, title, duration_s, platform, url, channel, published_at, hash, provenance: yours|external|yours-doc, acq: none|scouted|mission|acquired|verified, licence, credit_text, read_state: unread|reading|read, read_depth: words|screen|all, hours_charged)`

Read once; `hours_charged` is set when reading completes and never again. Metadata from platforms refreshed every 30 days; nothing audiovisual stored for external sources unless the user acquired it.

## Moments

The unit of everything. Two sizes:

- **Parent** — a topic span (2–8 min) found by transcript breakpoints; carries a one-line topic label (the thread chip) and a summary.
- **Child** — one utterance or 1–3 sentences (30–120 tokens, no overlap); the unit of matching, quoting and cutting.

`moment(id, source_id, parent_id?, start_s, end_s, text, speaker_id?, thread, tags[], ocr_text?, shot_id?, embedding_version, provenance (inherited), acq (inherited))`

Timestamps are derived from **word ids**, never typed by a model. `word(id, source_id, idx, text, start_s, end_s, confidence)` is the grounding table; a moment is a word-id span.

Tags are a closed set the rules can address: `chat` (hellos, mic checks), `hedge`, `core`, `strong`, `resolve`, `house`-style thread tags, `plan`, `exhibit`, `doc`, `cam`, `ext`. New tags come from the labelling pass, not from free text.

## The read — words, summaries, status

The read is what makes footage searchable and quotable; it is stored, not recomputed.

- `word(id, source_id, idx, text, start_s, end_s, confidence, speaker_id)` — every word, timed. The grounding table: moments, quotes, receipts and cuts are word-id spans. Imported as-is when a transcript exists (Neolog's `transcript_words`, YouTube captions, a subtitle file), then force-aligned lazily the first time a source is cut.
- `summary(id, scope: source|thread|archive, scope_id, text, moment_ids[], model_version, updated_at)` — one per source, one per thread, one for the whole archive. Every sentence carries moment ids. The archive summary travels with every request so the model always knows what's there; search fetches the detail.
- `read_state(source_id, state: not_read|reading|read|failed, depth: words|screen|all, via: transcribed|imported, progress, error_class)` — shown on every video.
- Indexes: a keyword index over words + OCR text + labels + speaker names, and a vector index over child moments, both keyed to the same word ids (`06-FOOTAGE-SYSTEM.md`). Detail and the Neolog import mapping: `17-STORAGE-AND-NEOLOG.md`.

## Speakers

`speaker(id, source_id, label, name?, centroid_embedding)`. Diarised per file; a name confirmed once by the user is enrolled across files (conservative cosine threshold; unknown stays unknown). A "several / crosstalk" speaker exists rather than forcing attribution.

## Rules

A rule is a policy, re-applied. `rule(id, project_id, kind, params, on, origin: seed|typed|brief|read|style|hand|plan, text)`.

Kinds and params:

| kind | params | effect |
|---|---|---|
| keep | tag or cid; wins | moments matching come in |
| drop | tag or cid | moments matching go out |
| order | strand · time · open | one thread at a time · as it happened · sharpest line first |
| gap | secs | a to-camera slot after each thread |
| cap | secs | drop longest non-strong moments until it fits |
| len | lo, hi | shorts length window |
| hook | secs | shorts must open on the point |
| count | n | the best n shorts |
| avoid | topic, re | shorts about the topic come off the shortlist |
| fx | fx: clean · duck · lift · stab · attrib · pictures; scope | audio/picture treatments with scope |
| must_keep | cid_a, cid_b | never separate (a claim and its qualifier) — the integrity envelope |

`text` is the sentence the user sees. The exact semantics are `footage.js compute()` — see `04-RULE-ENGINE.md`.

## Projects

`project(id, title, brief, spine, kind: cut|shorts|essay|react|story|supercut, edit_profile, rules[], struck{cid: {wordIdx: true}}, inserts[], beat_mode{}, recorded{}, takes{}, scope_source?, attached[moment_id|source_id], footage_set_ref, plan?, conversation[], updated_at)` — a project is a footage set + rules + its conversation; opening it resumes all three.

The prototype persists one project slot in `localStorage["aldershot.editor.v1"]` with `{q, href, at, title, runtime, rules, hand, voice, recorded, set?, plan?, state}` — the shape to generalise. A project may carry its own footage set (`set: {SRC, CLIPS, STRANDS}`) when built from a plan.

## Plan

`plan(project_id, claim, corpus: huge|moderate|thin, beats[])`; `beat(id, role: subject|counter|outside, name, must_show, coverage, finds[moment_id], narration?, status: found|thin|ghost)`. The plan's order becomes an order rule.

## The evidence ledger

Every claim a video makes remembers what backs it. `evidence(id, project_id, claim_text, moment_id, quote, start_s, end_s, judge_label: supports|related|none, judge_score, threshold_version, verified_by: string_match|audio|frame)`. It is the dispute file in Before you post, the receipt the viewer can be shown, and the training set for a specialised verifier later.

## Scout

`search(id, entity, query, family: direct|vocab|crowd|counter, issued_at, results, new_count, cost_usd)` · `source_examined(source_id, entity, yield, dead_end)` · `mission(id, project_id, moment_id, in_s, out_s, quote, url, expiry?, state: scouted|mission|fetching|matching|acquired|verified|failed, how: auto|capture|upload)` · `attribution(moment_id, credit_text, url, platform, date, chain_parent?)`.

## Jobs and items

`job(id, kind, project_id, status, created_at, cost_usd)` · `item(id, job_id, kind: read|segment|shot|render_chunk|generation, status: pending|running|succeeded|failed_retryable|failed_terminal|skipped_by_user, attempt, last_error_class, provider, model, cost_usd, idempotency_key, deadline_at)`.

The idempotency key is a **content address**: hash(input asset hashes + directive hash + model + params) — the same hash that keys the render cache. **A job is complete only when every item is terminal and none is `failed_terminal`**, or the user explicitly accepted a degraded result.

## Style Card and preferences

`preference(user_id, scope: all|shorts|cuts|source, key, value, evidence_count, sleeping)` — learned from keeps and cuts; surfaces as a rule once it has enough evidence; the user switches it off or wakes it. Saved rule sets are `recipe(id, name, rules[])`.

## Assets and pictures

`asset(id, kind: footage|document|still|plate|graphic|generated, source_id?, licence, credit, hash, layers?, depth_map?, generated: bool, generator?, cue_sheet_entry?)`. Every picture placed in a cut is typed `evidence | illustration | synthetic`; the type sets the on-screen label.

## Storage shape (for the handoff)

Relational store for the tables above; a vector index per embedding version (re-index everything on model change, never mix); object storage for originals, proxies, renders, stems; a per-project single-writer object holding the live edit document and ops log (undo, redo, branches as head pointers). OTIO export of the compiled timeline is the escape hatch.

*Rests on:* `labs/FOOTAGE-SYSTEM.md`, `labs/DOSSIER.md`, `labs/EDIT-ENGINE.md`, `labs/OPERATIONS.md`; `footage.js`.
