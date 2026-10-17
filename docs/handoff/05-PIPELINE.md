# 05 · Brief to first cut

## Where it happens

Everything below runs in the room (`02-SCREENS.md`). With no project open, the left column is the front door and the centre is Footage; starting something opens a project. An Essay's plan is a state of the centre column — the claim card and the beats, with the one stop — and *Cut it* turns it into the project. Every system turn is a line in the conversation above the composer.

| The user | Opens |
|---|---|
| Cut card · attach + "tighten this" | a project on the seed rules, scoped to the attached footage |
| Shorts card · "shorts from this" | the same rules in Shorts |
| Essay card · "a video about…", "argue…", "explain…" | the plan (sized → claim → beats → found), then the project |
| React card · "react to…" | asks for the video being answered; then rules with room for your answer after each of their threads |
| Story card · "as it happened" | the working-out, in recorded order |
| Supercut card · "every time I…" | every moment about one thing, nothing else, in order |
| "where do I talk about…" · "every time I mention…" (no rule verbs) | an answer in the conversation with receipts — with or without a project |

## Intent

The user types a sentence. An intent parse decides the flow; it is the only place a genre word is read.

| The sentence | Flow | Notes |
|---|---|---|
| "tighten this", "cut it down", footage attached and nothing said | **Tighten** | the seed rules; no questions |
| "shorts from this", "clips", "vertical" | **Shorts** | shorts profile; length and count presets |
| "a video about…", "why…", "essay", "argue", "make the case", "explain", "deep dive" | **Plan** | video-sized → the five steps |
| "react to…", "my take on…" | **React** | source-clip spine; the react rules |
| "find…", "show me…", "every…", nothing attached | **Search** | answers in the thread; results on the canvas |
| anything with a cut on the canvas | **Rule** | the sentence becomes a rule with a diff |
| unparseable | honest reply | what it can do, with chips |

The parse yields `spine` (argument · chronology · source-clip · person · conversation · task · comparison · pattern · fragment · performance · exposition · live), `stance`, `edit_profile`, `audience`, `length`, `platform`. The genre word is stored and discarded; the writer never sees it.

## The Read

Footage is read once. The Read is the model summarising the moments' labels and the OCR'd numbers — *observable only*: "three streams, the same three subjects every time, every number down between them." Never "he's narcissistic." It names the kind (THREE VLOGS · ONE PERSON · WORKING SOMETHING OUT), the threads, what it found (mic checks, hedges, where it lands), and what it noticed about the sound. Corpus sizing lives here for video-sized briefs: **huge / moderate / thin**, with what that means ("two beats will be thin").

## The plan (video-sized briefs)

Seven stages shown as a strip: BRIEF · SIZED · CLAIM · BEATS · FOUND · PLAN · FIRST CUT.

1. **Sized.** Count moments of the user's that speak to the subject; estimate outside coverage if looking outside is on. "Moderate — 11 moments of yours, three vlogs; two beats will be thin."
2. **Claim.** One sentence, sharpened from the brief and what the footage keeps returning to. Shown as a card. Editable in a sentence.
3. **Beats.** Five to seven. Roles: *his case* (subject), *against* (counterpoint — mandatory, at least two), *outside voice* (someone else). Each beat: a name, what it must show, estimated coverage. **This is the one place the flow stops.** Cut / Keep per beat; "drop the hedge beat"; "add a beat about the job". Then "go find it".
4. **Found.** For each beat: the user's library first (hybrid retrieval + the judge), then outside if the project allows it (Scout). Results per beat: moments found; outside finds as **ghosts**; **narration only where the footage can't say it**, marked *yours to record or rewrite*; thin beats in red with three options (a card · your voice · switch outside on).
5. **Plan.** The said / shown / proves-it board: each beat's moments, its picture job (from `08-PICTURES-AND-VOICE.md`), its source. Nothing is cut yet.
6. **First cut.** Cut it → rules: keep the plan's moments; the plan's order as rule 03; must-keep pairs for claims and their qualifiers; the pictures rule; attribution for external clips. Narration lines become voice beats. Ghosts hold their place. The result: *10 moments · 7:30 · 1 ghost to grab; previews are drafts until then.*

Say less per turn; the centre column carries the detail. Gold chips send immediately.

## Essays from a thesis

Drafting from a bare thesis is allowed. What failed earlier was drafting from a *genre* with no plan. The model drafts beats and scratch narration from the plan in a plain register with a fixed instruction (plain declaratives, no rhetorical questions unless listed, no teaser language) and a deterministic stoplist of genre markers. The user's own words win wherever they exist (a transcript, notes, a pasted essay); the **interview** — talk for a minute to each receipt — is only for when there is no material yet. The one sanctioned writing touch is a hook line compressed from the claim, generated after the piece exists.

A pasted written essay converts by: opening on the anecdote not the thesis; receipts out of the sentences and onto the screen as documents; numbers shown not said; first person → to camera; abstractions → diagrams built from real numbers. `labs/Essay to video.dc.html` is the worked example.

## Shorts

Candidates come from the cut's moments scored for strength and resolution; filtered by the user's rules (your rules apply to shorts too), by length window, by hook, by avoid topics, by count. Each candidate shows **Strong / Worth a look / Long shot** and a reason ("opens slow — 11 words before the first full stop"). **A fragment is valid only if** it holds a claim and its evidence, every referent resolves, its meaning entails the parent's, and it ends on a beat boundary — these become reasons ("leans on the line before it", "ends mid-thought").

## React

Footage can be the user's own, a pasted URL, or found by Scout ("react to his latest stream" with outside on). Rules the planner enforces: commentary adjacent to every clip; warn below 1:1 commentary-to-source; clip length by what the commentary needs; a ±30–60 s fairness check that the clip's meaning holds in context. Reaction slots carry a drafted move (correct · contextualise · agree-and-extend · mock · predict); the user's reaction is free speech, not a script.

## Revisions in plain feelings

| They say | It changes |
|---|---|
| "the start drags" | open on the sharpest line |
| "hard to follow", "confusing" | one thread at a time; a context beat |
| "tighter", "punchier", "too long" | a cap |
| "she needs more room" | longer holds on her blocks |
| "flat" | the turn earlier; a receipt moved up |
| "I don't believe it" | the receipt shot for that claim; the counterpoint voiced |

Each is a rule with a diff. Autonomy scales with confidence: when it's sure, it decides; when there's a real choice, it picks one and puts the alternative within reach; it stops only when meaning changes, and batches those questions.

## One step ahead

At upload: three possible videos. While typing: retrieval starts before enter. After the first draft: tighter and more-room versions pre-rendered as proxies, and the Shorts. Before you notice: "block 3 has no visual proof — use the council minutes?" Over time: what you always ask for second, it does first.

*Rests on:* `labs/FORMATS.md`, `labs/EDIT-ENGINE.md`, `labs/SCRIPT-AND-TIMING.md`, `labs/DOSSIER.md`; the prototype's Home flows.
