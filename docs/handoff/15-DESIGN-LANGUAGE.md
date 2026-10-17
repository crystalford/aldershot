# 15 · Design language

The prototype's tightness comes from constraints applied without exception. Build UI to these; where the prototype and this document disagree, the prototype wins for a specific screen and this document wins for anything new.

## Colour

- Background `#101013`. Surfaces step up by one: card `#141418`, nested `#17171B` / `#1A1A1F`, control fill `#232329`, control hover `#2E2E36`, control active `#2A2A31`.
- Ink is near-white `#ECECF1` at fixed opacities: 0.88 body · 0.72–0.8 secondary · 0.5–0.55 muted · 0.42–0.45 section labels and metadata · 0.35 hints.
- **Gold `#D9B36A` means the system**: the wordmark bars, rule numbers, recommendations, flags, ghosts and missions, the claim card, the system's avatar. Nothing else is gold — not links (ink), not Undo (the user's action, ink), not category tags like ESSAY or A VIDEO (violet, the story accent), not pricing highlights or eyebrows (ink). Audited 15 Oct 2026 across Home and Landing; the Editor and Settings already held to it.
- **Green `#5EC98F` means kept / verified / on**; **red `#E06A6A` means cut / out / expiring**; teal `#5EB8C9` and violet `#B08CD4` identify sources, never states. No other colours.
- No gradients, no drop shadows. Edges are `inset 0 0 0 1px rgba(255,255,255,0.06)`; emphasis is a 1.5–2px inset ring in the state colour.

## Type

- **Instrument Sans** for words (400 · 500 · 600). **IBM Plex Mono** for anything numeric or structural: timecodes, counts, durations, rule numbers, section labels.
- Sizes: body 12.5–13.5px; headings 14–15px weight 600, letter-spacing −0.01 to −0.02em; page titles 20–24px; section labels 10.5px uppercase, letter-spacing .09em, weight 600, 45% opacity; metadata 10.5–11px mono.
- Line-height 1.45–1.65. `text-wrap: pretty` on any run of prose.

## Space and shape

- A 4px rhythm. Gaps 4–6px within a group, 8–14px between groups, 22–40px between sections.
- Padding: rows 8–9px × 10–12px; cards 13–16px; buttons 4–7px × 9–14px.
- Radii ranked: 9–10px card, 7–8px row, 4–5px button and chip, 3px badge, 99px pill.
- Layout with flex/grid and `gap`, never margins between siblings. `min-width:0` on anything that must shrink; `flex-wrap` on rows that hold text and buttons.

## Components

- **Button**: text with a flat fill; `#232329` → hover `#2E2E36`; the primary action inverted (`#ECECF1` on `#131316`). Weight 500–600, 11–12.5px. Icons only when the icon is the content.
- **Chip**: 11px, 4px radius, `rgba(236,236,241,0.09)` fill; grey chips fill the composer, gold chips act.
- **Toggle**: 22×12 pill, green when on, dark when off; the rule text strikes through when off.
- **Rule row**: mono number in gold · sentence · effect line in muted ink · toggle.
- **Block row**: 58–72px 16:9 frame (or YOU tile in gold tint, or GHOST tile dashed gold) · text · mono timecode · a chip saying why it's there.
- **Segment control**: 2px padding, `#17171B` track, the selected item `#2E2E36`.
- **Card badge**: 10px, 3px radius, state-tinted fill (`color + "26"` or 0.14 alpha) with the state colour as text.
- **Toast**: bottom-centre, `#1F1F25`, one sentence, one Undo.
- **Progress**: a stage label in words and a thin bar; never a spinner; per item where items exist.

## Copy

- Sentences someone would say. Lower-case after the first word. No exclamation marks, no "Submit", no "Error", no "Oops".
- The system refers to itself as "it". The user is "you". Decisions are reported as done, with Undo: "Off — rule 02."
- Numbers in mono; units spelled ("3 moments", "5:59", "0.7 h"); never a percentage in front of a user.
- Three different sentences for three different faults: the provider's overload, your key's limit, our failure.
- **One line of secondary text per element, at most.** Section labels carry no subtitle; a card has a name and one line; the reason lives in a tooltip or the Manual, not under the control. Meta lines name counts, not explanations. (Pass of 15 Oct 2026: lane rows, canvas subtitles, Before you post, Settings hints and service blurbs all cut to one line.)
- Empty states say what would fill them, in one line. Nothing decorative — no illustrations, no confetti, no streaks.
- **One character, Scout** (renameable by the user), and only where the system looked outside the user's footage. He is an indicator with a shape: a scout probe — a pale forward-facing pod so he reads on the dark UI, a dark visor with one lens, two fins, a mast, a thruster — one colour at a time and the colour is the state (teal looking · green found · gold mission · red thin · grey off), motion for the rest (hover, fly, scan, tilt, blink), a half-second green tick for a verified find, no face for bad news, never a celebration. Silhouette first, one accent, the eye as focal point, state by motion. He never appears where nothing was searched (`07-SCOUT.md`, `labs/Meet Recce.dc.html`).

## The composer

One row under the text box, never wrapped: **how much it decides** as one chip that cycles Ask → Recommend → Auto (the meaning in its tooltip) · hold-to-talk · the send button at the right edge. No suggestion chips inside the composer — the front door and the conversation's chips carry suggestions.

## The wordmark

Three bars that rotate blue → green → red → yellow, one step per visit and on hover. The only place the four colours appear together; everywhere else colours keep their meanings.

## Motion

- 120–300ms ease on state changes; `viewIn` fade-up on screen change. No celebratory animation. Under 400ms for a state flip (outline → solid with a tick).

## Accessibility and density

- Hit targets ≥ 28px on desktop rows; text contrast ≥ 4.5:1 for anything below headline size (the 0.42 opacity labels are decorative structure, paired with full-opacity content).
- Everything reflows to a 900px pane: panes get `min-width:0`, rows wrap, segments drop to their own line.

## Fonts to load

```
https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap
```
