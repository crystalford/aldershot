# Prompting notes — how the last handoff went wrong

Written from a real failure, so it does not repeat.

## What happened

The first handoff produced a build that was recognisably a different product. Not because the developer ignored the design, but because dozens of small substitutions accumulated: an icon library instead of the design's SVGs, rounded font sizes, a different grey, rewritten button copy, different page widths, "improved" microcopy. Each one defensible; together, a different feel.

## The rule

**Substitution is the failure mode, not omission.** A missing feature is obvious and gets fixed. A swapped icon set is invisible in review and changes everything.

So every handoff instruction is phrased as *copy this exact value*, never *match the style*.

## Checks that catch it

Ask the developer to produce, before feature work:
1. A screenshot of one populated surface next to the prototype's, at the same width.
2. The list of every icon used, with its source. If the answer is a library name, it is wrong.
3. A grep of hardcoded hex codes in the build, diffed against the token list in `02-DESIGN-SYSTEM.md`.
4. A diff of every user-facing string against the prototype's.

## Things the owner has explicitly rejected

Do not reintroduce any of these. They were tried and cut.

- The nine-surface system (Desk, Discover, Studio, Generative, Essays as separate places).
- The word "desk" for the home surface.
- Film-strip / sprocket-hole visual metaphors.
- Italic or elegant serif type; anything that reads editorial rather than SaaS.
- Left-border accent stripes on cards.
- Purple as the primary accent; fully round pill buttons (radius is tight — 5px).
- Abstract arrangement labels ("as it happened", "building up", "best bit first").
- Channel-watching / webhook ingestion — platforms block it. Upload or library only.
- Auto-deletion of anything, on any plan.
- Parenthetical asides in UI copy.

## Things the owner cares about most

- The feel: SaaS, plain-spoken, calm, expensive-feeling. Not clever.
- Consistency across surfaces — inconsistent margins, mixed button styles, and text links where buttons belong all read as "unfinished".
- That the product visibly *is* a video tool: real frames, real previews, everywhere.
- That nothing is lost. Permanence over tidiness.
