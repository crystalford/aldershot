# 04 · The rule engine

## The idea

A cut is not a thing you store. It is what a short list of plain-language rules produces when applied to the moments — and it is re-produced whenever the rules, the footage, the transcript or the target length change. "Tighten 10%" is one setting, not a hundred trims. Shorts, a trailer and the full cut are three renderings of one rule set. This is the product's thesis, and the research confirmed it from the other direction: deterministic placement works and has for a decade; model agents resolve about a quarter of real editing tasks and claim success almost always.

## The reference implementation

`footage.js` in the project root is the engine the room calls for everything. Port it, don't reinvent it. Besides `compute` and `applyRule` it holds the sample read (`TRANSCRIPTS`, `SUMMARIES`, `ARCHIVE_SUMMARY`, `READS`), the stand-in for meaning search (`searchLines`), outside moments (`EXT_SRC`, `EXT`), the sample plan (`PREP`), and the project save/restore.

```
compute(rules, struck, inserts, beatMode, scope, set) → { st, rows, secs, ord }
```

Order of operations (keep this order; it encodes precedence):

1. Start from the footage set's clips (scoped to one source if `scope`), each `in: false`.
2. **keep** rules (non-hand) mark matching moments in, recording `byId`.
3. **drop** rules (non-hand) mark matching moments out, recording `dropId`; a keep/drop contest is recorded.
4. keep rules with `wins` re-take contested moments.
5. **cap**: while total exceeds the cap, drop the longest moments that aren't `strong`, charging the cap rule.
6. **hand** rules (kept / cut by hand) override everything above.
7. Moments pulled into the cut by an **insert** are removed from the rule flow (they're placed by hand).
8. **order**: `time` = chronological; `strand` = one thread at a time, threads in the set's order, unthreaded last; `open` = strand order with the longest `strong` moment moved first.
9. **gap** rule: after the last moment of each thread (not in `time` order) a 12-second voice row is inserted, attributed to the gap rule. A moment carrying `voAfter` (from a plan) adds a voice row with the plan's narration.
10. **inserts** (clip / your line / reaction) are spliced after their anchor row.
11. Beat mode `over` makes a voice row cost zero seconds (voice over picture).
12. Duration of a moment shrinks with struck words: `max(3, round(dur × (1 − struck/words)))`.
13. A row is a **ghost** if its moment is external and not yet verified.

`applyRule(rules, rule)` replaces an existing order / cap / len / count / hook rule of the same kind and appends anything else. `saveProject` / `loadProject` persist the project.

## Parsing a sentence into a rule

The parser is deterministic (regexes), in the Editor's `parseLine` / `parseShort` / `parseAvoid` and Home's `cutRuleFrom`. Patterns worth preserving:

- threads and kinds of line: "lose the house thread", "keep the hedging", "take out the hellos"
- orders: "as it happened", "one thread at a time", "start on the sharpest line"
- lengths: "under three minutes", "keep it under 2 min"
- landing: "end on the answer" → keep the resolving moment
- shorts: "20–40 seconds", "hooks in the first 2 seconds", "we need 8", "no politics" (topic aliases → regexes)
- **feelings**: "the start drags" → open on the sharpest line; "hard to follow" → one thread at a time; "tighter / punchier / too long" → under three minutes
- sound: "duck the music", "clean the hum", "lift my voice over him"

A sentence that doesn't parse gets an honest reply listing what does parse — never a silent no-op. In production, the deterministic parser runs first; a model is consulted only when it fails, and the model's output must be a rule object in the closed schema, never a timeline edit.

## The directive / solver split (production)

The model's job is to **direct**: which moments back which point, the order, each beat's visual job, where the turn lands — as a typed directive with bounded settings. It never outputs timestamps or frame arithmetic. The **solver** places: cuts on breaths (lowest-energy frame within ±40 ms of the aligned word edge), holds for reading time (~0.3 s per word on screen + 1 s), J-cuts on speaker change (audio leads 4–12 frames), pacing curves per edit profile, music retimed to land its last downbeat on the last frame. `footage.js` is the first-order solver; the production solver adds a dynamic program for cuts and duration and an integer solver for B-roll assignment.

**Typed ops**, ~15 verbs, each on selection handles (block ids, word spans, "pauses > X"), each with `dry_run`: select · cut (ripple | lift) · keep_only · move · trim · slip/slide · set_pace · split_av · add_overlay (anchored to words) · set_audio · retime · reframe · apply_template · branch/checkout/undo/redo · render_preview. Unknown ids are rejected with suggestions; raw timestamps are not accepted as arguments.

**Validate and measure before showing.** Schema → references exist → constraints (nothing outside its media, protected beats untouched, dwell rules met, duration window) → compile → measured check (duration, cut count, median pause, longest static shot, loudness) → a diff in editor's language: *removed 14 pauses (−38 s), moved 2 blocks, 3 J-cuts added*.

## Rule effects are first-class

Every rule shows what it does *right now* — "8 of 14 moments · 2 to-camera gaps", "takes 3 slow openers off the shortlist", "nothing here touches it — it watches for it", "off — footage as shot". Compute effects by diffing `compute()` with and without the rule. This is the explanation layer; without it the product is a black box with toggles.

## Edit profiles

Genre is a parameter set applied after the cut is aligned, not a writing instruction: duration window, pace per role, cut grammar, opening rule, captions, loudness, beat-selection policy. The Cut / Shorts toggle is two profiles. Starting defaults are in `labs/FORMATS.md`; tune them on retention data, not folklore.

*Rests on:* `footage.js`; `labs/EDIT-ENGINE.md`; `labs/FORMATS.md`; `labs/SCRIPT-AND-TIMING.md`.
