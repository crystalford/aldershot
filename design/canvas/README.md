# design/canvas — the canvas, version 73 (21 Nov 2026)

The newest prototype, copied from the owner's canvas. Render it, don't read
it: `cd design && python3 -m http.server 8791`, then open
`http://localhost:8791/canvas/Start here.dc.html`. The plan for porting it is
`docs/handoff/22-CANVAS-TO-CODE.md`.

| File | What it is |
|---|---|
| `Start here.dc.html` | How it fits together, and the changelog (entries 1–31) |
| `Map.dc.html` | Every feature, where it lives, and whether it's there |
| `Home.dc.html` | Projects, and what to make from a sentence |
| `Studio.dc.html` | **The room, led by a script.** Film · To do · Script · Argument · Rules, the conversation, the shot panel, the booth, Export |
| `Cut.dc.html` | **The room, led by footage.** Cut · Words · Footage · Shorts · Rules, on `footage.js` |
| `Scenes.dc.html` | Scene by scene: the same film, one scene at a time |
| `Library.dc.html` | Footage, read once |
| `Settings.dc.html` | Plan, usage, one spending limit, services, defaults, the thirty-day pile |
| `Manual.dc.html` | How the product explains itself, with two live demos |
| `Landing.dc.html` | The story told to a stranger |
| `Rough to finished.dc.html` | A concept only: the drawn rough beside a finished montage, kept out of the landing until there is a real one |
| `Plan.dc.html`, `Footage.dc.html`, `Editor.dc.html`, `Trailer.dc.html`, `Sign in.dc.html` | Earlier surfaces the pages still link to |

**Shared state.** The pages share one project through browser storage
(`aldershot.nasa.v2` for the essay, `aldershot.cut.v1` for the cut,
`aldershot.settings.v1` for Settings). "Reset the sample film" in the
conversation clears the essay.

`support.js` is the canvas runtime the pages load. `footage.js` is One Take's
engine with its frame paths pointing at `../assets/`.
