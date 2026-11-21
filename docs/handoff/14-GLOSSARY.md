# 14 · Glossary

Use these words — in code, in copy, in commit messages. Where a word has a synonym we rejected, it's noted.

**Archive** — everything the user has read into Aldershot: moments, videos, documents, and what's been made. The room's Footage tab. *Not* "library" in copy ("your footage" is what the user sees).

**Attach** — put a moment or video into the conversation so the next sentence acts on it. The green ring.

**Beat** — one unit of a plan: a name, a role (his case · against · outside voice), what it must show, what was found for it. Beats become blocks when the plan is cut.

**Block** — one row of a cut: a moment, a voice beat, or a ghost. The Blocks tab. *Not* "clip" in copy (clips are what other tools have).

**Brief** — the sentence the user typed, plus what the intent parse made of it. Also: the Editor's Brief button, which compiles a pasted client brief into rules.

**Canvas** — retired word for the centre column; say *Footage*, *Blocks*, *Words*, *Shorts*, or *the plan*.

**Claim** — the one sentence a video argues; sharpened from the brief; shown as a card.

**Corpus** — how much there is to work with on a subject: huge · moderate · thin.

**Cut** — what the rules produce from the moments. Also the Editor's mode for long-form. A cut is a view, never a stored outcome.

**Cut ledger** — what was cut and why: spans removed, the rule that removed them. Shown live as the left-out list; published on export.

**Cue sheet** — the list of generated elements in a video: what, how made, when. Exported with the project.

**Direct / directive** — what the model does: decide what, why, order and visual job, as a typed object with bounded settings and no timestamps.

**Dispute file** — per video, every external clip's source, timestamp, fraction used, ratio to commentary, attribution. Evidence of transformative use, assembled as the video is made.

**Dossier** — the memory: searches run, sources examined, dead ends, threads, per-entity summaries. A ledger with embeddings, never a graph.

**Edit profile** — genre as a parameter set applied after alignment: duration, pace, cut grammar, captions, loudness. Cut and Shorts are two.

**Evidence ledger** — every claim's receipt: the moment, the quote, the span, the judge's label.

**Footage-hour** — the meter: an hour of footage read once. Editing never uses any.

**Ghost** — a block with everything except the media: quote, source, timing. Dashed gold. Holds its place until the clip is grabbed.

**Hand rule** — a decision made by hand in the Editor (kept by hand · cut by hand), stored as a rule so it survives re-solving.

**It noticed** — the Editor's line about the sound: hum, music under, overlap; one fix each, recommended first.

**Judge** — the step that decides, per claim, whether a candidate moment backs it: supports · related but not enough · nothing. Returns the backing line.

**Judgement call** — an uncertain block the system shows with a recommended answer and an alternative.

**Projects** — the Footage tab for what you've made; open one and the room resumes where you left it. *Not* "Made" (retired label).

**Highlights** — the Footage tab for the moments the read picked out, by thread; Mine · External · All. The user-facing word for moments in the archive.

**Videos** — the Footage tab for your recordings, each with its read status and transcript.

**One Take** — the name of this release: one room, one continuous conversation. Handoff v3.

**Room** — the product's single surface. *No project* (the front door and your footage) or *a project* (the rules, the cut, the player).

**Mission** — a card asking the user to grab one external clip: deep link at the in-point, in/out, the quote, why it matters, expiry. Generated from the cut.

**Moment** — the unit of footage: a span of one source with its words, speaker, thread and timing. Two sizes: parent (topic span) and child (utterance). *Not* "clip".

**Move** — what a line is doing in the argument: claim · evidence · turn · context · example · abstraction · joke · transition · conclusion. Sets the picture's job.

**Outside** — beyond the user's footage, where Scout looks when he's in a project. Settings: On · Per project · Off. External moments are linked, never downloaded.

**Plan** — the said / shown / proves-it board for a video-sized brief: claim, beats, finds, narration, sources. The one place the flow pauses. *In `design/next/` (doc 21) the plan is the room: acts → sections → the two-column script, playable.*

**Provenance** — where a moment came from: yours · external (scouted · mission · acquired · verified) · yours-doc.

**The Read** — what the system saw in the footage, in plain, observable language. Also the Read's corpus sizing.

**Receipt** — the proof behind a claim, shown: a quote with its source and time, or a document with its line marked. The **receipt shot** lifts the source into the chart or the type.

**Scout (the character)** — the part of Aldershot that makes a video better than your footage alone: he finds what it's missing (the proof, the other side, the original, the context) — switched on for a project he researches the whole video with you; asked directly any time. a state indicator with a shape (idle · looking · found · thin · mission · off) that appears only on rows and panels that searched beyond the user's footage. Default name Scout; the user can rename him. The labs call him Recce. Never celebrates. *Not* "the robot", *not* "the assistant".

**Recipe** — a saved rule set, applied to new footage with a diff.

**Rule** — a plain-language policy the engine re-applies: keep, drop, order, gap, cap, len, hook, count, avoid, fx, must-keep. Numbered, switchable, each showing its effect.

**Scout** — the search beyond the archive: behaviours, counterpoints, four query families, verified rows, a board, missions.

**Shorts** — the Editor's mode and the product's word for vertical clips. Strong · Worth a look · Long shot. *Not* "Clipping", *not* "clips".

**Spine** — the organising principle of a format (argument · chronology · source-clip · person · conversation · task · comparison · pattern · fragment · performance · exposition · live). Internal; the user never sees the word.

**Story** — the chronology pillar: what happened, in order. Rules: keep, drop, order = time, the day on screen at each change.

**Strand / thread** — a topic running through the footage. "Strand" in code (`footage.js`), "thread" in copy.

**Style Card** — what the Editor has learned from keeps and cuts, as sleeping rules the user wakes or switches off.

**Supercut** — the pattern pillar: every moment about a phrase, strung together, nothing else in. One keep rule naming the set of moments (`cids`), order = time, a count on screen.

**Voice beat** — a row in the cut for the user's voice: a gap after a thread, a narration line, an inserted line or reaction. Yours to record or rewrite.

**Tabs** — the centre column's views: Footage · Blocks · Words · Shorts. *Not* "zoom" or "Overview" (retired).

---

*Added 20 Nov 2026 with doc 21 (`design/next/`):*

**Section** — a plan beat at film scale: a title, an act, and a job — it *raises* a question or *answers* one. A 20-minute film has 8–12. The user-facing word; *beat* in code.

**Two-column script** — a section's blocks as rows: picture on the left, sound on the right, each with a duration. The plan, the script and the timeline at different zoom levels.

**Sound weave** — the sound column across the whole film: **your voice** (recorded or draft), **in their words** (the source speaks for itself), **breathe**, **silence**. The sound column alone is a radio cut.

**Rough film** — the plan played before the footage exists, every gap a ghost drawn by type. Watchable from the first minute.

**Drawn** — a finish: the whole film as motion graphics and your voice, every recreation labelled. A sketch, or the finished cut.

**Trailer** — the whole film compressed to about a minute and a half, rough or drawn. *Not* "short" (Shorts are vertical clips).

**Sketch** — the label on anything drawn in code for the film (orbits, charts, signal paths). Yours to approve. Not a character — Scout is the only one.

**Note at the playhead** — something said or typed while the film plays, pinned to that moment and routed: Scout · Sketch · move · trim · timing · script.

**Lens** — a way the one room reads the same film: **Film** (section cards), **Script** (the film as a radio script), **Needs** (every block by its one action). A lens changes how the middle column reads, never where you are. *Not* "tab" or "page" — there is one room.

**Watch what changed** — the short reel that opens a session: only the blocks whose status changed since you were last here, played in order. The user-facing name; *the overnight reel* in code.
