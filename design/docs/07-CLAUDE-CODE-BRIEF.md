# 07 — Claude Code brief

Paste this as your first message. It is written to be handed over verbatim.

---

## What this task is, precisely

This is **not** a request to write a handoff document, produce a plan, summarise a design, or propose an architecture. Do not produce documents.

**You are building the application.** Aldershot is a video editing SaaS whose entire interface already exists as a finished, working prototype. Your job is to implement a real backend and a real frontend that reproduces that prototype exactly, feature by feature, and makes it actually work on real video files.

The word "handoff" in this project means only one thing: the design phase is over and implementation starts now. It does not name a deliverable.

**Definition of done:** the owner uploads a 90-minute video they did not record, types a sentence, and gets a publishable cut back — through an interface indistinguishable from the prototype.

## Read before writing any code

0. `design_handoff_aldershot/08-HOW-TO-READ-THE-PROTOTYPE.md` — **read this first.** The prototype is a single file in an unfamiliar format; this explains how to extract the spec from it and what not to port.
1. `Aldershot.dc.html` — the entire product as a working prototype. Read the whole logic class, including the `state = { … }` initialiser. This is the spec.
2. `Landing.dc.html` — the signed-out marketing site.
3. `design_handoff_aldershot/01-PRODUCT.md` through `06-BUILD-PLAN.md`.
4. `assets/` — the real frames used for every thumbnail.
5. `design_handoff_aldershot/09-ICONS.md` and `10-ROUTES-AND-KEYS.md` — the exact icons, and the URL/keyboard/persistence contract.
6. `design_handoff_aldershot/reference/` — screenshots of every surface. Diff your build against these before adding features.
7. `design_handoff_aldershot/MANIFEST.md` — what to copy into the repo, and which files to ignore (there are abandoned editor explorations in the project; do not build from them).

If this documentation and the prototype ever disagree, **the prototype wins**.

## Fidelity rules — these are not suggestions

The previous handoff diverged on details that added up to a different-feeling product. Do not repeat it.

- **Use the prototype's exact values.** Copy hex codes, px sizes, radii, gaps, and font stacks out of the file. Do not substitute a design-system default, do not round 12.5px to 12px, do not swap `#17171B` for `#181818`.
- **Use the prototype's exact icons.** Every icon in the design is an inline SVG with a specific stroke width and geometry. Copy those SVGs. Do not import an icon library — last time icons were swapped for a library's lookalikes and the whole product read differently.
- **Use the prototype's exact copy.** `11-STRINGS.md` lists every string in the product — diff against it. Every label, empty state, button, and explanatory line is deliberate and has been through many rounds with the owner. Do not rewrite, shorten, or "improve" any string. If a string must change because behaviour differs, flag it — do not decide alone.
- **960px width law.** Every surface is `width:min(960px,100%)` inside `padding:0 clamp(24px,5vw,40px)`. No page gets its own width.
- **No timeline. Ever.** No scrubbing UI, no track lanes, no waveform-first editing. Editing is reading. If a feature seems to need a timeline, you have misread the design.
- **Real frames only.** Every thumbnail is an actual extracted frame. No gradients, no coloured blocks, no generated art placeholders.
- **Buttons are buttons.** No bare "Open →" text links where an action belongs.
- **Nothing hard-deletes.** Everything goes to the trash pile with an undo toast, and ⌘Z reverts it.
- **Every long operation is a job** with honest staged progress and a human label. Never a spinner with no stage.
- **Every job writes a `usage_events` row.** A job that does not meter is a bug.

## Stack

Cloudflare only: Workers, D1, R2, Stream, Queues, Containers, Vectorize, Durable Objects, Analytics Engine. Schema in `03-DATA-MODEL.md`, endpoints and prompts in `04-API-AND-JOBS.md`, infra and cost rules in `05-INFRA-AND-COSTS.md`.

TypeScript, no framework heavier than it needs. Server-rendered where possible; the prototype's interactions are simple enough that hydration islands are plenty.

## Order of work

Follow `06-BUILD-PLAN.md` phase by phase. Each phase has acceptance criteria — meet them before moving on, and report against them explicitly.

## How to handle uncertainty

Ask rather than invent. Specifically, stop and ask if:
- a string, colour, size, or icon is not in the prototype and you would have to choose one;
- a flow's behaviour is ambiguous after reading the logic class;
- an implementation would require a timeline, a scrub bar, or auto-deletion;
- a cost decision would change per-user spend by more than ~20%.

## What "done" is not

- Not a document, a plan, or a scaffold with placeholder UI.
- Not a close-enough rebuild with your own component library's spacing and icons.
- Not a subset. Every surface in the prototype ships, including empty, loading, and failure states.

## First deliverable

Phase 0 + Phase 1: a real upload that transcribes a 90-minute video and shows the shell, with honest progress and a `usage_events` row per job. Show me the diff before you go further.
