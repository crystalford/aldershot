# 02 · Screens and states

Each screen maps to a prototype file. "Faked" marks data or behaviour the prototype simulates; everything else is logic worth porting.

## The product is one room — `Aldershot One Take.dc.html`

Home and the Editor were two pages over the same object. They are now one surface with two states: **no project open** (what used to be Home) and **a project open** (what used to be the Editor). Nothing was rebuilt to get here — the room is Editor X with Home folded in, so every Editor feature is intact.

### The nav (every page)

52px bar: the wordmark (closes the project, back to your footage; its three bars rotate blue → green → red → yellow, one step per visit and on hover) · **Home** (no project) · **Editor** (the current or last project) · avatar → Settings. Under it, the title row: the project's name (click to switch project; *Your footage* with no project) · source chips (scope the view to one video) · the four tabs · **+ Add** · Export.

### Three columns

**Left — direction (360px).**
- *No project:* one line of explanation, then **MAKE** — Cut · Shorts · Essay · React — and **AS YOUR ARCHIVE GROWS** — Story · Supercut. Each starts a project. Below, the opening conversation (search answers, the plan's turns).
- *A project:* the Read in one line (*how it read it · fix it* opens the full read) → the rules (numbered, switchable, each with its live effect; hand rules listed apart) → **Tools** (Style · History · Recipe · Brief, behind one toggle) → the conversation above the composer: *It noticed* (sound issues, each with its fix first), every change it made, chips.
- *Composer:* the text box, **Ask · Recommend · Auto** (Ask proposes a rule and waits for Add; Recommend and Auto apply it and confirm, with Undo), hold-to-talk, Run it. The row wraps; Run it stays inside the box.

**Centre — the thing itself.** Four tabs: **Footage · Blocks · Words · Shorts**.
- **Footage** (it replaced Overview):
  - the archive summary (*What's in your archive*, one paragraph);
  - search across every transcript, by meaning or exact words — matching lines with the match highlighted, each marked *in this cut · left out · a moment · transcript*, click to open the transcript;
  - **Videos** (first) — each with its read status (*read · words + screen*); click a video for its **transcript**: summary, every line with time and speaker, moments marked (*in · go to it* / *out · keep it* inside a project; click to attach with none), speaker names fixed once for every video;
  - **Highlights** — the moments the read picked out, by thread; **Mine · External · All** (external moments badged *acquired · linked · mission open*);
  - **Projects** — what you've made; the open one first, *opens where you left it*;
  - with no project you **attach** (moments or whole videos); inside a project every moment is shown **through the rules** — *in · rule 01*, or *out · rule 02 · click to keep*.
- **Blocks** — the cut: frame (or YOU tile, or dashed GHOST tile), text, timecode, why it's there; per block: cut by hand, swap take, insert, beat mode, record.
- **Words** — the transcript of the cut; click a word to strike it.
- **Shorts** — candidates with Strong / Worth a look / Long shot and a reason; trim, reframe, captions, post copy; *Not shorts* with reasons.
- **The plan** (a state of the centre column while planning an Essay): the step strip, the **claim** card, seven **beats** (YOUR CASE · AGAINST · OUTSIDE VOICE) with Cut / Keep — **the one stop** — then found footage per beat (yours first, outside as ghosts, Scout on the header while it looks), thin beats in red, narration lines marked *yours*. *Cut it* turns the plan into the project.
- *Judgement calls* and *Before you post* appear here when they're real.

**Right — the player (300px, only with a project).** Now: the source and state · a 16:9 frame of the current block · its line and why it's there · ‹ ▶ › · time · the block scrub · keyboard hints (space · ← → · x · ⌘z). Clicking a block shows it here; the centre never moves. Below ~1180px it folds into a corner player that opens on play, a time pill when closed.

### Sheets and overlays

- **Add footage** (no project): a file or link · **a podcast** (a show's feed; episodes land in Highlights → External) · **your own storage** (R2 — including Neolog — S3, Drive, Dropbox → Settings) · **Scout** (On · Per project · Off — bring him into a project and he researches the whole video with you).
- **Add to this cut** (inside a project): add a source; its moments join *left out* until a rule or your hand keeps them.
- The **record** booth, the **project switcher**, toasts with Undo.

### Starting a project

| From | It does |
|---|---|
| **Cut** card, or attach + "tighten this" | the seed rules on the attached footage (one source → scoped and titled to it) |
| **Shorts** | Shorts mode on the same rules |
| **Essay**, or "a video about…" | the plan, in the centre column, with its one stop; *Cut it* makes the project |
| **React**, or "react to…" | attach the video you're answering; rules with room for your answer after each thread |
| **Story** · **Supercut** | as it happened · every moment about one thing |
| a **Projects** item | resumes it |

"Where do I talk about money", "every time I mention Mum" — with or without a project — answers in the conversation with a count and three receipts, and *Show them in Footage*. "Scout, find his latest stream" (or "find the clip where…") asks Scout to look outside; what he finds lands under Highlights → External, linked, and rides into a cut as a ghost.

### What's real and what's faked

**Real and portable:** the rule engine and everything on it (`footage.js` → `compute`, `applyRule`, `searchLines`, the project save and restore); rule parsing, including feelings ("the start drags"); attach → scope; the plan → project build (beats → a footage set with outside clips as ghosts, the plan's order as a rule, narration as voice beats); React and Story/Supercut rule sets; hand rules, struck words, inserts, history and Undo; the Ask dial; Brief compilation; the Shorts selection.

**Faked:** media and rendering; recording audio; the read itself (the sample has eleven transcript lines per video); meaning search (a synonym table standing in for embeddings); It noticed's detection; Before you post's findings; the podcast import and storage connections; the second project in Projects.

## Settings — `Aldershot.dc.html`

Account · Plan & usage (Starter $39 / Creator $99; meters: footage-hours, generated seconds — landed only, storage, a monthly spend cap) · What it costs to run (owner only) · Connected services (**your Cloudflare R2 bucket**, your own model key with the BYOK contract, ElevenLabs scratch voice, YouTube read-only) · webhook · Defaults (exports, shorts shape, captions, subtitle file, how much it decides, **look outside your footage**, how deeply it reads, originals) · Storage · Deleted (30 days, Restore, Undo). Home and Editor in its nav open the room.

## Also in the project

- `Aldershot Manual.dc.html` — how the product explains itself; its live frames open the room.
- `Landing.dc.html` — the signed-out site.
- `Scout.dc.html` — the Scout character, imported by the room.
- `labs/` — not public; behaviour is spec: `Directed plan`, `Scout`, `Essay to video`, `Footage sets`, `Meet Recce` (Scout's design history).
- `archive/rooms/` — Home, Editor X and the four room attempts that led here. Not specification.

## Copy rules (all screens)

Sentences someone would say. No "Submit", no "Error", no title case, no exclamation marks. Numbers in mono. Blame attributed precisely: the provider's overload, your key's limit and our failure are three different sentences. The user's work is never "deleted", "failed" or "invalid" — it is "left out", "didn't land", "couldn't turn that into a rule".
