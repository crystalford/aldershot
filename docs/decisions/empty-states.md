# Empty states should show the shape of the tool

**Status:** agreed direction, not built. Raised by the owner 2026-08-31.

## The observation

> "when you go to editor or clipping I really think those should look like
> tools not just blank screens"

> "maybe the editor should open and it is just empty and has the upload …
> but then the editor below so it just shows up … same as clipping, maybe
> there should be some sort of visual that would be the clips if they were
> populated, like an empty carousel or WHATEVER it is that would show this
> instead of basically just upload files and a blank screen"

## Why it came up

The prototype was built with sample data loaded, so no one was looking at
these surfaces with nothing in them. That is not a gap in the design work —
it is a question the design was never asked. The editor intake state
(`06-editor-intake.png`) does exist and is now built, which fixed the worst
of it; this is the next step beyond that.

## The principle

An empty state should teach the shape of the filled state. Today ours mostly
say "there is nothing here, add something" — correct, and it tells you
nothing about what the tool does once you do. The alternative is to render
the real chrome in a dormant state, so the surface reads as an instrument
that is idle rather than a page that is missing.

Concretely:

- **Editor** — keep the intake composer at the top, then show the editor's
  own structure underneath it: the stage tabs, and the block column with a
  few dormant block outlines where kept clips will land.
- **Clipping** — keep the video picker and drop zone, and show the controls
  (shape, captions, length, how many) plus a dormant grid where the scored
  shorts will appear, at the real card size and aspect.
- **Footage** — the tab bar and search already do this reasonably; the clip
  grid could carry the same dormant cards.

## What has to be true for it not to backfire

1. **A dormant control must not look operable.** If the shape/captions chips
   render live on Clipping with no video loaded, pressing them does nothing
   and the surface has lied. They need a visibly inert treatment.
2. **No fake content.** Dormant means empty outlines at the right size, not
   placeholder thumbnails or lorem quotes. The standing rule against
   invented data applies here more than anywhere — a fake clip card on an
   empty account is the exact impression we are trying not to give.
3. **It must not read as broken.** There is a real failure mode where a
   skeleton is mistaken for content that failed to load. One line of copy
   anchoring what the space is for prevents that.

## The other half of this

The design's own answer to empty surfaces is the demo: `onTryDemo`, "Don't
have a video handy? Try it on ours. A 48-minute podcast, already read.
Twelve clips found — see the whole thing work before you upload anything."

The card renders on Home and is wired to nothing, and "Try it on our
footage" was dropped from the landing page for the same reason. Seeding a
demo source would populate every surface at once and is arguably a better
fix than dormant chrome, because everything shown would be real.

Open question for the owner: a demo built from the design's own frames and
transcript would look and read correctly but have no playable video behind
it. Making playback work needs a real sample file shipped with the product.

## Not doing yet

Owner's call, 2026-08-31: "I'll just work with it here… let's just note it."
