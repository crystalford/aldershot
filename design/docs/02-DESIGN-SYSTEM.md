# 02 — Design system

Everything here is lifted from `Aldershot.dc.html`. Do not re-derive values; copy them.

## Type

- **Instrument Sans** — all UI. Weights 400/500/600 only. Letter-spacing `-0.022em` on headings ≥22px, `-0.01em` on the wordmark.
- **IBM Plex Mono** — timecodes, counts, money, scores, keyboard hints. Never for prose.
- Sizes actually used: 24px page title, 15.5px wordmark, 13.5px body/nav/labels, 12.5px secondary, 11px meta, 10.5px pills.
- No italics anywhere. No serif. `text-wrap: pretty` on prose.

## Colour

| Role | Value |
|---|---|
| Canvas | `#101013` |
| Surface | `#17171B` |
| Raised | `#1A1A1F` |
| Pill | `#232329` |
| Active | `#2E2E36` |
| Ink | `#ECECF1` |
| Ink 70 / 45 / 32 | `rgba(236,236,241,0.7 / 0.45 / 0.32)` |
| Hairline | `rgba(255,255,255,0.06)` |

Accents — each means one thing, never decorative:

| Accent | Meaning |
|---|---|
| `#D9B36A` gold | your voice, progress, attention |
| `#5EC98F` green | clips, kept, success |
| `#5EB8C9` cyan | another source, info |
| `#B08CD4` violet | generated / made for you |
| `#E06A6A` red | record, error, destructive |

Accent backgrounds are always the accent at `0.14` alpha with the accent as text colour.

## Layout law

- **Every surface is `width:min(960px,100%)`** inside `padding:0 clamp(24px,5vw,40px)`, page padding `40px 0 96px`. No exceptions — this was fixed after pages drifted to different widths.
- Scrollbar gutter is reserved globally so short pages do not shift the nav.
- Radii: 5px pills/buttons, 7px inputs, 9px cards, 12px composer.
- Gaps, never margins between siblings. Flex/grid with `gap` throughout so drag-reorder and delete survive.
- Every button-like row: `white-space:nowrap`. Wrapped button labels and colliding chip sublabels were the single most common defect — check every new row.

## Components

- **Button** — 7px×14px pad, 5px radius, 12.5px/500. Primary `#ECECF1` on `#131316` ink; secondary `#232329` → hover `#2E2E36`. Never a bare "Open →" text link where a button belongs; every action is a real button.
- **Card** — `#17171B`, 9px radius, 16–18px pad. No left-border accent stripes (explicitly rejected).
- **Stage pill** — 10.5px/600, `.04em` tracking, accent at 0.14.
- **Composition bar** — 5px tall, segments coloured by the accent meanings above, with a legend naming each colour.
- **Thumbnail** — real frame, 9px radius, 16:9 or 9:16, with a mono timecode badge.
- **Seam `+`** — a 22px circle between blocks, `#17171B` → hover `#232329`. This is how anything gets inserted mid-piece.
- **Toast** — bottom centre, `#1A1A1F`, one line, an Undo action.

## The logo

Wordmark `aldershot` (Instrument Sans 600, `-0.01em`) followed by a three-bar reading mark: three 5.5×11px bars, 2px radius, 2.5px gap, at 100% / 50% / 22% opacity of one colour. The bars read left-to-right like text — the mark *is* the claim.

The lead colour changes by surface (`markLead`): Home/essay gold, Projects/cut green, Clipping red, Footage cyan, Settings ink, with a 0.35s transition. Print-quality variants live in `Logo Print Sheet.dc.html`.

## Copy voice

Plain-spoken, second person, no jargon and no marketing verbs. Say what a thing does in the words the user would use.

- Good: "Drop an hour-long video, say what you want out of it, and it cuts." / "Nothing kept yet." / "3 reactions to record — the clips are already placed."
- Banned: "leverage", "seamlessly", "powerful", "AI-powered", em-dash-free breathless copy, exclamation marks, emoji.
- Never invent product jargon. Users rejected "desk", "film strip", and abstract labels like "as it happened / building up / best bit first" — every label must be self-explanatory or it gets cut.
- Numbers are specific and real: "47 found · −0:04", not "several".

## Motion

Micro only. 0.12s on hover colour, 0.35s on the mark's colour, progress bars animate their width. No entrance animations, no parallax, no gradient washes.
