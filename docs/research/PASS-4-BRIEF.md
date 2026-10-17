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

---

# Part two — composition: how the sources build one video

Added after the owner's second question, which was the better one: *how does
the system suggest a full video essay, and build it from five of your clips,
ten of Scout's, and voice-over over B-roll — over many passes, like an
accumulation?*

## What is already answered, so the pass does not redo it

**The block level is specified and prototyped.** `04-RULE-ENGINE.md` already
says the model directs "which moments back which point, the order, **each
beat's visual job**, where the turn lands — as a typed directive with bounded
settings", and the production solver includes "an integer solver for B-roll
assignment". `labs/Essay to video.dc.html` carries that as a **director
layer**: a sound role per beat (Voice over · Exhibit · Document · Card) and a
**source per beat (shot new · archive · scout · generated)**.

So *"five from the archive, ten from Scout, voice-over over B-roll"* is already
the data model. Roles and provenance per block exist, by hand, in a labs board.
What has no mechanism is everything **upstream and around** it.

## The object that does not exist: an angle

The word appears in this repo exactly three places, all in `docs/design/`,
which is marked **superseded** — the retired "cinematic media company" vision
with its Feed/Radar ideation surface. So *angles* were not argued away when the
product changed shape. They fell out, and the owner has reinvented them from
the other end.

Today's flow is a one-way funnel: a claim, then beats, then footage per beat,
then a cut. There is no representation of **a video that could be made** — and
therefore no way to have several, compare them, or rank them.

### Q5 · Can a corpus propose angles a person recognises as good?

- Against the honest baseline, which is strong: the user says what they want in
  a sentence, which is the whole premise of the front door. A slate of five
  proposed angles has to beat *that*, not beat nothing.
- Is there evidence that choosing between framings produces better work, or
  only slower work? Editorial and newsroom practice on pitch slates, if the
  literature exists; decision research on choice sets if it does not.
- What does an angle have to carry to be judgeable in thirty seconds? A claim,
  what already backs it, what is missing, and what it would cost — see Q7.
- Invariant 3 bites here hardest. Ranked angles must not become scored angles,
  and "87% confident" about an argument is worse than useless.

## The instinct that is right: a loop, not a funnel

The owner's word was *accumulation*, and it is the correct diagnosis. **A
verified Scout find can make a better angle visible than any that existed when
the plan was written** — and nothing in the architecture can act on that. Scout
fills a plan's gaps; it cannot change the plan's mind.

### Q6 · What is known about research-then-write loops that revise the thesis?

- Agentic research loops are well covered for *answering a fixed question*.
  This is the other thing: the question itself is provisional, and round three's
  evidence should be able to overturn round one's claim.
- When does it stop improving? Scout's stopping rule is the precedent and may
  transfer directly — the knee of distinct-finds against queries issued, with
  coverage, bounded by budget. Does the same curve describe *angle* quality?
- **The expensive question: when the thesis changes, what happens to the work
  already done?** Invariant 1 covers the cut — rules are the source of truth,
  so a cut re-produces. It does not cover a *script*. Two hundred written lines
  are not re-produced by anything, and a thesis change mid-way either throws
  them out or quietly leaves a video arguing the old claim in the new order.
  This is the sharpest unanswered question in the whole brief.
- A corollary worth testing: is the right design to **write last, always** —
  `PICTURES.md` already says "narration written last over secured pictures" —
  and if so, the loop runs on beats and evidence only, and the script is a
  terminal step that is never revised, only regenerated. That is a cheap answer
  if it holds.

## The constraint nobody has priced: mixed provenance

Five own clips and ten Scout clips are not fifteen clips. Own footage cuts
immediately. **A Scout moment is a ghost until a mission completes** — the user
has to go and get it. So an angle leaning on Scout is slower, needs the user's
hands, and may never complete at all.

### Q7 · How should an angle's cost and buildability be shown?

- Nothing currently ranks a plan by what it would *take*. An angle that is
  ninety per cent your own archive and one that is ninety per cent ghosts are
  presented identically and are weeks apart.
- The honest unit is not money. It is: how many missions, how much of it is
  already playable, how much is a link you cannot cut, how much needs
  transcribing.
- **This half is a design decision rather than a research question, and I would
  make it now:** an angle shows what it would take beside what it would say, or
  the slate is a menu with no prices.

## The one writing job the research has refused

`SCRIPT-AND-TIMING.md` is the timing master and says so; its writing half is a
short list of rules and its voice half is explicitly tabled. `PICTURES.md`
settles the order — narration last, over secured pictures. Nobody has written
down how the words get made.

### Q8 · Writing to a picture that is already chosen, and to a duration

- This is the reverse of every captioning and description benchmark, which
  generate words *about* an image. Here the picture, its job, and roughly its
  length are fixed first, and the words have to fit.
- Duration-constrained generation: what actually works? Our own measured
  constraint is in hand — use the user's words per minute from their footage,
  never a synthetic voice's pace (the one controlled comparison: ~153 wpm human
  against ~185 synthetic).
- `PICTURES.md`'s rules are the hard part: propositional redundancy by default,
  lexical redundancy banned, counterpoint budgeted, and the fit-anywhere check.
  Can a model write to those, or does it need the fit-anywhere check as a
  rejecting gate the way decompose needed its stoplist?
- And the register finding from `SCRIPT-AND-TIMING.md`: one line is one breath
  group, four to seven words, one new idea each. That is a tight generation
  target and a testable one.

## Choosing the next cases properly

The owner is right that DSP is the case to start with — dense clips, abundant
external material, an obvious Pattern spine. He is also right to want others.
The useful move is not *more examples* but **axes**, so case two is unlike case
one in ways that teach something. `labs/Footage sets.dc.html` already used this
method: "four footage sets chosen to be unlike each other".

| Axis | DSP sits at |
|---|---|
| Library density | a thousand clips of one subject |
| Who the subject is | a third party |
| Where the evidence lives | own archive **and** heavy Scout |
| Spine (`FORMATS.md`) | Pattern |
| Legal exposure | high — a named living person's conduct |
| Does a thesis exist first? | no — footage-first |

So case two should be the opposite corner on every axis: **thin library,
first-person subject, own archive only, Argument spine, low exposure,
brief-first.** Something like *"a video essay about why I left my job"* — three
vlogs and a folder of documents. Between those two the product is bracketed,
and a third case can then be chosen to break whichever axis turned out to
matter most.

What DSP will **not** teach, and so must not be generalised from: the
thin-library case where Scout is the only supply; a multi-subject argument,
where "the entity" stops being one person and the Dossier's per-entity
summaries stop fitting; and the case where the user is the subject, which
removes the legal problem and replaces it with a taste problem.
