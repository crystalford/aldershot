# 20 — Design brief: what the build learned, and what the next version has to answer

The handoff in `docs/handoff/` runs design → build. This one runs the other
way. It is written for whoever opens `design/one-take/` next.

**The gap, measured.** `design/one-take/` landed on 17 Oct 2026 in a single
commit and has not been touched since; the only other commit anywhere under
`design/` is from August. There have been **156 commits** on the build since
that day, **84** of them on user-facing surfaces. The build now carries **179
strings that no design draws**, grouped into **103 reasons**, each one written
down at the moment it was signed off — they are the `SIGNED_OFF` map in
`scripts/check-fidelity.cjs`, and that map is the real inventory behind the
summary below. Nothing here is a complaint about the design; most of it is
surfaces and states the design was never asked for.

**How this sits with the precedence rules.** `CLAUDE.md` puts the rendered
prototype first, and that stands. This document is the list of places where
there is nothing to render, plus three arguments about what the next version
should *be*. Where it asks to overrule the prototype — the landing copy — it
says so and asks for a decision rather than assuming one.

---

## Part one: three threads to tie

### 1. The site sells the half that is becoming free

The pitch is "the timeline is gone / editing is reading now", plus the shorts
half. As of this month, a model driving ffmpeg does competent assembly for
nothing, and the tooling that does it says in its own documentation that the
planning is somebody else's job.

What it cannot do is say where a clip came from, which rule put it there, what
was left out, and hand a stranger a page that proves it. That half is built,
gated, and now machine-readable:

- `/r/:token` — the receipts page a viewer reads, published by an explicit
  press and revocable.
- `/r/:token.json` — the same receipt as data. One builder, two renderings, so
  the data cannot carry a field the page does not show.
- `/.well-known/aldershot.json` — all ten invariants published as refusals,
  each one gated against the check or test that enforces it.

The site mentions provenance **once**, inside an FAQ answer about exporting.

**The ask.** Lead with the evidence. Two concrete moves:

- A hero that links to a *real* receipts page beats a screenshot of an editor.
  The artifact exists and is public by token; the strongest demo on the site is
  a page a stranger can interrogate.
- **"What this will not do" is the most differentiated page the site could
  have**, and it is already true, already published, and already gated. Ten
  refusals, each with the reason. No competitor's site has that page because
  no competitor could keep it honest.

### 2. Scout is central in the Manual and marginal in the design

The Manual puts it in the second paragraph of what the product is:

> Scout is how the video gets better than your footage alone: he finds what
> it's missing — the proof, the other side, the original a clip came from — and
> links it.

`design/one-take/Scout.dc.html` is 9.8 KB, the smallest of the five design
files, and draws one screen. The build has all of Scout: expansion into four
query families per beat, triage before reading, windowed scanning, word-for-word
verification, ranked reduction the model may not touch, snowballing, three
budgets, nine tables, missions, attribution chains, and the board.

The board is specified in `18-SCOUT-BUILD-SPEC.md` by what it must **show**,
not by what it must **say** — so the build wrote every word on it, and seven of
them are in the sign-off list.

**The ask.** Decide whether Scout is a room or a side trip, and draw it that
way. Today it is reached from inside a project, which makes it a side trip; the
Manual describes a room.

### 3. The plan flow grew three objects the design has never seen

These are the most novel things in the product, and nothing else in the
category has an object for any of them.

- **An angle** — one video that could be made from a seed. The system drafts a
  slate of three that must differ in what they *argue*, not in wording, and
  prices each by how much of it your library already holds. Bands, never
  numbers: Strong / Worth a look / Long shot, each carrying the line that
  caused it. The model proposes; it is never allowed to say what is backed.
- **A revision** — a verified Scout find can propose a better claim than the
  one the plan was written with, naming the evidence that moved it and the cost
  of changing your mind. The cost leads with recorded takes, because a cut
  re-produces from rules and a performance does not.
- **The priced beat** — what a plan would cost to build before anything is
  built.

Today all three live as two small controls on the plan page: *"Other ways to
build this"* and *"Does this change the claim?"*

**The ask.** This is the construction story — the part of the product that does
something no other editor does. It is currently a disclosure triangle. Give it
room, and decide what choosing between three possible videos actually looks
like.

---

## Part two: the systematic gap — a prototype always has data

This is the largest class in the sign-off list and the one that has cost real
defects.

The prototype draws every surface populated. So there is no wording for: an
empty library; a cut with no videos attached; a cut narrowed to one video; a
bin with nothing in it; a video nothing has been cut from; a read that failed;
a plan whose beats are thin; a board with no run yet; a month with no spend; a
library with footage but no projects.

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
exist. The build has already written all of them and they read well; the
decision is whether to adopt them or replace them.

---

## Part three: surfaces that exist and nothing draws

Grouped from the sign-off list. Each is real, reachable and crawled.

| Surface | Note |
|---|---|
| **Signing in** | **No design at all.** Every control in both landing designs opens the prototype app directly — no account, no link in an inbox, no OAuth. Six strings that nothing had ever checked, because the crawl's dev server is always signed in. |
| Footage → Documents | A tab the prototype does not have. A PDF or photograph can stand as the proof on a line that claims it. |
| Footage → Find | Also not in the prototype. Its second string is a refusal: reading captions from a link is not switched on. |
| The Scout board | Specified by what it shows, not what it says. |
| The receipts admin page | The only control in the product that puts something on the public web. One Take has the link and nothing behind it. |
| The take list | "Every take is kept" — invariant 6. The prototype's recorder is a full-screen stage and says this in one sentence; the build had to invent the list. |
| The command bar | Replaced two text boxes and nine example chips stacked under a video taking 62vh, which put the two most powerful things in the product below the fold. |
| Before you post | The prototype draws an overlay pressed open from Export; the build serves a page, so it needs a way back the prototype has no picture for. |
| Exports | Two headings now — cuts and shorts — because scrapping Clipping would otherwise have left every short unreachable and still paying for storage. |
| The bin, in Settings | Delete is soft here. The prototype has no bin because nothing in it can be deleted. |
| The owner's cost panel | Including the line for spend that bought nothing, which only renders for one account in the world and only in a bad month. |
| NOT SHORTS | Lines measured out of the shortlist, with the measurement that did it and a press to force one in. |
| Export's sound choice | "As recorded / Clean it up". The container has had the full chain since it was written and nothing ever called it. |
| `/eval` | **Do not draw this.** A tool for the people making the labelled set, not part of the product anybody buys. |

---

## Part four: where the build's words are better

The sign-off list records this in its own voice, about the landing page:

> Landing copy that already differed from `design/Landing.dc.html` before this
> check could see the page. Recorded as it stands rather than reverted — it
> reads better than the prototype's and is what the site has been serving.

Precedence says the prototype wins. Here the build should, and it needs a
decision so the next design version does not quietly revert copy that is
already live and better. Seven strings, listed in the map.

---

## Part five: decisions only the design can make

1. **The genre word.** Someone types *"make me a video essay about NASA"*. The
   system now strips "video essay", keeps it as a format setting, and the
   writer never sees it — invariant 10, enforced by `src/register.ts` and the
   `register` gate rule. **The person is told nothing.** Three options: say
   nothing; a quiet format chip; or surface it in the rules column as a rule
   they can switch off. The third is most in keeping with "rules are the source
   of truth and you can switch them off", and nothing draws it.

2. **The machine-readable receipt.** `/r/:token.json` exists and the receipts
   admin page does not mention it. A link, a copy button, or invisible?

3. **Frames on rows.** The prototype's video and moment rows carry thumbnails.
   Per-moment frames do not exist server-side — `frame_r2_key` is the *source's*
   poster or empty — so both grids paint them client-side by seeking a hidden
   video onto a canvas. Either the design accepts a canvas-drawn frame as the
   real thing, or the product owes genuine per-moment extraction.

4. **Before you post:** overlay, as drawn, or page, as built.

5. **Seven things the design or the site offers and the build does not have.**
   Recipes (a rule set that starts next week's video), Stories and Supercuts as
   project kinds, the overnight queue, storage add-ons, webhook handoff, the
   hero's "Open the sample cut", and the nav's fourth item — the Manual, behind
   "Read how it works". Each needs either a build or removal from the design.
   `12-DEFERRED.md` carries the reason and the cost for every one.

---

## What not to redraw

- `/eval`, per above.
- Anything in the retired design. The One Take prototype replaced it.
- The directions tabled in `12-DEFERRED.md` under "Tabled — not the direction".

## Two things the Manual promises that are neither built nor drawn

Both are in the second paragraph of what the Manual says the product is, and
`CLAUDE.md` already flags that the handoff does not weight them the same way:

- **The conversation that answers questions about your footage with timed
  lines.** `POST /api/ask` exists and returns exactly that shape — a pointed-at
  sentence per moment, with its time and the judge's reason, and a refusal to
  answer from the most-recent fallback. There is no conversation around it.
- **Scout as central**, per thread 2 above.

---

*Written 15 Nov 2026, against `796ec78`. The build at that commit: 18 fidelity
rules, 1,935 tests, strict gate green including the container, and CI green on
the last five commits.*
