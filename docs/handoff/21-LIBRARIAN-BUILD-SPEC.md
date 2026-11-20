# 21 · The Librarian — the build spec

Scout is the second engine in this product and the only one built as a
*character*: its own corpus, its own phases, its own tables, its own budget,
its own board, its own refusal, and a deterministic check underneath it. That
is why it was tractable to build. This document describes the third engine in
the same shape.

Written 20 Nov 2026 against the capture-side audit, so the "what exists" lines
are read off the code rather than remembered. Where this and
`16-STATE-OF-PLAY.md` disagree, this one is later; where this and the code
disagree, the code wins and this document is wrong.

## 0. What the Librarian is, for the engineer

Scout knows about **other people's footage**. The Librarian knows about
**yours**.

Its job is three questions, and it should be able to answer all three without
anybody asking for a cut:

1. **What have I got?** Moments, not files. How much, how long, how much of it
   is you working something out rather than saying hello.
2. **What is it about?** Subjects in the user's own words, not a taxonomy.
3. **What can it back?** Which claims your library supports, which are thin,
   and which you have nothing for.

The third is the one that matters, because it is the only honest version of
the thing the product promises: *this gets better the more you put in it.* A
library that cannot say what it can now argue cannot demonstrate that.

**The thing the Librarian is judged on:** every claim it makes resolves to
moments you can click. No aggregate without its members.

## 1. Architecture

```
the read ──▶ fillLibrary()                      moments exist the moment footage is read,
             src/ingest.ts, src/moments.ts      deterministically, with no model call

the sweep ─▶ rethread()                         ┌──── the Librarian, as a trickle ─────┐
             src/index.ts (hourly)              │ 1 index    embed every moment        │
                                                │ 2 group    cluster at JOIN_AT        │
                                                │ 3 name     tf-idf, the user's words  │
                                                │ 4 sum      what the thread is about  │  NEW
                                                │ 5 lex      the terms this library    │  NEW
                                                │            actually uses             │
                                                └──────────────────────────────────────┘

the room ──▶ POST /api/ask                      the conversation: timed lines, with reasons
             GET  /api/library/standing         what you can back, what is thin          NEW
```

Nothing here is a per-request engine. Scout runs when asked and reports once;
the Librarian is **standing** — it is a property of the account that is true
between sessions, which is what makes it a reward rather than an answer.

- Threading is deliberately a **trickle**: three users per sweep, because
  grouping embeds every quote. `src/index.ts` argues this and is right —
  *"threads are a reading of an archive, and an archive that grew ten minutes
  ago can be read in an hour."* Do not make it synchronous to a read.
- The lead model never ranks the library. Steps 1–3 and 5 are deterministic.
  Step 4 is one call per thread and is the only model call added here.

## 2. Data

**What exists.**

| thing | where | state |
|---|---|---|
| moments, with word-id spans | `v2_clips`, `start_word`/`end_word` | built; created on read as of 20 Nov |
| four derived tags | `src/moment-tags.ts` | built, deliberately **unstored** — see below |
| threads | `v2_threads`, `v2_clip_threads` | built; `rethread` in the hourly sweep |
| thread names | `nameFromPhrases`, tf-idf over 1–3-word phrases | built; invariant 10 by construction |
| the meaning index | Vectorize, `src/embeddings.ts` | built; `clipText` = `"{source_title} — {quote}"` |
| the judge | `src/judge.ts` | built; backs / related / unrelated, with a line |
| the conversation | `POST /api/ask`, Ask button in the composer | built and reachable |
| a claim's support band | `priceAngles`, `verdict()` | built, per-request only |

**The tags are not stored, and that is correct.** `src/moment-tags.ts`: *"a tag
a model assigned in a batch job last Tuesday cannot be re-derived when the user
asks why a moment was dropped, and a rule that cannot explain itself is the
black box with toggles this product is explicitly not."* Anything this engine
adds must survive the same question: **why does it say that?**

**What is missing.**

| thing | where | state |
|---|---|---|
| `v2_threads.summary` | `writeThreads` inserts a literal NULL | the thread card's summary line can never render |
| `scout_lexicon` (entity, term, kind, source_count) | created in `src/schema.ts` | written by nothing, read by nothing; `scout-job.ts` passes `const vocabulary: Term[] = []` |
| `v2_clips.used_count` | column exists, default 0 | never incremented; the footage card renders a string that cannot appear |
| the standing board | — | nothing computes "what your library can back" |
| speaker | `segments.speaker` | dead; the model exists, no UI can enable it, and its output field is recorded as unverified |
| what is on screen | — | nothing looks at a pixel for meaning. One poster per *source*, reused as the frame for every moment of it |
| date of event | `sources.recorded_at` | import-only, read nowhere |

The last three are not this engine. Speaker and screen belong to a different
character (see §7); a date needs an importer that knows one.

## 3. The steps

**4 · sum — what a thread is about.** One sentence per thread, written from the
moments in it, stored on `v2_threads.summary`. The only model call this engine
adds. It must be regenerated when the thread's membership changes, which
`rethread` already detects, and it must be **droppable**: a thread whose
summary fails to generate keeps its tf-idf name and renders without one, the
same way a group nobody can name is dropped rather than guessed at.

Invariant 10 applies with force here: the summary is about the user's own
footage, in the user's own words where they exist. It is not a genre label and
not an assessment.

**5 · lex — the terms this library uses.** `scout_lexicon` already has the
shape: entity, term, kind, source_count. Fill it from the same tf-idf pass that
names threads — the phrases a group shares and the library does not are, by
construction, the terms this person actually says. Deterministic, no model.

Two things fall out immediately:
- The Footage page gets a subject filter that is not a thread chip.
- **Scout gets its vocabulary.** `expandQueries` takes it and has always been
  handed an empty array, and `overlap()` in triage takes it with a default of
  `[]`. Filling this makes two existing engines better without touching them.

**6 · account — what a moment has been used for.** Increment `used_count` where
a moment enters a cut, and record *which* cut. This is the Librarian's memory
of your own work and the only way the library can say "you have never used
this" — which is a more useful sentence than any score.

**7 · report — the standing board.** `GET /api/library/standing`. Gaps first,
the way Scout's board does it. Per claim the account has ever made (plans,
angles, the judge's answers): backed, thin, or nothing. Bands, never numbers
(invariant 3). Every band expands to the moments under it (invariant 4).

A claim with nothing behind it is the most important row on the board, because
it is the next thing to film. That is the worklist, and it is also the reward:
the row moves when you capture.

## 4. The board, and how it reaches the room

Not a new page. The library already has a room — Footage — and the standing
report belongs on it, above the grid, in the shape the archive summary already
uses: a paragraph, not a count. `20-DESIGN-BRIEF.md` Part Two is the relevant
constraint; the design draws populated surfaces and has never drawn this one.

The reading pass is the other surface and the better moment. A read now
produces moments and checks missions, so by the time it finishes the Librarian
knows something it did not know before. Saying it there — *"this is your first
footage on X"*, *"it answered the mission for Y"* — is the capture loop paying
off where the person is looking.

## 5. Refusals

Scout's refusal is what defines it: **finds and links, never downloads.**

The Librarian's is: **it describes and counts; it never says how good your
footage is.**

- It may say nothing backs a claim. Invariant 4 requires that answer be
  reachable.
- It may say a moment is hedging, because that is a measurement over hedge
  words, and it may say so with the words it counted.
- It may **not** rank your footage by quality, score a source, or tell you a
  video was a waste of time. The judgement in this product belongs to rules the
  person can see and switch off, and to the person.

And the check underneath, which is this engine's `verifyQuote`: **no aggregate
without its members.** Every count, band and summary resolves to moments with
word-id spans. A number that cannot be expanded is not shippable.

## 6. Cost

- Steps 1–3 are built and already paid for by the sweep.
- Step 4 is one model call per thread, on change only. A library of 1,500
  moments clusters into tens of threads, not hundreds.
- Steps 5–7 are counting. Free.
- Nothing here is charged to the user: reading is the metered act (invariant 5)
  and this is a reading of what the reading produced.

## 7. Phases and acceptance tests

**v0 — the library knows what it holds.** `used_count` and which cut; the
standing report over claims that already exist; the Footage paragraph.
- *Accept:* a library with no cuts reports every claim as "nothing backs this"
  rather than reporting nothing. Every band on the board expands to moments
  whose word-id spans resolve. No percentage renders anywhere. A moment used in
  two cuts counts two, and deleting a cut puts it back.

**v1 — the library knows what it is about.** Thread summaries; the lexicon;
the subject filter; Scout's vocabulary fed from it.
- *Accept:* a thread whose summary call fails renders with its tf-idf name and
  no summary, and the page does not break. No summary contains a genre word
  (the `register` gate rule, extended to this call). `expandQueries` receives a
  non-empty vocabulary on a library that has one, and the Scout eval's recall
  moves — or the lexicon is not earning its keep and this says so.

**v2 — the reading pass speaks.** The read's own report: moments, subjects it
joined, missions it answered, and whether this is the first footage on a
subject.
- *Accept:* a read of footage on a brand-new subject says so. A read that
  answers a mission says which. A read of unrelated footage says neither, and
  says something true instead.

**v3 — the other characters** (not this engine, listed so the seams are
visible). **The Eye:** shot boundaries and a description per shot, so "footage
of a rocket launching" is a query — currently impossible, because nothing in
this product looks at a pixel for meaning. **The Cutter:** `FORMATS.md`'s
Pattern spine — *"variation escalates; one closing instance reframes"* — as a
template plus a solver over candidates, which `PASS-4-BRIEF.md` says nothing
computes. Both need the Librarian's subject axis first: the Cutter cannot
choose eight clips about one subject until something knows which clips are
about it.

## 8. The rule that applies to every character after this one

**A bot proposes; it never edits.** It hands back a rule, a revision or a
mission, and a price. The person decides and the solver places.

This is already decided and already built once. `docs/decisions/claude-skill.md`
concluded that *an agent that should change a cut should propose a RULE, the
way the product does*; `src/revise.ts` is a Scout find proposing a better claim
*with the cost of changing your mind*. That is engine-to-engine disagreement,
modelled, with the human holding the decision. Every character added after this
one lands in the same shape or it is not this product.
