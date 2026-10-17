# 01 — Product

## The claim

**Editing is reading now.** The user never touches a timeline. Every edit is a text edit — striking a sentence, keeping a block, reordering blocks, typing a new instruction.

## Who it is for

Someone who edits **other people's footage**: clip channels, commentary, reaction, video essays. They are not uploading a personal archive; they are processing streams, interviews, and podcasts into publishable pieces fast. Assume the source is a 45–180 minute video they did not record.

## Nav (four items, one avatar)

`Home · Editor · Clipping · Footage` — plus the wordmark (→ Home), global search (⌘K), keyboard help (?), notifications, and the avatar (→ Settings).

**Projects is not in the nav.** It is reached from Home ("Open Projects"), from search, and after any render. This is deliberate: the nav holds *verbs*, Projects is *state*.

## Surfaces

### Home — the composer
The only entry point that matters. A large text field: *"Say what you want out of your footage."* Drop or attach a video, type a sentence, press Begin.

The sentence is classified into an intent (see `04-API-AND-JOBS.md` → `readIntent`):

| Reads as | Goes to | Example sentence |
|---|---|---|
| `extract` | clips land in Footage, tagged. Nothing to assemble. | "get me every time he mentions the algorithm" |
| `shorts` | Clipping, scored vertical shorts | "three shorts from the best arguments" |
| `tighten` | Editor → Script stage | "tighten my recording" |
| `compose` | Editor → Pick what stays | "supercut of the weird moments" |
| `react` | a Reaction project with recording gaps placed | "react to the logical fallacies in this" |
| `essay` | an Essay project, acts scaffolded | "video essay about parasocial incentives" |

Home also carries, when there is work in flight: a **working row** (what is processing right now, with percentages), **Since you were away** (decisions waiting — each with a real action), and **in-motion projects** with thumbnails. When the account is fresh, all of that collapses to the composer plus three example sentences.

### Editor — one editor, four stages
The editor is **one surface with a stage tab bar**, not four screens:

`Pick what stays · Build · Script · Shorts from this`

Tabs are context-aware — a project with no source footage does not show *Pick what stays* or *Script*.

- **Pick what stays** — the whole hour as keep/drop blocks. Each kept block shows its thumbnail, timecode, transcript, and why it was kept. Skipped stretches sit between them as striped grey bands you can open and pull from. `X` keeps or drops; `↑↓` moves between blocks; ⌘Z undoes. A **Clean up** chip row applies studio sound, filler removal, pause tightening, and flagged-cut in one tap each.
- **Build** — the arranged piece as blocks: clips, your voice, reactions, generated visuals. `+` seams between blocks insert a reaction, a voice line, or a clip from another video. Beats needing your voice show **Record** and **Generate it** (ElevenLabs, user key).
- **Script** — Descript-style. The full transcript as editable text; deleting words deletes video. Struck sentences render as strikethrough, not gone, so the cut is legible.
- **Shorts from this** — the Clipping engine pointed at this project's kept clips.

Above the tabs: the project title (single source of truth across stages), a stage pill, and a back link that returns where the user came from.

### Clipping — auto-shorts, no brief
Point at a video (upload, paste a URL, or pick from Footage) → scored vertical shorts with captions burned in. Per-batch controls: aspect (9:16 / 1:1 / 4:5), caption style, clip length, count. Each result shows score, why it scored, the found timecode, and Keep / Skip. "Ask for a specific clip" searches the transcript instead of scoring.

Clipping reached from the nav is standalone. Reached as an editor stage it keeps the Editor nav lit and shows the four stage tabs — same engine, different context.

### Footage — the library
Everything kept, in three tabs: **Moments** (clips, each with thumbnail, quote, source, timecode, where it has been used), **Threads** (clips auto-grouped by meaning — a thread is a topic container, a clip is a piece of video), **Sources** (the long videos, clickable straight into the editor). Search runs in two modes: *meaning* (embeddings) and *exact* (transcript text). An **Ask** field answers questions over the library and returns the clips behind the answer.

### Projects — everything being made
One row per project: thumbnail, kind (Cut / Reaction / Essay / Idea), a composition bar showing what it is made of (clips, your voice, another source, generated, still empty), percent there, what it needs next, and last touched. Actions: open, branch a shorter version, archive. The newest is a hero row.

### Settings
Account, plan and usage meters, **What it costs to run** (owner-only real spend — see `05-INFRA-AND-COSTS.md`), connected services (ElevenLabs key; stock footage and transcript search are included), export defaults, storage, deleted pile.

### Landing (`Landing.dc.html`)
Signed-out marketing site. Hero: **"Editing is reading now."** with the kicker NO TIMELINE · NO SCRUBBING · NO NLE. Below: the sentence-composer demo as evidence, the three things it does, and pricing. Reachable from Settings → "Signed-out site".

## Cross-cutting behaviour

- **Everything kept lands in Footage** and says so. That trail is what makes reuse real.
- **Undo everywhere.** Any destructive action (drop, archive, delete) posts an undo toast; ⌘Z reverts. Nothing hard-deletes — deleted items go to a pile in Settings.
- **Permanence.** Nothing is auto-deleted, ever. Storage cost is accepted as the price of that (see cost doc).
- **Overnight queue.** Any pass can be queued to run while the user is away; queued items show in the intake as "queued — ready when you're back."
- **Real thumbnails everywhere.** Every clip, project, source, and short shows an actual frame.
- **⌘K search** answers questions and jumps anywhere; `?` lists shortcuts; `G` then a letter navigates.

## States that must exist in the build

For every surface: fresh/empty, loading (with real progress and what stage it is in), populated, failed (with a retry that keeps the user's words), and offline. The prototype implements all of these — match them.
