# 07 · Scout, missions, ghosts

The archive answers "what do I have?" Scout answers "what would make this video better?" — the proof a claim needs, the other side, the original a clip came from, the context a viewer is missing. Finding footage outside is how he does it, not what he's for. It is the open-world step in the pictures source order and a state of the room — not a new surface. **To build it, read `18-SCOUT-BUILD-SPEC.md`.** Research: `labs/SCOUT.md`, `labs/SOURCES.md`, `labs/DOSSIER.md`. Labs screen and fixtures: `labs/Scout.dc.html`, `labs/scout-sample.js`.

## Scout is a choice per project, not a trigger

Scout is switched on for a **project**, not set off by thin footage. You bring him in when you want the video to be comprehensive — a full essay on DSP, a react that answers properly — and he works through the whole project: sourcing every beat, finding the other side, tracing clips to their originals, adding context. When he's in, the plan's beats are researched by both your footage and Scout from the start; a thin beat is just one of the things he fixes.

- **Settings → Scout**: *On* (every project) · *Per project* (default: offered when you start an Essay or a React; one tap, "Bring Scout in" / "Your footage only") · *Off*.
- **Per project**: the plan says whether he's in ("Scout's on for this one — he'll research every beat with you"); one chip switches it before anything is searched.
- **Asked directly**, any time: "Scout, find his latest stream", "find the clip where she says…".

## What Scout does

0. **Behaviour-first decomposition.** The thesis becomes things a viewer could point to on camera. The planner **refuses psychological claims** ("narcissistic" → "berates chat", "bans viewers mid-stream"). Counterpoint beats are **mandatory**: the inverse of each subject beat, personas (his moderator, a sympathetic viewer, a critic, a neutral journalist), and detractor conduct.
1. **Four query families in parallel**: direct · community vocabulary (nicknames, catchphrases, critic channels harvested from top results) · crowd-indexed (compilations, timestamp threads, incident lists, clip view counts) · counterpoint (interviews, Q&As, apologies). Then spoken-phrasing expansion for transcript search.
2. **Metadata triage** before any transcript is read; keep 5–10 per beat. Platform search calls are the scarce resource.
3. **Map–reduce scan**: a small model reads ~2K-token windows with one narrow question each and may answer NONE; the lead model sees **only verified ledger rows**, never a transcript.
4. **Verify deterministically**: the quote string-matched against the stored transcript; **timestamps from word timings, never the model**; fuzzy ≥ 0.9 accepted, 0.8–0.9 flagged, below rejected. Log the rejection rate — it's our measured hallucination rate.
5. **Snowball** from verified rows (phrases, dates, critics, compilations → originals).
6. **Stop on two conditions**: diminishing returns (the knee) *and* coverage (≥2 verified per subject beat, ≥1 per counterpoint, or the gap is listed with the queries tried).
7. **The board**: rows by beat (VERIFIED · CROWD · TRACE), a balance meter (subject vs counterpoint, shown as effort as well as results), a sourcing meter, a gap list, a diligence log export.

Rage moments are where captions are worst (~30% word error on shouted speech) — find them through clip offsets and crowd timestamps too, lag-corrected ~20 s.

## Sources — what Scout can actually reach

| Tier | Sources | Scout can |
|---|---|---|
| Read (searchable by words) | GDELT TV News (US TV captions since 2009), podcast RSS (public audio; transcribe where no transcript ships), the user's own captures | find the moment, quote it, link it |
| Link only (metadata) | YouTube (titles, descriptions, chapters, comment timestamps; **100 searches/day per project since June 2026** — discovery runs on channel RSS, push notifications, web search and `videos.list`), Twitch (clip offsets, view counts; VODs expire 7–60 days) | find the video, point at the moment |
| Owner-connected | your YouTube, your Twitch clips, your Vimeo | pull your own content officially |
| Not usable | X (paid, no reuse), Kick, Reddit, Rumble | — |

**Scout finds and links. It never downloads.** Platform policies forbid it; a SaaS dies from bans, not bad code. The Scout app and extension are capture tools for the user's own lawful use — never marketed or built as downloaders.

## Acquisition — hybrid

- **Auto** only from sources open by design (podcast enclosures, PD archives, connected own accounts): fetched, transcribed, verified by duration and hash.
- **Mission** for everything else, YouTube included. The mission card: deep link at the in-point, in/out, the quote, the source, why it matters, an expiry badge. The user grabs it (extension tab-capture, native screen recording, or their own tool) and drops it in.
- **Match-back**, cheapest first: the attached moment id (verify, don't search) → transcript alignment against the scouted quote → audio landmark fingerprinting → frame hashes for silent clips. Verdicts `verified` (≥90% coverage, ±1 s) · `partial` (missing words shown) · `mismatch` (said plainly). Never silently accept a near-miss.
- States: `scouted → mission → acquired → verified → used`, plus `failed` with reason.

## Ghosts

The cut does not wait for acquisition. A **ghost** is a block with everything except the media — quote, source, timestamps, duration from the transcript plus a one-second handle each side. The engine cuts it like any block; it renders as a dashed gold tile. **Missions are generated from the cut**: only the clips the video uses, in timeline order, expiring sources first; cut a block and its mission disappears; a grab fills the hole in place. Previews with ghosts render as drafts. A final render asks per remaining ghost: hold for the grab · drop the beat (the solver re-cuts) · a quote card with the attributed words. **The video never ships with a silent hole.**

## Attribution — automatic, through the timeline

Default credit for every external clip: a small lower-third *Source: [channel] · [platform] · [date]* for the clip's first 3–4 s; chains credit the original (*via* the compilation); a timestamped source list in the description; metadata on the clip in the exported timeline so it survives round-trips. Editable per clip; **removal requires an explicit toggle**.

## Scout, the character

Scout's job is **better videos**, not gap-filling. He reads the cut and the plan, sees what they're missing, and goes looking: **asked directly** ("Scout, find his latest stream", "find the clip where she says…", "react to his latest video" with outside on), **for a React** (the video being answered), and **on his own** when a plan's beat comes up thin. In the room he lives in three places: a resting row on the front door (*Scout finds what isn't yours yet* — click to ask him), the plan's beats header while he looks, and the rules area when the cut has ghosts. Everywhere else the system speaks as itself.

Looking outside has a face. His default name is **Scout**; the user can rename him once, in a sentence, and every line he says uses it (the pattern Meta's Muse arrived at from user research — an agent without a face or a name felt like talking to a logo). The labs call him **Recce** (British army slang for reconnaissance); that is a working name, not the product's. He is a state indicator with a shape, not a mascot. He is a scout probe — a pale forward-facing pod with a dark visor and one lens, two swept fins, a thin sensor mast with a light, a thruster at the back — because a scout is what you send out past your own footage. The shell is pale so he reads on the dark interface. He carries **one colour at a time, and it is the state**: teal out looking · green found and verified · gold a mission to grab · red thin · grey off — the same meanings those colours carry everywhere else. Six states — idle · looking · found · thin · mission · off — carried by motion, not colour: he hovers while waiting; while looking he leans in and flies, the flame long, the lens scanning with a searchlight sweeping ahead; he tilts down with a weak flame when thin, carries the mission card slung underneath; the iris blinks while waiting, dims when thin, goes dark when outside is off, and turns green with a small tick inside the lens for the half-second a find verifies. He appears only on rows and panels that went outside (Home's outside-search turns, the Scout board header, a ghost's mission row); the system's own rows keep the gold mark. He never celebrates, never has an opinion about a person, and speaks in the product's voice: *"Verified against the source at 2:13:58 · 96% of the words match · credit written."* Component: `labs/Recce.dc.html` (props `state`, `size`); showcase: `labs/Meet Recce.dc.html`.

## Memory

Every search, source examined and dead end is recorded (the Dossier). The second project about the same subject starts with the first project's vocabulary and captures. Standing queries and the night shift are deferred (`12-DEFERRED.md`).

*Rests on:* `labs/SCOUT.md`, `labs/SOURCES.md`, `labs/DOSSIER.md`; `labs/Scout.dc.html`.
