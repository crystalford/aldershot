# design/next — the plan is the room

The prototype behind `docs/handoff/21-THE-PLAN-IS-THE-ROOM.md`: the design's
answer to doc 20. Render it, don't read it — `Start here.dc.html` first, then
`Studio.dc.html`.

| File | What it is |
|---|---|
| `Start here.dc.html` | How it all fits: five steps, who does what, what the colours mean |
| `Studio.dc.html` | The room: the whole film playing as a rough cut over its sound weave, the one thing waiting on you, the crew |
| `Plan.dc.html` | Acts → sections → the two-column script, each section playable; notes at the playhead |
| `Footage.dc.html` | What each section has and needs, one capture at a time (also carries the vlog sample) |
| `Trailer.dc.html` | The whole film in 1:22, Rough or Drawn |

The Editor tab links to `../one-take/Aldershot One Take.dc.html`, unchanged.

**Shared state.** The four pages share one film through browser storage
(`aldershot.nasa.v1`). "Reset the sample film" at the foot of the Studio
clears it. In the build this is just the project.

**What's faked** is listed in doc 21, Part six — chiefly that the crew's
replies are scripted, and that some of the sample's facts are placeholders.

`support.js` and `Scout.dc.html` are copies of `../support.js` and
`../one-take/Scout.dc.html`, so the folder renders on its own.
