# Manifest — exactly what to copy into the repo

Copy these, unchanged, into a `design/` folder at the repo root. Nothing else in this project is needed.

| Path | What it is | Needed because |
|---|---|---|
| `Aldershot.dc.html` | the product prototype | it is the spec |
| `Landing.dc.html` | signed-out marketing site | phase 9 |
| `support.js` | design-tool runtime | required for the two files above to open in a browser |
| `image-slot.js` | runtime dependency | same |
| `assets/frame-1…6.png` | 16:9 stills | every horizontal thumbnail and player poster |
| `assets/vert-1…3.png` | 9:16 stills | every shorts thumbnail |
| `Logo Print Sheet.dc.html` | logo variants, print quality | brand assets |
| `design_handoff_aldershot/*.md` | this documentation set | all of it, current |
| `design_handoff_aldershot/reference/*.png` | surface screenshots | visual ground truth for review |

Open `design/Aldershot.dc.html` directly in a browser — no build step, no server. If it renders blank, `support.js` is missing or not a sibling.

## Not to be copied
`Editor A/B/C.dc.html` — abandoned editor explorations kept for history. **The editor that ships is the one inside `Aldershot.dc.html`.** Do not build from A, B, or C.
`Aldershot Spec.dc.html`, `Aldershot Handbook.dc.html` — superseded by this markdown set.
`Logo Options.dc.html`, `screenshots/`, `uploads/`, `exports/` — working files.
