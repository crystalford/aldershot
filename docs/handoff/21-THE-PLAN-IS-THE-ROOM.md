# 21 — The plan is the room: the design's answer to doc 20

Doc 20 ran build → design and asked nine questions. This runs back the other
way. It describes a working prototype, drawn in the design canvas in November
2026, of the product as doc 20 Part One describes it: **a session, not a
screen; the plan is the room and the cut is a view of it.** The pages are
copied into `design/next/` so they can be rendered (precedence rule 1 in
`CLAUDE.md`), and the canvas artifact stays the live original.

The sample is one film, end to end: a 20-minute video essay, *NASA as a
medium*, whose argument is **"NASA didn't borrow science fiction's look. It
paid for it."** There is one room, and everything in it is a view of that
one film.

---

## Part one: the shape, in one paragraph

You say what the film is. Aldershot lays it out as a **plan** — acts,
sections, and a **two-column script** (picture on the left, sound on the
right) — and the plan **plays from the first minute** as a rough film, every
gap a ghost with its own look. The crew fills it one small thing at a time:
**Scout** finds what's missing, **Sketch** draws what can be drawn, you record
your lines. You watch it sharpen, talk over it, and every note lands at the
moment you said it. Then you finish it — the detailed edit (the One Take
Editor), a trailer, or a **Drawn** cut made entirely of motion graphics.

That loop is the substrate doc 20 described: rules are the source code of the
video, a cut is compiled, and editing is free — so the loop lives in the plan,
never in renders.

## Part two: one room (`design/next/Studio.dc.html`)

The first draw of this doc had five tabs — Studio, Plan, Footage, Trailer,
Editor. The owner's verdict on it: five screens that felt like five apps, and
the condensed strips under the player were **a timeline in disguise** — the
thing the product exists to remove. Both were right. The answer is One Take's
room, holding the whole film:

| Where | What it holds |
|---|---|
| **Left** — the conversation | Aldershot and the crew, as in One Take. "While you were away" first, then one proposal at a time with its length cost and a *(Recommended)* button; three suggestions; a composer with *Talk*. Anything you say that isn't a request is pinned as a note at the playhead |
| **Middle** — the film, top to bottom | One task card (the one thing waiting on you), then acts → section cards. **The vertical scroll is the timeline.** A card opens in place into its blocks, each with exactly one action (Record, Check it, Approve, Check figures, Paste a link) |
| **Right** — NOW | The block playing, drawn as its ghost; what you hear, as words; ‹ ▶ ›; the clock. While it plays, the section playing opens and scrolls into view — the film walks down the page |

Three **lenses** change how the middle reads, never where you are: **Film**
(the cards), **Script** (the whole film as a radio script), **Needs** (every
block grouped by its one action). **Also…** makes things *from* the film — the
Trailer today, Shorts and a Drawn cut later. The project switcher holds the
other kind of project: the vlog opens the One Take Editor
(`design/one-take/Aldershot One Take.dc.html`), unchanged.

**Quiet by default.** A second verdict — "quite cluttered" — set the rule for
what a card may show: its title, three dots (said · shown · proven, green when
done), one word of status, its length. The section's question appears only when
you open it; block rows carry no labels, the colour of their rule says what you
hear. Every removal is detail folded, not lost (Part three, *One thing at a
time*).

**Watch what changed.** The "while you were away" message carries one button:
a 22-second reel of only the blocks the crew touched overnight, played in
order, ending with "the rest of the film is as you left it". It is doc 20 Q9's
"a minute of film showing only what changed", built.

| Other pages in `design/next/` | |
|---|---|
| `Start here` | How it all fits: five steps, who does what, what the colours mean, and the changelog of every turn the design took |
| `Landing` | The story told to a stranger: a live drawn film in the hero, the five steps, the crew, the Drawn finish, what it won't do, pricing |
| `Trailer` | The whole film in 1:22, **Rough** (the ghosts) or **Drawn** (motion graphics only); reached from *Also…* |
| `Plan`, `Footage` | **Previous try** — the same objects as separate tabs. Kept because they draw two things the room doesn't yet (each section's own player; capture progress as distance to a capability) |

All pages read and write **one shared film** (in the prototype, the browser's
local storage under `aldershot.nasa.v1`). Accept a cold open in the room and
the Trailer opens on Mariner 4; reset it from the foot of the conversation. In
the build this is simply the project: one set of rules and moments, one
`compute()`.

## Part three: the objects

### The film, at four zoom levels

```
Film        one argument (the claim), a target length
  Act       3 for 20 minutes; 3–5 for an hour
    Section  = a plan beat at film scale. Has a job: it RAISES a question or ANSWERS one.
      Block  = one row of the two-column script: a picture and a sound, with a duration
```

A **section** is the glossary's *beat* at the size a long film needs (a 20-minute
essay has 8–12 of them, ~2 minutes each; an hour has 15–25). The user-facing
word is *section*. Every section either raises or answers a question — that
is what pulls a viewer through twenty minutes, and it is the one field the
plan cannot do without.

A **block** is the glossary's block, now with two halves:

```ts
type Block = {
  dur: number;                                   // a target, not a timestamp — the solver places (invariant 2)
  picture: { kind: 'you' | 'archive' | 'sketch' | 'found' | 'wanted' | 'card' | 'hold';
             what: string;
             status: 'have' | 'found' | 'wanted' | 'figures' | 'drafted' | 'approved' };
  sound:   { mode: 'vo' | 'sync' | 'breathe' | 'silence';
             text: string;                        // for vo: the line to record; for sync: what they say
             status: 'rec' | 'draft' | 'have' | 'found' | 'wanted' | '' };
};
type Section = { id: string; act: number; title: string;
                 question: { kind: 'raises' | 'answers'; text: string }; blocks: Block[] };
```

`picture.kind` *is* the ghost's type. `wanted` and `found` are ghosts (doc 07);
`sketch` is a graphic (invariant 8, code not pixels); `you` is a voice beat
on camera.

### The sound weave — the spine of a film

The sound column is where a film becomes a film rather than a slideshow with
narration. Four modes, and the rhythm of switching between them is the craft:

| Mode | User-facing words | What it is |
|---|---|---|
| `vo` | **Your voice** (recorded / draft) | You telling it. A draft line is a prompt to record, sized to its slot. |
| `sync` | **In their words** | The source speaks for itself — McLuhan, an engineer, a news anchor. No voice over it. |
| `breathe` | **Breathe** | Music or natural sound under an image, a few seconds where nobody talks. |
| `silence` | **Silence** | On purpose. |

Documentary editors often build the **radio cut** first — the whole story as
sound only — and cover it with pictures afterwards. The plan supports that
directly: the sound column alone is a radio cut.

**The word budget.** Narration runs about 150 words a minute. The film knows
its voiceover seconds, so it knows how many words are left to record ("your
voice: 2:08 recorded of 14:08 · about 1,800 words to go") and each draft line
says how many words its slot holds. This is the honest answer to PASS-4 Q8
(writing to a duration): the duration is set first and the words are sized to
it.

### Ghosts by type, and how finished it looks says how sure it is

Every gap plays, so the film is watchable from the first minute. A ghost's
look says what's missing without reading:

- **archive** — a film frame with grain and sprocket holes
- **found** — a frame marked *preview, not checked*, grainy until checked
- **wanted** — a dashed frame; a news clip is a drawn broadcast frame (LIVE, clock, lower third)
- **you** — a gold outline; your words appear at speaking pace, dimmer while unrecorded
- **sketch** — line art drawing itself
- **card** — serif type

Fidelity is certainty: a drawing means *this is the idea*; grain means *Scout
has a candidate*; the clean picture means *checked and yours*.

### Two finishes: Rough and Drawn

**Rough** shows the ghosts and what's missing. **Drawn** renders the whole film
as motion graphics and your voice — no footage needed. It is a sketch to build
on, and for some videos it is the finished cut (the cheapest honest video
Aldershot can make). Rules for Drawn, from invariant 8:

- Everything is code: orbits, charts, signal paths, number grids, broadcast frames.
- Anything standing in for a real object is labelled on screen as
  **ILLUSTRATION** or **RECREATION**.
- A recreation may stand in for a proof only while the proof is unchecked. On
  export, a claim whose proof is a recreation fails *Before you post*.

### The crew

| Name | Does | Colour | Notes |
|---|---|---|---|
| **Aldershot** | Holds the structure: the argument, the acts, the length. Proposes changes one at a time ("your stream and your video disagree — that might be the essay"; "that's 1:30 over — here's where it comes from") | ink | The system's own voice. Not a character. |
| **Scout** | Finds what the footage is missing. Links, never downloads (invariant 9) | teal (his states, doc 15) | Unchanged from doc 07 / 18. |
| **Sketch** | Draws what can be drawn, in code, timed to your line. Yours to approve | ink line art | A **label for the graphics capability**, not a second character — no avatar, no states. Keeps doc 15's "one character, Scout". |
| **You** | Your voice, your takes, anything waiting on you | gold | See Part five on gold. |

### Notes at the playhead

While the film plays, you talk or type. The note pins to that moment (a gold
marker on the strip) and is sorted into what happens next: a **search** for
Scout, a **drawing** for Sketch, a **move** or **trim** Aldershot proposes, a
**timing** change, or a **script** rewrite. The prototype sorts with a regular
expression, which is the right first build (*deterministic first*). A model
call replaces it only behind a `Classify` contract with an eval.

### One thing at a time

The room shows **one** task waiting on you, with its cost ("6
sec") and what it gets you, and the rest as titles. Finishing one shows what
changed and moves straight on. This is the design's answer to doc 20 Q4 (the
section that found nothing *is* the worklist) and it is deliberate about the
reader:

- Working memory is the bottleneck on dense screens (Rapport et al., 2008,
  *J. Abnormal Child Psychology*), so detail is folded until asked for.
- Starting is its own cost, so the next task is chosen for you; "Not now" and
  "After this" keep the choice yours.
- Help works best at the point of performance (Barkley, 1997, *Psychological
  Bulletin*), so the cost and the payoff sit beside the button.
- Delay is aversive (Sonuga-Barke, 2002, *Behavioural Brain Research*), so
  every task is under two minutes and the result shows immediately.
- Capture progress is shown as distance to a capability ("Four captures from
  a rough cut you can watch"), not points: informational feedback rather than
  reward (Deci, Koestner & Ryan, 1999), the goal-gradient effect (Kivetz,
  Urminsky & Zheng, 2006), and endowed progress (Nunes & Drèze, 2006).

## Part four: how the plan changes — the loop, not the funnel

The plan is a **hypothesis; the material argues back** (PASS-4 Q6). In the
prototype:

1. **Spine first, fast.** Thesis, target length, three acts, the section
   questions — enough for a playable rough film immediately.
2. **Everything that arrives is offered a place.** A Scout find, a recording, a
   document lands in a section or is flagged as a possible new angle.
3. **Aldershot rewrites the plan as evidence piles up**, one proposal at a
   time, always with the length consequence and where the time comes from.

Every accepted proposal is a **rule**, not an edit (invariant 1): *open cold on
Mariner 4* is an order rule plus a len rule on another section; *trim "The
cuts" by 40 seconds* is a len rule; *add "Both were true"* is a plan edit that
declares a section. Nothing stores the outcome.

## Part five: the nine questions, answered

1. **Is the plan the room?** **Yes, literally.** There is one room; the plan
   is its middle column and it plays on the right. Lenses (Film, Script, Needs)
   re-read it; the detailed cut (the One Take Editor) is where a finished film
   goes, not a tab beside it.
2. **Choosing between three possible videos.** Not drawn yet. The prototype
   reserves it as a capability that unlocks when every section has two angles
   ("Three ways to tell it: in order, by argument, or cold open on Mariner 4").
3. **Declared vs drafted.** Voice lines carry DRAFT or RECORDED, and a section
   Aldershot proposes arrives as a proposal you accept, so a declared section
   is one you said yes to. Rows need the same mark next.
4. **A section that found nothing.** It plays as its ghosts and is the
   worklist: "1 clip wanted", "2 lines to record", "Scout's on it".
5. **The genre word.** A quiet format line in the header: *video essay · 20 min
   target*. It never reaches the writer (invariant 10).
6. **Machine-readable receipt.** Not addressed.
7. **Frames on rows.** Not needed for the plan. Ghosts are drawn, and rows show
   a type, not a frame.
8. **Before you post.** Not addressed, except the Drawn rule above.
9. **The seven unbuilt things.** The overnight queue becomes the "while you
   were away" message in the room, and *Watch what changed* plays only what
   changed (22 seconds in the sample). The rest are untouched.

## Part six: what the prototype fakes

- **The crew's replies are scripted.** Four intents get tailored answers (cold
  open, find the Apollo 1 bulletin, draw the signal path, how much voice-over is
  left), trims and finds get templates, everything else is "noted at 6:32".
- **The overnight reel is a fixed list** of three blocks. In the build it is
  derived: every block whose status changed since you last opened the project.
- **The shared film is browser storage**, not a project.
- **The sample's facts are partly placeholders.** Real and checked against
  common sources: Mariner 4's hand-coloured first image (1965), the Hohmann
  transfer (~259 days), von Braun on Disney's *Man in Space* (1955), the NASA
  Art Program (1962), the Apollo 1 crew, the three dishes that received Apollo
  11's TV. The NASA budget-share figures are approximate and flagged on screen.
  The McLuhan quote is never written out — the real clip supplies his words.
  The oral-history passages are invented placeholders.

## Part seven: a build order

Each phase is small and has a test that would fail without it.

| # | Phase | Accepted when |
|---|---|---|
| 1 | **Plan object.** `Section`/`Block` as above, stored as rules; `compute()` returns sections → blocks → timings | The sample plan round-trips; a len rule on one section changes only that section's blocks; total length is derived, never stored |
| 2 | **Playable plan.** NOW renders any block from its type with no media, and the film column follows it | Every block kind renders; a 20:00 plan plays end to end, hands off section to section, and the section playing is the one open |
| 3 | **The sound weave + word budget** | Voice seconds and words-to-go are computed from blocks; a recorded take flips one block and the totals |
| 4 | **One task at a time** | The queue is derived from block statuses, never hand-kept; recording a block in the film column advances the task card; *Watch what changed* is derived the same way |
| 5 | **Notes at the playhead** | A note stores section + offset; the deterministic classifier routes the six kinds; a `Classify` model call is gated by an eval |
| 6 | **Sketch: three primitives** — orbit/path, line chart, number grid — as code | Each renders from data and a label; none is a pixel image |
| 7 | **Drawn finish** | A Drawn export of the sample has a label on every recreation; a recreation standing in for a proof fails *Before you post* |


*Phase 1 is built: `src/film-plan.ts` (`parseFilmPlan`, `computeFilm`, rules `len` · `order` · `declare` · `drop`), tested by `test/film-plan.test.ts` against `design/next/film.js`. In code the types are `PlanSection` / `PlanBlock`, so they never collide with the cut's `Block` in `src/blocks.ts`.*


## Part eight: the words

The glossary (`14-GLOSSARY.md`) gains: *section*, *two-column script*, *sound
weave* and its four modes, *rough film*, *Drawn*, *Trailer*, *Sketch*, *note at
the playhead*. *Spine* stays internal — the user sees **Plan**. Copy says
**your footage**, never *library*, and **in their words**, not *the clip
speaks*.

---

*Written 20 Nov 2026, against `3dffd41`; Part two redrawn the same week as one
room. The prototype pages are in
`design/next/`; the canvas they came from is the live original.*
