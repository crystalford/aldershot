# design/next — the plan is the room

The prototype behind `docs/handoff/21-THE-PLAN-IS-THE-ROOM.md`: the design's
answer to doc 20. Render it, don't read it — `Studio.dc.html` is the product;
`Start here.dc.html` explains it.

| File | What it is |
|---|---|
| `Studio.dc.html` | **The room.** Conversation on the left, the whole film top to bottom in the middle (the scroll is the timeline), NOW on the right. Lenses: Film · Script · Needs. *Watch what changed* replays only what the crew did overnight |
| `Start here.dc.html` | How it all fits: five steps, who does what, what the colours mean, and the changelog |
| `Landing.dc.html` | The story told to a stranger, with a live drawn film in the hero |
| `Trailer.dc.html` | The whole film in 1:22, Rough or Drawn — made from the room's *Also…* |
| `Plan.dc.html`, `Footage.dc.html` | **Previous try** — the same film as separate tabs, kept for what they draw that the room doesn't yet |

The project switcher's other project (the vlog) and Settings link to
`../one-take/`, unchanged.

**Shared state.** Every page shares one film through browser storage
(`aldershot.nasa.v1`). "Reset the sample film" at the foot of the
conversation clears it. In the build this is just the project.

**What's faked** is listed in doc 21, Part six — chiefly that the crew's
replies are scripted, and that some of the sample's facts are placeholders.

`support.js` and `Scout.dc.html` are copies of `../support.js` and
`../one-take/Scout.dc.html`, so the folder renders on its own.

To look at it: `cd design && python3 -m http.server 8790`, then open
`http://localhost:8790/next/Studio.dc.html`.
