# Pictures — the gavel problem

v2 · 7 Oct 2026. v1 came from the measured-evidence pass; v2 folds in the decision-layer pass. Nothing here is built. This is the layer between "what is the line about" and "what should we show" — the thing every script-to-video tool today gets wrong.

## The one-line version

**The gavel is a representation failure, not a retrieval failure.** Every measured script-to-visual system keys pictures on words in the narration. The fix is to make the plan say, for every block, *what the picture is doing to the sentence* and *what the viewer must be able to say afterwards* — and to choose pictures against that, and against what has already been shown. Then write the narration last.

## What changed from v1

1. **Relation, not just move.** v1 classified the line's move and let it set the picture's job. v2 adds the relation as fields: *status* (words lead · picture leads · equal), *job* (elaborate · extend · enhance · project · contrast), and *viewer can say* — one sentence the viewer should be able to state after the block. The move sets defaults; the relation is what gets checked.
2. **The gavel detector is computable: fit-anywhere.** A picture that fits any sentence about the topic equally well is noun-level only. In Otto et al.'s terms the stock gavel is "Illustration" at noun level and "Uncorrelated" at proposition level — and Uncorrelated is the class machines are worst at (45% recall). Check at the proposition level or not at all.
3. **Redundancy has two kinds.** *Propositional* redundancy (the picture shows the claim) is the comprehension default — keep it. *Lexical* redundancy (on-screen text repeating the narration) hurts — ban it. Unmotivated dissonance overloads — budget it.
4. **Pictures before words.** Narration is written last, over secured pictures — the only order in which "don't narrate what's on screen" can be enforced. This is the pre-production order.
5. **Motifs are planned; repetition is authored.** Unplanned repeats are errors.
6. **Judge by decomposed questions, pairwise per slot** — holistic taste doesn't agree with itself.

## Why shallow matching is wrong, not just bland

- **It's what editors do, so models learn it.** Adobe's B-Script (CHI 2019) found editors choose B-roll from the *concepts mentioned in the narration* and trained on their choices. Its queries came out as generic nouns ("people, life, thing, guy") against experts' specific actions ("lifting weights, burned out") — literalism and repetition in one table. Transcript2Video averaged 2.7 repeated sub-clips per sequence. The best editing agent on Timeline-Bench (Sep 2026, unreviewed) resolved 26.8% of tasks; humans preferred the reference edit in 83.5% of blind judgments. Diagnosis: agents perceive footage as stills plus transcripts and check renders for defects, not craft.
- **The gavel moves belief.** A related but non-probative photo makes a claim more likely to be judged true (Cohen's d ≈ .23), the effect survives 48 hours, and it's strongest for unfamiliar claims. For a tool that makes commentary from other people's footage, a stock gavel over "the court ruled" is an integrity problem, not a style problem.
- **There's a vocabulary for what a picture does to a sentence.** Martinec & Salway (status × logico-semantic relation, from Barthes and Halliday), operationalised by Otto et al. (ICMR 2019) into eight classes with α = 0.847 between annotators; Alikhani et al.'s coherence relations (Visible · Subjective · Action · Story · Meta · Irrelevant). The gavel's signature: its *only* relation to the line is "depicts a noun in the sentence" — Meta at best.

The one-line rule: **the picture answers "why am I seeing this," not "what word did the sentence contain."**

## The block, with its relation

What a plan block carries (the user sees one of these — *viewer can say* — the rest is internal):

| Field | Values | What it's for |
|---|---|---|
| move | CLAIM · EVIDENCE · TURN · EXAMPLE · CONTEXT · ABSTRACTION · JOKE · TRANSITION · CONCLUSION | what the line is doing in the argument |
| role | to camera · exhibit · document · card | who or what is in the frame, and what the sound does (from the essay board) |
| status | words lead · picture leads · equal | which mode carries the block |
| job | elaborate · extend · enhance · project · contrast | what the picture does to the sentence |
| viewer can say | one sentence | the proposition the block must land |
| fit-anywhere | low · high | the gavel detector |
| source | own · documents · open world · generated | and whether generated is even allowed here |
| reprise | none · scheduled (motif) · unplanned | authored repetition vs error |

**Move → defaults:**

| Move | The viewer needs | Default job · status | Source, in order | Gavel risk |
|---|---|---|---|---|
| CLAIM | to know who asserts it, and the proposition itself | elaborate — show the *proposition*, not the topic · words lead | own footage → documents | high |
| EVIDENCE — "the committee voted 5–2" | to see the proof | project / exemplify — the artefact itself · picture leads | documents → the real quote set as type | **highest** — a stock stand-in manufactures truthiness |
| EXAMPLE | concreteness | exemplify — one instance, never a category icon · equal | own → open world | medium |
| CONTEXT | orientation | enhance — time, place, cause · words lead | archive → open world → generated diagram | low |
| TURN / CONCESSION | to feel the shift | contrast (or extend) · equal | any — the collision is the point; reprise allowed | medium |
| ABSTRACTION — "the economy" | a model of the idea | enhance — a chart *from real numbers*, or type for the key phrase | documents → generated graphic, labelled | high if it's a stock chart |
| JOKE | timing | contrast / ironic relay, or nothing · picture often leads | own | low — literalism kills it |
| TRANSITION | continuity | extend — a motif reprise · equal | a shot already shown | low |
| CONCLUSION | synthesis | condensed — reprise of the motifs; the viewer completes it · picture leads | reprises | medium |

A planned misdirect (a "red herring" picture, deliberately wrong-footed) exploits the truthiness mechanism on purpose — it is allowed only with a scheduled payoff block. Without the payoff it's misinformation.

## Redundancy — the actual rule

- **Propositional redundancy is the default.** TV-news studies: tight picture–word correspondence raises recall and understanding (Drew & Grimes 1987; Reese 1984); even mild audio-visual dissonance overloads viewers (Grimes 1991).
- **Lexical redundancy is banned.** Mayer's redundancy principle: narration + graphics beats narration + graphics + the same words on screen. So typography sets the *key phrase*, the *real quote*, the *number* — never the whole line. (Mayer's medians are ceilings: independent meta-analyses land around g ≈ 0.37–0.39, not his 0.68–0.87.)
- **Counterpoint is earned.** On turns, jokes and conclusions; one element must be semantically open (an ambiguous face, an archive fragment — the Kuleshov effect is real but modest); capped per minute. Montage theory says motivated dissonance *makes* meaning (Eisenstein's "ear + door = listen"; Curtis's ironic counterpoint and reused shots "to generate patterns"). The news literature says unmotivated dissonance just costs attention. The budget is how you get both.
- **Abstract claims are where type and captions add most** (Reese: captions helped abstract "word" stories, not concrete "picture" stories).

## Pictures before words — the pre-production order

1. **The argument**: claims, the evidence for each, the concessions against, the examples, the conclusion. (A graph, kept invisible — the user sees blocks.)
2. **What must the viewer see**, per block — the proposition the picture has to carry.
3. **Find and check the picture** against it (*viewer can say* · *fit-anywhere*), own footage → documents → open world → generated where allowed. **"Nothing to show" is a result** — a hold or a card. A claim with no picture *anywhere* is the real "missing shot."
4. **Write the narration last**, to complement what the picture now carries: say what it *means*, not what it shows. In a spoken register (below).
5. Re-check coherence; schedule the motifs and their reprises.

Documentary editors already work this way — narration written last, over the cut. Pearlman's account of editing as distributed cognition ("watching, sorting, remembering, selecting and composing… from a mass of unscripted material") is why Australia now credits documentary editors as co-writers. A director pass that only reads a script can't do this; it has to watch candidates, and its picks have to be revisable — sort, pin, reject — not one-shot.

## Motifs and memory

Before per-block selection, choose 3–7 **motifs** for the whole piece, each bound to a claim: first appearance plain (propositional redundancy), then transformations (crop, recolour, type overprinted), then scheduled callbacks at argument boundaries. Keep a **visual memory** per project: every shown asset carries a motif id and a "deliberate?" flag; retrieval penalises unflagged repeats and rewards scheduled ones. Reprises land best where the argument changes (event-segmentation research: viewers chunk on *action* discontinuities, barely on space/time).

## Pace

- **Block boundaries are argument changes.** Visual changes that don't coincide with one read as texture, not structure. (Refines the earlier "one visual beat per sentence": one *block* per move; shots inside it by load.)
- **Duration follows information load**: roughly 1.5 s per extra entity in frame (Cutting), plus on-screen text length; long holds on evidence and conclusions; breathe at section openings and closings. A fast mean with deliberate holds, not a constant.
- **Cut on narration stress peaks and motion onsets** (Smith's attentional theory of continuity). Narration is the glue that makes jump cuts and mosaics readable — edit blindness mostly disappears without audio.

## Narration that reads as speech

Grounds the earlier rule "the model writes from your words, never from a brief":

- Measured (Reinhart et al., PNAS 2025): instruction-tuned models use present-participial clauses 2–5× and nominalisations 1.5–2× human rates, certain words 100×; prompting "sound casual" doesn't fix it; base models are closer to human. Biber's Dimension 1 separates *involved* speech (pronouns, finite verbs, present tense, explicit connectives — *so, but, which means*) from *informational* writing (nouns, prepositions, adjective stacks). Default model output sits at the wrong pole.
- **Rules:** score each line on a Dimension-1 proxy and regenerate over threshold · one proposition per breath group · write to picture — meaning, not description · a blocklist of measured AI-isms plus the user's own tells · structural bans (no participial openers, no tricolon padding, no "it's not X, it's Y" unless the block is a turn) · a register pass toward the user's own transcribed speech. These are the "three deterministic checks" from the earlier research pass, with evidence under them.

## Typography as a voice, not a subtitle

Jobs: **projection** (the real quote, in the speaker's words — a different voice from the narrator), **signaling** (the number, the key term), **affect** (motion: size and velocity carry energy; transparency, direction and regularity carry mood — Lee, Forlizzi & Hudson 2006). Never a verbatim subtitle of the narration. The McLuhan/Fiore probe as a rule: each type frame poses what the narration answers, or answers what it poses. Curtis's *TraumaZone* shows captions plus archive can carry a long-form argument with no narration at all. Evidence base is thin (small HCI studies) — a design hypothesis grounded in Mayer's signaling and redundancy results. **Shorts' burned-in captions are a different thing** — muted platform viewing — and stay.

## Generated imagery — where it earns its place

**Earns it:** storyboards and previs (never shipped) · diagrams and charts generated *from real numbers* · clearly labelled reconstructions of events that weren't filmed · title and transition texture carrying no factual weight.

**Is the gavel again:** any photoreal image over an EVIDENCE or CLAIM line · generated "archival-looking" footage · generic generated people standing in for real speakers · anything filling a slot because retrieval scored low — fix the retrieval instead.

**Rules:** generated frames may appear in the *plan* at any tier as previs, but the plan must visibly mark which blocks still lack a real source, and a generated frame reaches the final cut only with a label. Previs misleads exactly when a finished-looking frame stands in for evidence that doesn't exist. The generated-storyboard field measures *identity consistency* across shots and has no metric for whether a shot serves the point.

**Provenance** (Archival Producers Alliance): watermark generated material during the edit; export a **cue sheet** of every generated element; a persistent on-screen bug; an end-credit listing. Watermarks complement visible labels, they don't replace them.

## Judging "serves the point," not "matches a noun"

Holistic "which edit is better" barely agrees on single edits (κ ≈ 0.15, judge-vs-humans *and* human-vs-human). Decomposed binary questions agree well (κ 0.8+ in CITE and Clue). Pairwise comparison per slot works (EditDuet: 80.6% agreement with humans).

**The Gavel Test Set.** 150–300 blocks from real scripts, stratified across moves. Per block a contrast triple — (A) the noun-match, (B) a proposition-match, (C) a deliberate counterpoint — plus hard negatives (contradicts the claim; unrelated). Questions per candidate: shares an entity with the line? · could a viewer who saw only the picture state the claim? · adds information the line doesn't? · contradicts it? · **would it fit equally well under a different sentence about the same topic?** (the gavel detector) · seen before, and marked deliberate? · source tier labelled right? Metrics: proposition-fit rate · gavel rate (entity-match ∧ not-claim ∧ fits-anywhere) · unplanned-repetition rate · pairwise win rate against the human pick. Calibrate a model judge on the same questions, on **clips with audio, not stills**, and trust it only where its agreement matches human–human.

## What this changes in Aldershot

- **Plan blocks gain one visible line: "After this, the viewer can say: …"** — the proposition the picture must land. Move, status, job, fit-anywhere, source and reprise travel with the block but stay internal.
- **The pre-production order is pictures before words**: argument → what must be seen → secure the picture (or "nothing to show") → narration last, in a spoken register. This is the ladder for the essay-from-a-thesis discussion, and it's the reverse of today's flow (thesis → points → footage).
- **Four rules, in the product's vocabulary**, each switchable with its effect: *Pictures carry the claim, not the topic — nothing that would fit any sentence about the subject.* · *Type sets the quote and the number, never the line.* · *Repeat a shot only on purpose.* · *Collisions only on turns, jokes and endings.*
- **"Nothing to show here" is a legitimate output**, rendered as a hold or a card.
- ***Before you post* keeps the cue sheet; the ledger gains each block's "viewer can say" and its picture's source.**
- The labs plan page would read better as *must-see → picture → said*. Not built.

## Sources

- Taxonomies: Martinec & Salway (Visual Communication, 2005); Otto, Springstein, Anand & Ewerth (ICMR 2019); Alikhani et al., CITE (NAACL 2019) and Clue (2020); Chion, *Audio-Vision*; Blair, Groarke, Kjeldsen on visual argumentation.
- Comprehension: Mayer & Fiorella (Cambridge Handbook, 2014); Mayer 2017; Cromley & Chen (Educational Research Review, 2025); Noetel et al. 2022; Drew & Grimes 1987; Reese 1984; Grimes 1991; Lang 1995; Fox et al. 2004.
- Editing cognition: Pearlman, in Brylla & Kramer (eds.), *Cognitive Theory and Documentary Film* (2018); Smith, Attentional Theory of Cinematic Continuity (Projections, 2012); Levin & Simons 1997; Simons & Levin 1998; Magliano & Zacks (Cognitive Science, 2011); Cutting, DeLong & Brunick on shot length.
- Montage and practice: Eisenstein's five methods; Kuleshov (and Prince & Hensley's recreation); Adam Curtis interviews and criticism; *TraumaZone*.
- Prior systems: Huber et al., B-Script (CHI 2019); Xiong et al., Transcript2Video (ACM MM 2022); EditDuet (SIGGRAPH 2025); LAVE (IUI 2024); ReelFramer (CHI 2024); ShotBench (NeurIPS 2025); Timeline-Bench (arXiv, Sep 2026, unreviewed); StoryAgent, VideoDirectorGPT, CANVAS, StoryMem, EntityBench.
- Register: Reinhart et al. (PNAS 2025); Biber's multidimensional analysis; Biber et al. 2002.
- Typography: Lee, Forlizzi & Hudson 2006; Forlizzi et al. 2003; Jin 2013; Fiore & McLuhan, *The Medium is the Massage* (1967).
- Truthiness: Newman et al. 2012; Zhang, Newman & Schwarz. Provenance: Archival Producers Alliance best practices.
