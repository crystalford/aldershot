# 09 · Export and integrity

## Before you post

The export step. A checklist, each line a plain sentence with one-press fixes, the recommended one first. It is where the system says what it knows and what it can't know.

| Line | What it checks | Fixes |
|---|---|---|
| **Other people's footage** | fingerprint match against sources marked as someone else's — *a probable match, never a clearance; it can't tell you what's fair use* | attribution card at first use + dispute file (Recommended) · dispute file only. External clips are linked, never downloaded; captured only by you; traced to the original where found |
| **Music** | music under a stretch | duck it (Recommended) · leave it · replace with the licensed bed |
| **Faces** | someone else appears | leave · blur · ask |
| **Generated segments** | every picture typed evidence / illustration / synthetic; the type sets the label | the on-screen label the law expects; the **cue sheet** (what, how made, when) exported with the project; never photoreal, never the proof; over a claim only as a depiction a person chose, labelled "Depiction · made with AI" |
| **Attributions** | every external clip has a credit at first use | write them (Recommended) · edit · remove (explicit toggle) |
| **Sound and captions** | loudness about −14 LUFS, peaks under −1 dBTP; music ducked on the words; captions ≤17 characters a second; a subtitle file alongside; no stacking on burned-in subtitles | checked on every export, not offered as a fix |
| **Provenance record** | every source, every edit, and for each claim the line in the footage that backs it; existing records kept, not stripped | always on |

Shorts' burned-in captions are exempt from the sidecar rule — muted viewing is a different medium.

## Labels and the law (dated)

EU AI Act Article 50 transparency duties apply from **2 August 2026**. The Commission's code: three icons — fully AI-generated, **AI-modified (explicitly including object removal and face or voice replacement)**, interactive layer — perceivable at first exposure; metadata + watermark + label together. Aldershot is plausibly both a provider (when it generates pixels or voice) and a tool used by deployers; build both duties in. The product never has to be asked to label: the picture's type drives it.

## The cut ledger and the dispute file

Every variant carries **what was cut and why** — spans removed, the rule and solver version that removed them. The left-out list with rule numbers (Footage → Highlights inside a project) is this ledger shown live; export publishes it. The **dispute file** per video lists every external clip's source, timestamp, fraction of the original used, commentary-to-clip ratio and the attribution written — evidence of transformative use, assembled as the video is made, not after a claim.

## The integrity envelope

Propositions every variant must preserve: a claim and its qualifier, an accusation and its response, as **must-keep / never-separate** rules. They are solver constraints — a variant that would split them does not render. This is what makes the fragment self-sufficiency test a guarantee rather than a check, and what lets length be a dial without context collapse.

## React mode — design rules, not legal advice

From the leading reaction-video case: interspersed short source segments with substantial commentary were "quintessential criticism and comment"; a watch-along without commentary is different. So the planner enforces: commentary adjacent to every source clip; a warning below 1:1 commentary-to-source time; clip length set by what the commentary needs; the **fairness guard** — retrieve ±30–60 s around every quoted segment and check whether its meaning changes in context (a reversal, a hypothetical presented as assertion, someone else's words) — a flag blocks the beat until the user widens the clip or adds the context in voice. Have a media lawyer review before commercial publication.

## Receipts for the viewer

The evidence ledger is also a **receipts page** published with the video: moment, quote, original link, verification state. "The edit you can interrogate" is a promise to the audience, not just the maker.

## Export formats

MP4 (1080p / 4K / ProRes per the default) · a sidecar subtitle file · the provenance manifest · the cue sheet · the dispute file · **OTIO** (plus FCPXML / EDL) of the compiled timeline as the escape hatch to Resolve or Premiere — lossy for kinetic type and ducking curves, and that is fine. A webhook can receive the finished pieces.

*Rests on:* `labs/STRATEGY.md`, `labs/FORMATS.md`, `labs/SCRIPT-AND-TIMING.md`, `labs/SCOUT.md`, `labs/VISUAL-SUPPLY.md`; the Editor's Before you post.
