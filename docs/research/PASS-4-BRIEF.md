# Pass 4 — the brief, and what it is not

Written 17 Oct 2026 after reading passes 1–3 and all eleven distillations in
`docs/labs/`. Nothing here is research. It is the question Pass 4 should ask,
and the reasons for narrowing it.

## The scenario it has to answer

> A thousand DSP clips are uploaded. "Make a documentary about his insane
> begging."

Pick this apart and it is not one problem. It is four, and three of them have
no mechanism anywhere in the research.

## What Pass 4 is NOT about

**It is not Scout.** Scout is *material you do not have*: find, link, verify,
mission. This is *material you do have* — a thousand clips already in the
library. The two share a retrieval stack and nothing else.

That distinction has already been lost once. `labs/DOSSIER.md` is the research
on compounding memory over a subject's corpus: threads that grow, living
timelines, a scoped contradiction engine, coverage and gap maps, incremental
per-entity summaries with receipts. Every one of those works on *any* corpus of
moments. It was written as pass 11 **about Scout's external finds**, and it is
filed under Scout, so the machinery for the thousand-clip case reads as though
it were about somebody else's YouTube.

**It is not pre-production as a phase.** `labs/Directed plan.dc.html` already
prototypes the pre-production shape — footage plus a brief, eleven blocks, what
is said beside which moment backs it. The shape is not missing. What is missing
is an engine, and what is untested is whether an eleven-block shape survives at
two hundred.

**It is not a retrieval pass.** `labs/FOOTAGE-SYSTEM.md` is thorough and the
numbers are measured: two moment sizes, words-first hybrid fused by rank,
reranking, a judge with a calibrated threshold, abstention engineered rather
than asked for. That whole system answers **one shape of question — "what backs
this claim?"** Pass 4's questions all run the other way.

## The sharpest finding from reading the existing research

`labs/FORMATS.md` already specifies the DSP documentary. It is a **Pattern**
spine:

> **Pattern** · repeated instance · *the repetition makes the point; variation
> escalates; one closing instance reframes* · supercut, montage, data story

Those are three properties of a **selection and an order over a corpus**. The
repo has no mechanism for any of them and the research has no evidence about
any of them. The rule engine orders by rule precedence. Retrieval orders by
relevance. Neither orders by *variation escalates*, and relevance ranking
actively fights it: the top eight hits for one behaviour are eight versions of
the most typical instance, which is the one thing a supercut must not be.

So the clearest statement of the gap is already in our own research, written as
a requirement with nothing under it.

Related: the product has been judged against **one long source** (`Footage
sets.dc.html`: three vlogs, a committee meeting, a three-hour stream, a
lecture) and against **a handful of sources** (`Directed plan.dc.html`: three
streams five years apart). It has never been judged against **a large corpus of
short clips about one subject**, which is the Pattern case and the case the
front door advertises as "Story · Supercut, as the archive grows".

## The four questions

### Q1 · Given two hundred instances of one behaviour, which eight, in what order?

The Pattern spine's three requirements, as computations.

- Diversity-aware subset selection — MMR, facility location, determinantal
  point processes — against the honest baseline: a person picking from a
  ranked list. Does any of it beat the baseline enough to pay for?
- What does *variation* mean measurably: lexical, prosodic, situational,
  escalating stakes? Is there a usable intensity signal in audio (level,
  pitch range, speech rate) that is not a score reaching a user (invariant 3)?
- *One closing instance reframes* — is there any evidence about choosing a
  closer, or is that irreducibly the user's call? If it is the user's call,
  the product should ask rather than guess.
- The failure to characterise: a competent-looking twenty minutes that misses
  the three best moments in the library, because no beat asked for them.

### Q2 · What replaces "the archive summary, one paragraph" at a thousand clips?

`13-DECISIONS.md` #3 says Home is footage-first: *the product is the material
plus a sentence*. The entire footage-first machinery today is one paragraph
that travels with every request (`17-STORAGE-AND-NEOLOG.md`), and `plan.ts`
writes the claim and beats having seen only the topic.

- Does unsupervised structure over child embeddings — topic clustering,
  BERTopic-class — beat asking a frontier model over moment cards, at 100,
  1,000 and 10,000 moments? At what cost each? (`DOSSIER.md` has the only
  numbers we own: 100 hours of transcript scanned on a small model ≈ $0.05;
  incremental summaries ≈ $0.30 per entity per month.)
- `DOSSIER.md` already refuses a knowledge graph on cost (GraphRAG ≈ 600×
  hybrid search). Does that refusal still hold for the user's own library,
  where the corpus is bounded and re-read once?
- **Pass 3's lesson, one level up.** Pass 3 was about review cost. A structure
  over a thousand clips that a person cannot check is worthless, and a
  confident one is worse than worthless. What makes a corpus structure
  checkable in five minutes? The Dossier's answer is "every sentence ends in
  moment ids" — does that scale to a structure, or does a structure need a
  different surface?

### Q3 · Near-duplicates inside your own library

Zero coverage: "near-duplicate" appears nowhere in `docs/labs/` or
`docs/research/raw/`. A thousand DSP clips contain the same beg many times —
clipped by six channels, in a compilation and in the original, re-uploaded.

- Cheapest detection that works on ASR text: transcript shingles and MinHash,
  dense embeddings, audio fingerprinting. What accuracy at what cost per
  thousand clips?
- Having found a duplicate set, which instance is *the* instance? Longest,
  cleanest audio, most complete setup, earliest upload? This is a measurable
  choice and nothing has measured it.
- When is a duplicate not redundant — two angles on one moment, or the clipped
  version kept *because* provenance needs both (which is what Scout's
  `original_of` already models for external material)?

### Q4 · The script as the editable middle

`labs/SCRIPT-AND-TIMING.md` is about **timing a read that already exists** —
alignment at 20 ms, breath groups, re-timing, the teleprompter. Its writing
half is a short list of rules and its voice half is explicitly tabled. Nothing
is about **writing** a read from secured footage. `essay.ts` tried it and the
plan flow replaced it on purpose.

- `labs/PICTURES.md` settles the order: *narration written last over secured
  pictures.* So the script step comes AFTER selection, not before — which
  means the thing the owner called "the scripting phase" sits between Q1 and
  the cut, not before the plan. Confirm or overturn that.
- What is known about long-form structure generated from retrieved material,
  at forty minutes rather than four? Where does it fail — repetition, lost
  thread, a conclusion that does not follow?
- What is the review surface when a person must check two hundred lines each
  carrying a receipt? Eleven blocks is readable. Two hundred is a document,
  and `Directed plan.dc.html` has not been tested at that length.

## And one question that is mine rather than the literature's

A Pattern supercut of one named living person's behaviour, assembled at scale
from other people's clips, is **the highest-risk thing this product can make.**

`DOSSIER.md` already holds the line for one case: *"a false 'he contradicted
himself' is a defamation-grade error. A human confirms every one. Nothing
enters a script unconfirmed."* That is tractable at twenty pairs. The same
obligation at two hundred selected instances is not obviously tractable at all,
and the product's entire claim is receipts.

So Pass 4 should ask what the review obligation **is** at that scale, and
whether there is a defensible answer other than "the user confirms every one" —
because if there is not, the honest design is a cap on how much a Pattern cut
may assert without being read line by line, and that cap belongs in the product
rather than in a disclaimer.

## What is not research, and should just be decided

**Point the Dossier at the user's own library, not only at Scout's finds.**

Threads as saved queries that auto-file, living timelines as moments by date,
scoped contradiction runs, coverage and gap maps, incremental summaries with
receipts — all of it operates on a corpus of moments, and a thousand uploaded
clips are a corpus of moments. `DOSSIER.md`'s own feature table already has
*"Ingest your own research — v1 — PDFs and notes chunked into the same moment
table with provenance `yours-doc`"*, so the generalisation is half-written.

This costs nothing to decide, it is most of what the thousand-clip case needs,
and it does not wait for Pass 4.
