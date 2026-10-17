# Aldershot — developer handoff

**`Aldershot.dc.html` is the product.** One file, every surface, every state. `Landing.dc.html` is the signed-out marketing site. Everything in this folder describes them.

**"Handoff" here means implementation starts — it is not the name of a deliverable.** Nobody needs another document. The next step is building the app; `07-CLAUDE-CODE-BRIEF.md` says so in the first paragraph.

This set is CURRENT as of the last design session. Any older document (SCOPE-AND-AUDIT.md, DESIGN-AUDIT.md) has been deleted — if you find a copy elsewhere, it is stale and wrong about the product shape.

## Read in this order

| File | What it settles |
|---|---|
| `01-PRODUCT.md` | What Aldershot is, every surface, every flow, every state |
| `02-DESIGN-SYSTEM.md` | Tokens, components, layout law, the logo, copy voice |
| `03-DATA-MODEL.md` | Entities and D1 schema |
| `04-API-AND-JOBS.md` | HTTP surface, the job pipeline, the LLM calls and their prompts |
| `05-INFRA-AND-COSTS.md` | Cloudflare stack, usage metering, real cost model |
| `06-BUILD-PLAN.md` | Phases with acceptance criteria — build in this order |
| `07-CLAUDE-CODE-BRIEF.md` | The kickoff prompt. Start here if you are Claude Code. |
| `08-HOW-TO-READ-THE-PROTOTYPE.md` | How to read the `.dc.html` file — read before opening it |
| `MANIFEST.md` | Exactly which files to copy into the repo, and which to ignore |
| `09-ICONS.md` | The eight icons, as exact SVG strings. No icon library. |
| `10-ROUTES-AND-KEYS.md` | URL per surface, full keyboard map, what persists server-side |
| `11-STRINGS.md` | Every user-facing string, as a diff target |
| `reference/` | Screenshots of every surface — visual ground truth for review |
| `PROMPTING-NOTES.md` | Fidelity rules learned from the last handoff going wrong |

## One-paragraph product

Aldershot is a nimble editing product for people who cut other people's footage. You drop a long video, say what you want in a sentence, and it comes back as a cut, a set of vertical shorts, a reaction, or an essay — whichever your sentence reads as. You fix it by editing text, never a timeline. Everything you keep lands in Footage and can be reused in anything you make later.

**Editing is reading now.** No timeline, no scrubbing, no NLE. That claim is the product; if a build decision breaks it, the decision is wrong.

## The prototype is the spec

The design file is a working prototype with real interaction: playback, keep/drop, undo, search, exports, queues. When this documentation and the prototype disagree, **the prototype wins** — open it and read the logic class.

Assets: `assets/frame-1…6.png` (16:9 stills), `assets/vert-1…3.png` (9:16 stills). Every thumbnail in the design uses these; ship with real frames extracted from the user's own footage, never gradients or placeholder blocks.
