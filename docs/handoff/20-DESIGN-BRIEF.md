# 20 — Design brief: what this is, and what the next version has to answer

The handoff in `docs/handoff/` runs design → build. This one runs the other
way. It is written for whoever opens `design/one-take/` next.

**The gap, measured.** `design/one-take/` landed on 17 Oct 2026 in a single
commit and has not been touched since; the only other commit anywhere under
`design/` is from August. There have been **156 commits** on the build since
that day, **84** of them on user-facing surfaces. The build now carries **221
strings that no design draws**, each one signed off with the reason at the
moment it was written — they are the `SIGNED_OFF` map in
`scripts/check-fidelity.cjs`, and that map is the real inventory behind Part
Three below.

**How this sits with the precedence rules.** `CLAUDE.md` puts the rendered
prototype first, and that stands. Part One is an argument about what the
product *is*; Parts Two to Five are the places where there is nothing to
render. Where this asks to overrule the prototype — the landing copy — it says
so and asks for a decision rather than assuming one.

---

## Part one: a session, not a screen

The product is a room with a text box. You type a sentence, something happens,
you adjust. That is the right shape — but it is one turn long, and the thing
the owner is reaching for is the shape of an agentic coding session: you say
what you want, loosely, by voice; the system goes and does a lot of work; you
watch it happen; you cut in and redirect; and the artifact that accumulates is
not the conversation.

**That analogy is more literal than it sounds, because the substrate already
chose it.**

- Invariant 1: a cut is never stored, it is re-derived from rules and moments
  every time. That is not a metaphor for compilation, it is compilation. Rules
  are the source code of the video.
- Invariant 5: footage is read and charged once, and editing is free.

Together those are what make an iterative loop affordable at all. And they
carry a constraint with them: **you can only iterate in the rules-and-outline
layer, never in renders.** A render costs minutes and money; a rule costs
nothing. So the layer where the loop lives has to be the main surface.

Today it is the other way round. **The plan is a vestibule** — it asks once
whether the beats are right, hands you to the editor, and you never go back.
The one inversion this document is really asking for is: **the plan should be
the room, and the cut a view of it.**

### Why that matters now rather than later

Selection quality is a function of the *pool* of relevant material. The pool
only grows with time spent accumulating — Scout runs, recordings, documents —
so a tool that delivers in ninety seconds has a ceiling no model cleverness
lifts. Every competitor optimises for that ninety seconds because it is the
demo. The honest promise is the opposite, *this will be better in a week*, and
it is a bad demo and a good product. Nothing else in the category can say it,
because nothing else is accumulating a pool per argument and keeping a receipt
for every choice.

### The parts that do work have nowhere to speak

This is one problem, not four, and it is the clearest thing the design can fix:

- **The reading pass says nothing.** Transcription reports a percentage. It has
  just read everything somebody said for an hour and tells them nothing about
  it — not "there are four places you talk about the rent", not "at 3:12 you
  contradict what you said at 0:40". The judge, retrieval and the library all
  exist. The surface is a progress bar.
- **The conversation the Manual promises is built, and this document was
  wrong about it.** ~~Nothing calls it.~~ `POST /api/ask` returns exactly its
  shape — per moment, the sentence being pointed at, its timestamp, and the
  reason — and it *refuses* to answer from the most-recent fallback, because
  "here is your recent stuff" dressed as an answer is the lie that feature
  could most easily tell. It **is** reachable: there is an Ask button in the
  composer (`src/ui/pages/home.ts:259`) wired to it in `src/ui/client.ts`.
  Corrected 20 Nov 2026. What is true is the thing underneath: until this week
  the library was only populated as a side-effect of asking for a cut, so a
  question about your own footage would usually have found nothing to answer
  with. The surface was there and the corpus was not.
- **Scout is central in the Manual and marginal in the design.** The Manual:
  *"Scout is how the video gets better than your footage alone."*
  `Scout.dc.html` is 9.8 KB, the smallest of the five files, and draws one
  screen. The build has expansion into four query families per beat, triage,
  windowed scanning, word-for-word verification, ranked reduction the model may
  not touch, snowballing, three budgets, nine tables, missions and attribution
  chains. The board is specified by what it must **show**, never what it must
  **say**, so the build wrote every word on it.
- **The plan's three new objects are a disclosure triangle.** An *angle* (one
  video that could be made from a seed, with a slate of three that must differ
  in what they **argue**, each priced by how much of it your library already
  holds — bands, never numbers). A *revision* (a verified find proposing a
  better claim, with the cost of changing your mind, which leads with recorded
  takes because a cut re-produces from rules and a performance does not). A
  *priced beat*. Nothing else in the category has an object for "a video that
  could be made". All three live behind *"Other ways to build this"* and
  *"Does this change the claim?"*

### The stub is the object, and the first one now exists

What makes a code project growable is that you can declare a module that says
what it needs and admits it is empty. You scaffold the whole shape before you
have any content, and the empty ones *are* the worklist.

That is what the owner described wanting — *"we definitely need a section on
the first Mars mission and orbital mechanics, and here's my argument for it"* —
and as of this week the engine does it:

- `POST /api/plans/:id/beats` — declare a section in your own words, into a
  plan that already exists. The `need` is stored exactly as typed, because it
  **is** the retrieval query.
- `plan_beats.by_user` — whose sentence it is, so a re-draft cannot overwrite
  it and `DecomposeInput.existing` can keep its documented promise.
- `POST /api/plans/:id/find` with a `beatId` — fill one section without
  re-paying for the rest, which is what makes a plan returnable.
- `needAdvice` — the on-camera stoplist as **advice, never a veto**: a model's
  beat naming a motive is regenerated or dropped; a person's stands, and they
  are told what it will cost.

**The surface for it is deliberately plain and is a probe, not a proposal.** A
form at the end of the beat list, a YOURS mark, a per-section press, the advice
on the row. It exists so the loop can be driven and judged. How the outline
should actually look — and how deep it nests — is the design's call, and the
questions it raises are in Part Five.

---

## Part two: the systematic gap — a prototype always has data

The largest class in the sign-off list, and the one that has cost real defects.

The prototype draws every surface populated. So there is no wording for: an
empty library; a cut with no videos attached; a cut narrowed to one video; a
bin with nothing in it; a video nothing has been cut from; a read that failed;
a plan whose beats are thin; a board with no run; a month with no spend; a
declared section that found nothing.

Two of those were not merely undrawn — they were **unrendered by any check on
any machine**:

- `"Nothing cut from this yet."` on the source page was rendered for the first
  time by accident, in CI, when a fixture grew a second video.
- `"not in this cut"` in the editor's add-footage row shipped as a paraphrase
  and had never been rendered by anything. It needs an unattached video on the
  moments tab; CI's fixture attaches everything it creates, and the serverless
  page list set `addable: []`. It was found only because a local database had
  drifted across sessions — which is luck, not a gate. It is now the
  prototype's own "Add footage", with a fixture that renders it.

**The ask is not forty more screens.** It is one stated convention for the four
states — empty, partial, failed, narrowed — plus wording for the dozen that
exist. The build has written all of them and they read well; the decision is
whether to adopt them or replace them.

---

## Part three: surfaces that exist and nothing draws

| Surface | Note |
|---|---|
| **Signing in** | **No design at all.** Every control in both landing designs opens the prototype app directly — no account, no link in an inbox, no OAuth. Six strings nothing had ever checked, because the crawl's dev server is always signed in. |
| Footage → Documents | A tab the prototype does not have. A PDF or photograph can stand as the proof on a line that claims it. |
| Footage → Find | Also absent. Its second string is a refusal: reading captions from a link is not switched on. |
| The Scout board | Specified by what it shows, not what it says. |
| The receipts admin page | The only control in the product that puts something on the public web. |
| The take list | "Every take is kept" — invariant 6. The prototype's recorder is a full-screen stage and says this in one sentence. |
| The command bar | Replaced two text boxes and nine chips stacked under a video taking 62vh, which put the two most powerful things in the product below the fold. |
| Before you post | Drawn as an overlay, built as a page, so it needs a way back the prototype has no picture for. |
| Exports | Two headings now — cuts and shorts. |
| The bin, in Settings | Delete is soft here; the prototype has no bin because nothing in it can be deleted. |
| The owner's cost panel | Including the line for spend that bought nothing, which renders for one account in the world and only in a bad month. |
| Declaring a section | New this week, per Part One. A form, a YOURS mark, a per-section press, and the advice line. |
| `/eval` | **Do not draw this.** A tool for the people making the labelled set, not part of the product anybody buys. |

---

## Part four: where the build's words are better

The sign-off list records this in its own voice, about the landing page:

> Landing copy that already differed from `design/Landing.dc.html` before this
> check could see the page. Recorded as it stands rather than reverted — it
> reads better than the prototype's and is what the site has been serving.

Precedence says the prototype wins. Here the build should, and it needs a
decision so the next design version does not quietly revert copy that is
already live and better.

---

## Part five: decisions only the design can make

1. **Is the plan the room?** Part One's one real ask. If yes, nearly everything
   else here follows from it; if no, the growth loop needs somewhere else to
   live and that somewhere has to be drawn.

2. **What does choosing between three possible videos look like?** Angles are
   the most novel object in the product and currently a disclosure triangle.

3. **Does a declared section look different from a drafted one?** The build
   marks it YOURS, which is a guess. The two are not the same kind of thing — a
   draft is a suggestion and yours is a decision — and nothing else on the row
   says so.

4. **What does a section that found nothing look like?** It is the worklist, so
   it is arguably the most important state in the whole flow, and the build
   currently renders it as an absence.

5. **The genre word.** Somebody types *"make me a video essay about NASA"*. The
   system strips "video essay", keeps it as a format setting, and the writer
   never sees it (invariant 10, enforced by `src/register.ts` and the `register`
   gate rule). **The person is told nothing.** Say nothing; a quiet format chip;
   or surface it in the rules column as a rule they can switch off — the third
   is most in keeping with rules being the source of truth, and nothing draws
   any of them.

6. **The machine-readable receipt.** `/r/:token.json` exists and the receipts
   admin page does not mention it. A link, a copy button, or invisible?

7. **Frames on rows.** Per-moment frames do not exist server-side —
   `frame_r2_key` is the *source's* poster or empty — so both grids paint them
   client-side by seeking a hidden video onto a canvas. Either the design
   accepts a canvas-drawn frame as the real thing, or the product owes genuine
   per-moment extraction.

8. **Before you post:** overlay, as drawn, or page, as built.

9. **Seven things the design or the site offers and the build does not have.**
   Recipes, Stories and Supercuts as project kinds, the overnight queue, storage
   add-ons, webhook handoff, the hero's "Open the sample cut", and the nav's
   fourth item — the Manual, behind "Read how it works". Each needs a build or
   removal from the design. `12-DEFERRED.md` carries the reason and the cost.

---

## What not to redraw

- `/eval`, per above.
- Anything in the retired design; the One Take prototype replaced it.
- The directions tabled in `12-DEFERRED.md` under "Tabled — not the direction".

## One correction, and one thing still absent

**Scout cannot be pointed at a single beat.** An earlier reading of this repo
said it could; that was wrong. `beatId` at `src/scout-run.ts:317` is part of a
*cache key* — a scan is keyed by source × window × beat because the spec
forbids one combined question — not a scope. There is no per-beat entry point:
not a route, not a field on `ScoutJob`.

**And joining Scout to a declared section is a shape decision, not wiring.**
Scout runs against a `projectId`; a plan exists before any project.
`src/plan.ts:246` already says so in its own words. Making somebody's declared
sections Scout's brief means either running Scout before a project exists or
creating the project earlier — which is Part Five question 1 wearing a
different hat. `scout_beats.plan_beat_id` and `DecomposeInput.existing` are the
two stubs waiting for the answer.

---

*Written 15 Nov 2026, against `f67bc43`. The build at that commit: 18 fidelity
rules, 1,944 tests, strict gate green including the container.*

*Amended 20 Nov 2026. Four things this document asks for have since landed and
one claim in it was wrong. A read now fills the library (`src/moments.ts`), so
the accumulating pool is real rather than a side-effect of asking for a cut; a
plan's beat order survives into the cut, which it did not; match-back runs, so
a mission can be answered; and an imported source can be read. The wrong claim
is marked above. The engine-shaped half of Part Five now has its own document:
`21-LIBRARIAN-BUILD-SPEC.md`.*
