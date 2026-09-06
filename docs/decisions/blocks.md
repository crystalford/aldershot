# One atom: the block

**Status:** agreed direction. Owner, this session:

> "the whole idea was a new kind of editor that is like blocks, AI powered,
> script editing (descript) and opusclip.. Almost like a superpowered version
> of both. I don't think we accomplished it"

> "probably just needs to be one editor.. and sure a video has one cut"

## Why it was not accomplished

Not because the editor was built badly. Because **the same idea was built three
times**, each with its own table, surface and vocabulary:

| table | what it is | whose surface |
|---|---|---|
| `segments` | a transcript line, from Whisper | Script |
| `v2_clips` | a scored moment, from the model | Pick, Clipping |
| `beats` | an entry in a sequence | Build |

All three are *a piece of the finished thing*. A scored clip is a range of
segments. A beat is a clip, or a recording. They differ in where they came
from, not in what they are.

Everything confusing about the editor follows from that:

- **Pick and Script feel like the same tab** because they are — both strike the
  same `cuts`, one by line and one by word.
- **Build is empty** on a fresh cut, because beats only exist if a scoring pass
  made them. The reorder and insert gestures — the "building blocks" the owner
  remembered — are marooned behind that.
- **Clipping is a second product**, because scored clips got a surface instead
  of being a property of the thing you are already editing.
- **`kept` means three things.** It decides what is in a cut, what shows in
  Footage's Clips tab, and what a Clipping short's toggle sets — so keeping a
  short silently edits your cut.

## The atom

**A block is one piece of the finished piece.** It has:

- an **origin** — a range of your footage, a recording of you, or generated
- **words**, when it has any, with their timings
- a **position** in the sequence
- optionally, what the model **thought of it** — a score and a reason

Everything the product does is one of five verbs on that:

| verb | today's home |
|---|---|
| **strike** — a line, or words inside it | Pick, Script |
| **reorder** | Build |
| **insert** — your voice, a reaction | Build's seams |
| **judge** — the model scores what is strong | Clipping, the score pass |
| **export** — the sequence, or one block alone | Export, Clipping |

One surface can hold all five. Four cannot hold any of them well.

## Why this is the innovative version rather than a tidier one

Descript edits text but does not make rearranging into new pieces natural.
OpusClip finds and renders the strong moments but cannot edit them. **Blocks
you can rewrite AND rearrange, with the model marking what is strong, is the
thing neither of them does** — and it only exists if the atom is one thing.

A 9:16 export of one strong block *is* an OpusClip short. It should not need a
separate place, a separate table, or a separate word.

## What this changes

- **A video has one cut.** Auto-named, not the filename. No second noun.
- **One editor.** No stage tabs.
- **Scoring is an assist inside it**, not a destination.
- **Shorts are an export**, not a surface.
- `kept` stops meaning three things.

## What it does not change

The cut model (`src/cuts.ts`) is already right and already shared: ranges, not
deletions, so a struck line renders struck and the render can always be re-run.
That discipline is what makes blocks safe to reorder. Nothing here weakens it.

## Order of work

Shippable stages, so it can be judged early rather than at the end:

1. ~~**One editor.**~~ Done. Pick + Script + Build's gestures are one surface
   at `/p/:id/cut`; the four old stage paths are aliases so bookmarks survive.
   Blocks come from segments, with beats interleaved.
2. ~~**Auto-name the cut.**~~ Done — see below.
3. **Fold Clipping in.** 9:16 becomes an export; "find the strong bits" becomes
   an assist that scores blocks in place; `kept` gets one meaning.

## Naming (stage 2)

A **source** keeps its filename; you find a file again by what you called it.
A **cut** is named after what it is about, because "DJI_20260905043337_0026_D"
tells you nothing about the piece.

The name is worked out once, inside the read, and stored on the source as
`cut_title` — not generated when the editor opens. A cut is created lazily on
first open, so naming there would put a model call inside a redirect, and two
opens could produce two different names.

Three names, in order of how much they tell you: the brief if there was one
(the user's own words win), then `cut_title`, then the filename.

Two failure modes are handled by refusing rather than guessing:

- **Nothing was said.** Whisper hallucinates on silence, and its favourite
  hallucination is "Thank you." — four silent test clips came back named
  "Thank you". Under twelve words, the cut keeps its filename.
- **No clause.** Spoken transcripts often have no punctuation, and the first
  eight words of running speech is not a title: the local pass named a real
  video "It confirmed so went to gym finally i'm". If no clause boundary is
  found, nothing is returned.

Footage read before this existed is named by the hourly sweep, bounded per run
so a large library costs small calls spread over hours.
