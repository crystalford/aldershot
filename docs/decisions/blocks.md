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

1. **One editor.** Merge Pick + Script + Build's gestures onto one surface;
   drop the tab bar. Blocks come from segments, with beats interleaved.
2. **Auto-name the cut.**
3. **Fold Clipping in.** 9:16 becomes an export; "find the strong bits" becomes
   an assist that scores blocks in place; `kept` gets one meaning.
