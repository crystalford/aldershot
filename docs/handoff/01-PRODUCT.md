# 01 · The product

## Who it's for

People who make videos out of footage and don't want to operate a timeline: commentary and reaction channels cutting other people's streams; essayists building an argument from clips and documents; anyone with hours of their own recordings who wants a tight three minutes. The common thread is not the genre. It is that they have *material* and want a *finished video*, and the craft of placing clips is work they would rather not do.

Aldershot was never built around vlogs. The sample footage in the prototype happens to be three vlogs because that was the smallest honest dataset; the labs screens use a streamer's archive and a written essay to prove the same engine covers other people's footage and footage-free briefs.

## The shape

**One room, and Settings.**

**The room** (`Aldershot One Take.dc.html`) has two states. With **no project open** — what used to be Home — the left is the front door (Cut · Shorts · Essay · React; Story · Supercut as the archive grows) and the centre is your footage: the archive summary, search across every transcript, Videos with their transcripts, Highlights, Projects. Attach and say what you want, or pick a type, and **a project opens** — what used to be the Editor, every feature intact: the Read in one line, the rules with their effects, the conversation above the composer; the centre is Footage (every moment through the rules) · Blocks · Words · Shorts; the player is its own column on the right. An Essay plans first, in the centre, and stops once at the beats. *Home* closes the project; *Editor* reopens it. Every decision is one line in the conversation, with Undo.

Direct manipulation stays — cutting a word, picking a take, inserting a line — because the one user study of an LLM video agent found people only succeed when they can refine by hand. It is the door, not the default.

**Settings** (`Aldershot.dc.html`). Off the avatar. Plan and meters, the owner's cost view, connected services (your own storage — R2, including the Neolog archive — your own model key, a scratch voice, your channels), defaults, storage, the deleted pile.

**Manual** (`Aldershot Manual.dc.html`) and **Landing** (`Landing.dc.html`) are the about-layer. Keep them in step; the Manual's copy is the product's voice.

## The five-step flow

Everything the product makes passes through the same steps; small jobs skip most of them silently.

1. **Brief.** A sentence, with footage attached or not. "Tighten this." "Shorts from this." "A video about whether I should leave." "React to his latest stream."
2. **Read.** The footage is read once into moments (what was said, by whom, what's on screen) and summarised in plain language, with observable facts only — never psychology.
3. **Plan.** For anything video-sized: the corpus is sized, the claim sharpened into one sentence, the beats laid out (for and against), footage found for each (your library first, then outside if allowed). **This is the one place it stops.**
4. **Cut.** Rules produce the cut. Narration only where footage can't say it. Pictures chosen by what each line is doing. Ghosts hold the place of clips not yet grabbed.
5. **Post.** Before you post: other people's footage, music, faces, generated segments, attributions, sound and captions — each with one press to fix. Export with receipts.

## The six pillars

Everything the product makes is one of six jobs. They are the user-facing names; the research's twelve *spines* (`labs/FORMATS.md`) sit underneath them.

| Pillar | Spines | What it needs | Engine |
|---|---|---|---|
| **Cut** | person · conversation · task | your footage | the seed rules; no questions |
| **Shorts** | fragment | your footage | the shorts profile; the self-sufficiency test |
| **Essay** | argument · exposition | your footage, a thesis, or both | the plan pipeline, one pause |
| **React** | source-clip | their footage — a link, a file, or Scout finds it | the react rules; commentary beside every clip |
| **Story** | chronology | dated footage | order = time; the day on screen at each change |
| **Supercut** | pattern | a phrase | a keep-set rule over the archive search; a count on screen |

Story and Supercut grow with the archive, so Home's lane shows them as a second group. Comparison and ranking are formats of Essay or Supercut; performance isn't ours; live and ambient are sources, not outputs.

## Principles

- **Talk, don't operate.** The interface is a sentence. "The start drags" is a valid instruction and becomes a rule.
- **Ask · Recommend · Auto.** How much it decides is a dial. On Ask it stops at real forks with a recommended answer; on Recommend it decides and tells you; on Auto it decides and reports. Questions are batched at two moments — after the plan and before export — never mid-render.
- **One step ahead.** When footage lands, three possible videos are waiting. After a cut, tighter and more-room versions are already rendering. It flags its own weak spots ("block 3 has no visual proof").
- **Show the joins.** Rule numbers on every block. Left-out moments listed with the rule that removed them. Receipts on screen. The edit you can interrogate.
- **Better than your footage alone.** Scout finds what a video is missing — the proof, the other side, the original, the context. External clips are linked, never downloaded. Attribution is written automatically. Third-party detection is "probable", never a clearance.

## Deliberately left out

- A timeline as the interface (it exists as the engine room, exported as OTIO).
- Scores and percentages anywhere a user reads.
- A separate Clipping product (Shorts is a mode), Home and the Editor as separate pages (one room, two states), a separate Footage page (Footage is the room's first tab), Projects as a page (it's a tab), rooms or workspaces.
- Viewer-driven branching, auto-SFX on cuts, streaks, points, confetti.
- A voice profile or fine-tune on the user's speech (tabled; see `12-DEFERRED.md`).
- Any server-side download from platforms that forbid it.

## Position

Not "AI that edits your video" — others say that already. **The edit you can interrogate**: every cut is a view of a signed archive, re-solvable to any length or question, showing what it left out and why.

*Rests on:* `labs/STRATEGY.md`, `labs/FORMATS.md`, `labs/EDIT-ENGINE.md`.
