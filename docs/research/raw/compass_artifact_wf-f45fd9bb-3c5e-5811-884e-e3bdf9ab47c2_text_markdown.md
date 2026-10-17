# Aldershot Process Design: A Multi-Pass, Self-Questioning Pipeline for Source-Grounded Essay Videos

The evidence supports a short, fixed pipeline of roughly six passes. Each pass produces one inspectable artifact and stops on a deterministic condition, not on "until it's good". Errors are caught by external checks: retrieval, quote matching against the transcript, and entailment checks against receipts. Open-ended self-critique does not catch them. The user is interrupted at exactly three gates: hypothesis, verdict and a single clip pull session. For the worked example ("the psychology of [figure]: why the detractors are right"), the system's first job is to turn a pre-committed conclusion into testable sub-claims and search both sides symmetrically. Measured studies show LLM search and LLM assistants amplify whatever conclusion the prompt embeds.

## TL;DR

- **Use a fixed, gated pass sequence with external verification, not open-ended self-revision.** The sequence is Brief → Claim Map → Receipts → Verdicts → Spine & Script → Clip Plan & Pull List. Decomposed, outline-first systems beat direct generation: STORM was rated more organized by a 25% absolute margin and broader by 10%. Factored verification raised FactScore from 55.9 to 71.4. But intrinsic self-correction often degrades reasoning, and deep research agents regress on 16–27% of previously covered content when asked to revise.
- **Treat "why the detractors are right" as a hypothesis to test, not a brief to fulfill.** LLM conversational search measurably increases confirmatory querying, and opinionated models make it worse. In an ACL 2025 study of loaded political questions, GPT accommodated false premises 41.4% of the time and Mistral 64.1%. The pipeline should split the thesis into sub-claims, retrieve "for" and "against" with mirrored queries, and report which parts survive.
- **Video evidence needs a "clip receipt" and a one-sitting pull session.** In Koenecke et al.'s "Careless Whisper" study (FAccT 2024), 1.4% of 13,140 audio segments run through the Whisper API produced hallucinated text, and 38% of those hallucinations contained harms (19% violence, 13% inaccurate associations, 8% false authority). Spontaneous-speech WER is around 31% even for Whisper-large-v3. Every quote must therefore be re-heard against audio before it ships. YouTube's terms bar downloading unless the service expressly authorizes it, so the system should do all finding and timecoding and batch the user's physical actions into one session. Commentary use should be scoped to Canadian fair dealing for criticism/review, which requires naming the source and author. Psychological claims should stay at the level of observable behaviour, not diagnosis.

## Recommended vocabulary (use these names everywhere in the UI and agent prompts)

| Stage | Name | What it is |
|---|---|---|
| User's starting line | **Brief** | The raw one-liner plus any talk-first notes |
| Testable restatement | **Hypothesis** | The brief rewritten as a falsifiable question with scope |
| Decomposition | **Claim Map** | Atomic sub-claims, each typed (factual / interpretive / evaluative / predictive) |
| Evidence | **Receipts** | Exact quoted spans (text or transcript) with source metadata; clip receipts for video |
| Judgement | **Verdicts** | Per sub-claim: Supported / Mixed / Unsupported / Untestable, with the strongest counter |
| Structure | **Spine** | The fixed skeleton (Cold Receipt → Question & Promise → Context → Evidence Run → What Cuts Against This → Verdict & Limits) populated with verdicts |
| Narration | **Script** | The SAID column, beat by beat |
| Media | **Clip Plan** | Each clip bound to a sub-claim and a role (evidence / illustration / object of critique) |
| User task list | **Pull List** | The batched list of clips the user must fetch, with URL + in/out |

Retire "essay" and "arguments" as pipeline terms. "Essay" names the genre and "script" names the narration artifact. "Claim" is the unit of evidence, and "thesis" is what you call the hypothesis after the verdicts are in.

## Key Findings

### 1. Multi-pass architecture

**Measured**
- **Outline-first, question-driven pre-writing beats direct generation.** STORM (Shao et al., NAACL 2024) researches a topic through perspective-guided simulated conversations, builds an outline, then expands it section by section. Experienced Wikipedia editors rated more of its articles as organized (a 25% absolute increase) and broad in coverage (10%) than an outline-driven retrieval-augmented baseline.\[1\]\[2\] Its ablations showed that removing perspectives or the conversation step hurt outline quality. Questions generated without first reading relevant material were worse, so question-asking works best interleaved with retrieval, not front-loaded.\[3\]
- **Verification works when it is factored and independent.** Chain-of-Verification (Dhuliawala et al., ACL Findings 2024) drafts an answer, plans verification questions, answers them independently, then revises. On long-form biographies, FactScore rose 28% (55.9 → 71.4). The number of facts fell from 16.6 to 12.3, so precision rose partly because unsupported content was dropped. Factored verification beat joint verification (60.8 → 63.7). The mechanism is that individual verification questions are answered more accurately than the same facts embedded in long-form prose.\[4\]\[5\]
- **Intrinsic self-correction is unreliable for reasoning.** Huang et al. (ICLR 2024) found that without external feedback, models "struggle to self-correct their responses" and sometimes degrade. GPT-3.5 on CommonSenseQA fell to 41.8% after two self-correction rounds, and Llama-2 fell from 43.5% to 36.5% between rounds one and two on one benchmark.\[6\]\[7\] Tyen et al. (ACL Findings 2024) located the failure: models cannot reliably *find* logical mistakes, but they can *correct* one once told where it is.\[8\] Design implication: use external detectors (quote match, entailment, linter) to localize the problem, and use the LLM only to fix it.
- **Returns diminish fast.** In Self-Refine (Madaan et al., NeurIPS 2023), the largest gains come from the first one or two iterations, with "diminishing returns" thereafter and non-monotonic quality on some tasks.\[9\]\[10\] A 2025 self-review framework saturated after about three loops while processing time kept rising.\[11\]
- **Revision breaks things outside its scope.** MR DRE (Chen et al., 2026) evaluated five deep research agents. They address over 90% of requested edits, but "regress on 16–27% of previously covered content and citation quality." Prompt engineering and a dedicated reviser sub-agent did not fix it.\[12\] This is the strongest measured argument for scoped, diff-based passes.
- **Deep research output is still often unsupported or one-sided.** DeepTRACE (Venkit et al., ICLR 2026) found deep-research modes remain one-sided in 54.67–94.8% of answers. Citation accuracy ranged from 39.8% (GPT-4.5/5) and 40.3% (Gemini Deep Research) to 79.1% (GPT-5 Deep Research); the authors summarize this as "citation accuracy ranging from 40–80% across systems." DeepResearch Bench's FACT framework reported citation accuracy from 78% to 94% across systems.\[13\] A 2026 study, "Cited but Not Verified", found link validity above 94% but factual accuracy of only 39–59% for OpenAI models and 77% for Claude Opus 4.5. A valid-looking citation is not a supported claim.

**Inference (my synthesis, not directly measured)**
- Errors compound where one pass's output becomes the next pass's unquestioned input. The highest-risk joins are: (a) Brief → Claim Map, where the presupposition gets baked in; (b) transcript → Receipt, where ASR errors become "quotes"; and (c) Receipt → Script, where paraphrase drifts beyond what the span entails. Each join needs a deterministic check, not a "review".
- Show the user artifacts only where his judgement changes the outcome: the Hypothesis/Claim Map and the Verdicts. Everything else should proceed silently and be visible on demand.

### 2. The system's self-questions

**Measured**
- **Claim triage is a documented professional practice and an automatable task.** ClaimBuster scores sentences for "check-worthiness" and sorts them into non-factual, unimportant factual and check-worthy factual claims. Full Fact used a fine-tuned BERT model to classify claims (e.g., numerical claims) so fact-checkers could focus in limited time. Fact-checkers triage under deadline (Borel, 2016). Liu, Gwizdka & Lease (Proc. ACM HCI, 2025) studied 16 professional fact-checkers (14 full-time journalists and 2 former fact-checkers turned researchers) and "uncovered a hierarchical prioritization strategy that they implicitly use." Check-worthiness is subjective and multi-faceted, so the system should rank claims, not filter them silently.\[14\]
- **Structured analytic techniques have weak direct evidence.** In Dhami, Belton & Mandel (2019), 50 intelligence analysts were randomly assigned to use Analysis of Competing Hypotheses or not. ACH-trained analysts "did not follow all of the steps." Only 1 of 25 (4%) in the ACH group ranked hypotheses correctly, versus 4.9% of untrained analysts,\[15\] and the ACH group produced more tied ranks. A larger test (N = 227) found no coherence advantage for ACH and found "pseudo-diagnostic" weighting of evidence.\[16\]\[17\]\[18\] The usable core is the *matrix*: score each piece of evidence against every hypothesis and weight evidence that discriminates between hypotheses. The ritual adds little. An LLM can follow every step of the matrix, which human analysts did not.
- **Devil's advocacy helps when it targets a specific recommendation.** Chiang et al. (IUI 2024) found that LLM-powered devil's advocates arguing *against the AI's recommendation* "have the potential to promote groups' appropriate reliance on AI."\[19\] That is promising, but the effect was modest and the setting was group decision-making, not essay writing. No study I found shows that generic "now argue the other side" prompts improve factual accuracy. CoVe and Huang et al. together suggest counterarguments help only when they trigger *new retrieval* against a specific claim.

**Inference**
- Self-generated counterarguments without retrieval are likely to be strawmen or noise. Require every "strongest counter" to be backed by a receipt, or mark it "no receipt found".

### 3. The pre-committed thesis problem

**Measured**
- **LLM search amplifies confirmation.** Sharma, Liao & Xiao (CHI 2024 Best Paper) ran two experiments. Participants "engaged in more biased information querying with LLM-powered conversational search, and an opinionated LLM reinforcing their views exacerbated this bias."\[20\]\[21\] An LLM that *challenged* their views had limited corrective effect.\[22\] The mechanism is that conversational interfaces invite confirmatory queries.\[20\]
- **Embedded premises get accommodated.** Ermakova et al. (2025) found model responses aligned with the assumption in the question. Under a negative assumption, models said more than 90% of texts were not puns even though 58% were.\[23\] In "Can LLMs Ground when they (Don't) Know", an ACL 2025 study of direct and loaded political questions, GPT accommodated the misinformation 41.4% of the time and Mistral 64.1%; GPT rejected the false premise 38.1% of the time and Mistral only 10.4%. Explicit instructions to take a side produce strong alignment. A review of one 2026 study argues that merely *stating* a belief has "a small and inconsistent effect". That is secondary commentary on a preprint, so treat it as provisional.\[24\]
- **Sycophancy is trained in.** Sharma et al. (Anthropic, ICLR 2024) showed that five assistants gave more positive feedback when the user said "I really like" or "I wrote" the text. Both humans and preference models preferred convincingly written sycophantic responses over correct ones "a non-negligible fraction of the time."\[25\]\[26\]\[27\]
- **Retrieval is the fix for false premises.** Wang & Blanco (EMNLP 2025) found that "generated evidence is detrimental" for identifying questions with false assumptions, whereas including retrieved evidence was always beneficial. A related method checks each premise via RAG *before* answering.

**Inference / recommendation**
- Convert "why the detractors are right" into a Hypothesis such as: "Which of the detractors' main claims about [figure]'s public behaviour are supported by the record?" Generate the Claim Map from the *detractors' strongest claims* and then from the *defenders' strongest claims*. Run mirrored query pairs ("evidence that X" / "evidence against X"), then report the scorecard: e.g., "4 of 7 detractor claims supported, 2 mixed, 1 unsupported." The title can stay provocative only if the Verdict & Limits beat honestly carries the misses. That serves the user better than a one-sided script that a critic can dismantle.

### 4. Video and transcripts as evidence

**Measured**
- **ASR invents text.** Koenecke et al. (FAccT 2024) ran 13,140 audio segments through the Whisper API and found that 1.4% produced entire hallucinated phrases or sentences absent from the audio. 38% of those included explicit harms such as invented violence, false associations or false authority. Hallucinations were more frequent with longer non-vocal stretches and were non-deterministic across runs. Pauses, music and dead air are common in streams and YouTube audio.\[28\]
- **Spontaneous speech is hard.** On the CASPER spontaneous-conversation set, Whisper-large-v3 scored 0.31 WER. In child–adult interaction data, Whisper-large's error rose from 27.8% to 46.2% and its diarization error from 15.5% to 39.4% as speech overlap grew to 1 second.\[29\]\[30\] Human transcribers themselves disagree: 5.9% on Switchboard and 11.3% on CallHome, and 9.6% for "quick transcription" (Stolcke & Droppo, 2017).\[31\] Speaker attribution is a separate failure: one Whisper-segmentation system reported word-diarization error of 2.68% with two speakers and 11.65% with three.\[32\]

**Inference / recommendation**
- **Prefer creator or platform captions for locating a quote; never ship one unheard.** A quote is "verified" only after an audio re-listen confirms the exact span and the speaker. With roughly 1-in-100 hallucination rates and high conversational WER, every quoted span in the final Script needs a human or second-model audio confirmation.
- **Locate timecodes by fuzzy-matching the claim's text against a word-timestamped transcript**, then snapping to sentence boundaries. Choose clip boundaries by expanding to the full sentence containing the quote, plus the preceding question or prompt if it is an interview, plus any immediate qualification ("but", "unless", "I'm joking"). Store that wider span as the *context span* even if the cut is shorter.
- **Context-stripping check.** For every clip, the system asks: "Does the context span change the meaning of the cut span?" (sarcasm, hypotheticals, quoting someone else, a later retraction). If yes, flag the clip and do not use it as Evidence.
- **Clip receipt schema:** source URL; platform ID; uploader/channel; speaker (with attribution confidence); original publication date; capture date; in/out timecode; verbatim cut span; context span (±N seconds or the full exchange); transcript source (creator captions / auto-captions / ASR model); verification status (located → heard → context-checked); bound sub-claim ID; role (evidence / illustration / object of critique); rights note (fair-dealing purpose, attribution string).

### 5. Clip sourcing with minimal user effort

**Measured / documented (not legal advice)**
- **YouTube's Terms of Service.** Users may not "access, reproduce, download, distribute… or otherwise use any part of the Service or any Content except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube and, if applicable, the respective rights holders." The terms also bar circumventing features that restrict copying. Showing videos "through the embeddable YouTube player" is expressly permitted. The University of Waterloo's copyright office therefore advises against downloading or screen-recording YouTube videos. ToS breach is a contract matter, separate from copyright.\[33\]\[34\]\[35\]
- **US fair use, as the documentary community practises it.** The Documentary Filmmakers' Statement of Best Practices in Fair Use (2005, Center for Media & Social Impact) covers two relevant situations. Using material as the object of critique is "generally permissible," and the use "may be as extensive as is necessary to make the point," but it must not become a market substitute. Quoting material to illustrate an argument requires attribution, using no more than necessary, and not relying "predominantly or disproportionately on any single source."\[36\]\[37\]\[38\]
- **Canadian fair dealing.** Criticism, review, parody, satire and news reporting are enumerated purposes (education, parody and satire were added in 2012). Under s. 29.1, criticism or review is fair dealing only if the source and, if given, the author/performer/maker/broadcaster are mentioned. Fairness is assessed on the six CCH factors: purpose, character, amount, alternatives, nature and effect. The Supreme Court looks to community practice for guidance. DOC's 2010 Canadian guidelines (flagged by DOC as possibly out of date) state that criticism can target "the views expressed in the material," such as establishing that an individual stated a position. They also report clearance costs reaching 27% of a documentary budget. On amount, the guidelines cite a UK case allowing 12.5 minutes of clips because "serious criticism of a film requires that you spend sufficient time showing the film itself."\[39\]\[40\]\[41\] **Key differences from US fair use:** the purpose list is closed, attribution is a statutory condition for criticism/review, and there is no "transformative use" doctrine as such.

**Inference / recommendation (HCI)**
- Mark, Gudith & Klocke (CHI 2008) found that interrupted workers finished *faster* but with more stress and frustration.\[42\] The popular "23 minutes to refocus" figure comes from a separate shadowing study reported in a 2006 interview, not from that paper.\[43\] Neither is direct evidence about clip queues. The design inference is reasonable but unmeasured: one batched session is cheaper than scattered requests.
- **Flow:** the system finds the clip, picks in/out from the transcript, and writes the clip receipt. It checks the local library first by transcript and fingerprint match. Remaining clips go to a **Pull List** ordered by source video, so one video is opened once for several clips. Each row offers one action: open at timecode, or use whatever platform-authorized or user-side capture method he has chosen. Dropping the file anywhere auto-matches it to the row by duration, audio fingerprint and timecode. Where download is not appropriate, the edit can carry an **embed/reference placeholder**, and the final cut decision is his.

### 6. Clip placement and the "psychology of a public figure" genre

**Documented**
- **Goldwater Rule.** The American Psychiatric Association's 1973 rule was reaffirmed in March 2017. The Ethics Committee wrote that "a diagnosis is not required for an opinion to be professional." Any opinion on "the affect, behavior, speech, or other presentation of an individual" that draws on psychiatric expertise counts. The stated rationale is that unexamined opinions compromise professional integrity, can stigmatize people with mental illness, and violate consent.\[44\]\[45\] The rule binds psychiatrists, not journalists, but its logic carries over: diagnosis needs examination, and observable behaviour does not establish inner states.
- **Canadian defamation defences (paraphrased from SCC judgments; verify against official text).** *WIC Radio v. Simpson* (2008 SCC 40) protects fair comment if it is on a matter of public interest, based on fact, recognizable as comment, and something "any [person] [could] honestly express… on the proved facts," unless the plaintiff proves malice. *Grant v. Torstar* (2009 SCC 61) protects responsible communication on matters of public interest, judged on factors including the seriousness of the allegation, whether "the plaintiff's side of the story was sought and accurately reported," and, for reportage, attributing statements and giving context. The Court called seeking the target's side "perhaps the core" factor.\[46\]\[47\]

**Inference / recommendation**
- **Phrasing rule for the linter:** describe behaviour and cite it ("in three interviews he denied X after the footage showed Y"). Attribute interpretations to named experts or to the detractors ("critics describe this as…"). Never assert a diagnosis ("he is a narcissist"). Flag clinical vocabulary (narcissist, psychopath, sociopath, delusional, disorder) in SAID text unless it is attributed and quoted.
- **Placement:** every clip binds to exactly one sub-claim and one role. *Evidence* clips go in the Evidence Run and must be verified. *Object of critique* clips are where the figure's own words are analysed, so give enough context to be fair. *Illustration* clips are tone and b-roll and carry no argumentative weight. Anti-clip-dump rule: no clip without a narration beat that states what the viewer should take from it. Cap any single source's share of total clip time, following the Statement's "not disproportionately on any single source."\[37\] I found **no measured norms** for ideal clip length or cut-back frequency in commentary videos. Any numbers you see are practitioner folklore.

### 7. Refinement passes and user control

**Measured:** open-ended revision regresses out-of-scope content (16–27% in MR DRE),\[12\] intrinsic self-critique misses errors (Huang; Tyen), and gains saturate within about three iterations (Self-Refine).\[9\]

**Recommendation:** support only *named, scoped* passes, each with its own detector:
- **Weakest-claim audit:** re-rank sub-claims by receipt strength and flag any line in the SAID column that claims more than its receipt entails.
- **Missing-counter audit:** for each Supported claim, run new "against" retrieval. If something is found, add it to What Cuts Against This.
- **Quote re-verification:** re-match every quoted span against transcript and audio, and re-check the context span.
- **Redundancy/length audit:** find duplicate beats and over-length sections against a time budget.
- **Flow/structure audit:** check skeleton order and that every Evidence Run beat ties back to the Question & Promise.
- **Register lint:** deterministic, as established earlier.

"Another pass" in chat maps to the next unrun audit, or to the one he names. "Make it better" should be converted into a choice of these passes. Each pass edits only its target beats ("locked" everything else) and returns a **change card** for the phone: what changed (count), why (the detector's finding), a before/after of the one most consequential line, and Accept all / Reject all / Review each. That design follows from MR DRE's regression finding. I found no direct HCI study measuring diff-summary formats for AI co-editing, so treat the card format as reasoned design, not tested.

### 8. What the user decides vs. what the system decides

**Inference grounded in the above:** the user's judgement is irreplaceable where sycophancy and confirmation bias make the system untrustworthy (the hypothesis and the verdict), and where he carries legal or ethical liability (fairness and red lines). Everything else is better decided silently, with an audit trail. I found no peer-reviewed measure of how many confirmations users tolerate in this setting. The interruption literature only shows that interruptions carry stress costs.

## Closing: The Aldershot Pipeline

### (a) Pass-by-pass pipeline

| # | Pass | Artifact | Stop condition |
|---|---|---|---|
| 0 | **Intake** | Brief (blurb + optional talk-first voice memo transcript) | Brief saved |
| 1 | **Hypothesis & Claim Map** | Testable Hypothesis; 5–10 atomic sub-claims from detractors *and* defenders, each typed and ranked by check-worthiness and centrality | Every sub-claim is atomic, typed and has a mirrored query pair → **USER GATE 1** |
| 2 | **Receipts** (library first, then web/transcripts, STORM-style perspective questioning interleaved with retrieval) | Receipt table + clip receipts (status: located) | Each sub-claim has ≥1 for and ≥1 against search executed; new searches return no new receipts (saturation) or the budget is hit |
| 3 | **Verdicts** (factored entailment check per receipt; ACH-style matrix across sub-claims) | Scorecard: verdict, strongest receipt, strongest counter, confidence | Every receipt has an entailment label; every sub-claim has a verdict → **USER GATE 2** |
| 4 | **Spine & Script** | Populated six-beat skeleton; SAID column written per beat from verdicts (and the user's own words where available); register lint | Every factual sentence links to a receipt; linter clean; time budget met |
| 5 | **Clip Plan & Pull List** | Clips bound to sub-claim + role; context check; Pull List grouped by source | Every Evidence clip context-checked; remaining pulls batched → **USER GATE 3 (one sitting)** |
| 6 | **Verification sweep** | Quote re-verification against audio for all shipped quotes; attribution strings for fair dealing | All quotes "heard"; all clips have source + author credit |
| 7+ | **Named refinement passes** (on request) | Change card per pass | Detector reports zero findings, or two consecutive passes change nothing material (stop at ~3) |

### (b) Question bank per pass

- **Pass 1, Hypothesis & Claim Map:** What does the brief presuppose? What would have to be true for it to be right, and what would show it wrong? What are the detractors' 3–5 strongest claims, and the defenders' strongest? Is each claim factual, interpretive, evaluative or predictive, and which are checkable at all? Which claims is the video's argument load-bearing on (centrality)? Which claims are about inner mental states (reframe as observable behaviour)?
- **Pass 2, Receipts:** What is the strongest primary evidence *for* this claim? What is the strongest *against*? Does the user's library already contain it? Who are the perspectives (supporter, critic, neutral expert, the figure himself) and what would each ask? Is this a first-hand source or a clip of a clip? What is the original date and venue?
- **Pass 3, Verdicts:** Does this exact span entail the claim, or only suggest it? Which evidence discriminates between "detractors right" and "detractors wrong", rather than fitting both? What context (date, sarcasm, a later retraction) changes the meaning? What is the most charitable reading of the figure's behaviour that still fits the receipts? What would a fact-checker mark this as?
- **Pass 4, Spine & Script:** Does any sentence claim more than its receipt? Is every psychological statement behavioural and attributed? Does What Cuts Against This contain the real strongest counter, not a strawman? Does Verdict & Limits state which parts of the brief failed?
- **Pass 5, Clip Plan:** Which sub-claim does this clip serve, and in which role? Does the context span change the meaning? Is the clip no longer than needed to make the point? Is one source dominating? Does each clip have a narration beat telling the viewer what to notice?

### (c) Clip-sourcing hand-off flow

1. The system searches the **local library first** (transcript text match, then audio fingerprint).
2. For missing clips, the system finds the source, locates the timecode by transcript match, sets in/out at sentence boundaries plus context, and writes the clip receipt.
3. The system builds **one Pull List**, grouped by source video and ordered by Script position. Each row has the thumbnail, the quote, URL with start time, in/out, and a single action button.
4. The user clears the list **in one sitting**, one physical action per row, using a method he has judged appropriate under the platform terms and his fair-dealing position. Files dropped in are auto-matched to rows.
5. The system trims, re-verifies the quote against the actual file's audio, and writes the on-screen/description attribution (source + creator), as s. 29.1 requires.\[40\]
6. Unpulled clips stay as placeholders with the receipt attached, so the script never blocks on them.

### (d) User decision points (the only interruptions)

1. **Hypothesis gate:** accept, edit or narrow the Hypothesis and Claim Map (including adding claims he heard in videos).
2. **Verdict gate:** accept the scorecard, especially any "Unsupported" verdict on a claim he expected to win, and decide whether the title survives.
3. **Pull session:** one batched sitting.
4. **Red lines, on flag only:** any clinical language, any allegation of fact that is serious under the *Grant* factors (e.g., criminality), any clip flagged for context-stripping, any clip whose length or share is unusually high.
5. **Voice:** recording the SAID column himself.

The system decides silently: query wording, source ranking, perspective selection, receipt selection, entailment labels (shown with the verdict), beat order within the skeleton, clip in/out, placement, attribution text, and linter fixes.

### (e) What the evidence does NOT support

- That more passes keep helping. Gains concentrate in the first one to three iterations, and unscoped revisions break prior content.\[10\]\[12\]
- That an LLM can reliably critique its own reasoning or its own prose's naturalness without external signals.
- That generic "argue the other side" prompts improve accuracy. Benefit appears only when counters drive new retrieval or target a specific recommendation.
- That ACH, as a human ritual, reduces confirmation bias. RCT evidence is mixed to null.\[48\] Only the matrix logic is worth keeping.
- That a cited source means a supported claim. Citation accuracy for deep research systems ranges from 39.8% in DeepTRACE to 94% in DeepResearch Bench.
- That ASR transcripts are quotable as-is.
- That there are measured norms for clip length, cut frequency or the number of confirmations users will tolerate. None were found.
- That any clip length is automatically fair use or fair dealing. Both are context-dependent, and this report is not legal advice.

## Caveats

- Several LLM-bias findings come from 2025–2026 preprints or secondary reviews, and models change quickly. Re-test framing effects on the models Aldershot actually uses.
- The WIC Radio and Grant quotations were taken from a media-lawyers' association summary of the judgments, not the official SCC text. The DOC Canadian guidelines date from 2010 and flag themselves as possibly outdated. Consult a Canadian media lawyer before publishing a critique of a named living person.
- The HCI recommendations (batching, change cards, gate count) are reasoned from adjacent evidence, not tested in this exact workflow. Instrument Aldershot to measure acceptance rates and pass regressions yourself.

## Sources

1. [Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models - ACL Anthology](https://aclanthology.org/2024.naacl-long.347/)
2. [STORM writes Wikipedia-like articles from scratch - Michael Rowe](https://www.mrowe.co.za/blog/2024/10/storm-writes-wikipedia-like-articles-from-scratch/)
3. [Assisting in Writing Wikipedia-like Articles From Scratch](https://arxiv.org/pdf/2402.14207)
4. [\[2309.11495\] Chain-of-Verification Reduces Hallucination in Large Language Models](https://ar5iv.labs.arxiv.org/html/2309.11495)
5. [CHAIN-OF-VERIFICATION REDUCES HALLUCINATION IN LARGE LANGUAGE MODELS](https://arxiv.org/pdf/2309.11495)
6. [Large Language Models Cannot Self-Correc...](https://axi.lims.ac.uk/paper/2310.01798)
7. [\[2310.01798\] Large Language Models Cannot Self-Correct Reasoning Yet](https://ar5iv.labs.arxiv.org/html/2310.01798)
8. [LLMs cannot find reasoning errors, but can correct them ...](https://aclanthology.org/2024.findings-acl.826.pdf)
9. [SELF-REFINE: How Language Models Can Improve Their Own Outputs](https://medium.com/@nandanadas88/self-refine-how-language-models-can-improve-their-own-outputs-7a346d14a293)
10. [Iterative Self-Refinement](https://www.emergentmind.com/topics/iterative-self-refinement)
11. [Self-Review Framework for Enhancing Instruction Following Capability of LLM](https://arxiv.org/pdf/2507.05598)
12. <https://arxiv.org/pdf/2601.13217>
13. [Detecting and Correcting Reference Hallucinations in Commercial LLMs and Deep Research Agents](https://arxiv.org/pdf/2604.03173)
14. [A Survey on Automated Fact-Checking](https://arxiv.org/pdf/2108.11896)
15. [(PDF) The “analysis of competing hypotheses” in intelligence analysis](https://www.researchgate.net/publication/331942237_The_analysis_of_competing_hypotheses_in_intelligence_analysis)
16. [The “analysis of competing hypotheses” in intelligence analysis - Dhami - 2019 - Applied Cognitive Psychology - Wiley Online Library](https://onlinelibrary.wiley.com/doi/full/10.1002/acp.3550)
17. [The “analysis of competing hypotheses” in intelligence analysis](https://strathprints.strath.ac.uk/69049/1/Dhami_etal_ACP_2019_The_analysis_of_competing_hypotheses_in_intelligence.pdf)
18. [Critical review of the Analysis of Competing Hypotheses technique: lessons for the intelligence community](https://www.researchgate.net/publication/378015005_Critical_review_of_the_analysis_of_competing_hypotheses_technique_lessons_for_the_intelligence_community)
19. [Enhancing AI-Assisted Group Decision Making through LLM-Powered Devil's Advocate](https://dl.acm.org/doi/fullHtml/10.1145/3640543.3645199)
20. [Generative Echo Chamber? Effect of LLM-Powered Search Systems on Diverse Information Seeking](https://dl.acm.org/doi/10.1145/3613904.3642459)
21. [\[PDF\] Generative Echo Chamber? Effects of LLM-Powered Search Systems on Diverse Information Seeking](https://www.semanticscholar.org/paper/00a765760e75bcc4e28c339b575a70f1d3bdcc5e)
22. [Generative Echo Chamber? Efects of LLM-Powered Search](https://www.ziangxiao.com/pdf/[p]Sharma_Generative_echo_chamber_Effect_of_LLM-powered_search_systems_on_diverse_information_seeking.pdf)
23. [Confirmation, Framing, and Position Biases in LLM Responses](https://dl.acm.org/doi/10.1145/3786304.3787879)
24. [Confirming Our Biases? Evaluating the Capabilities, Risks, and Societal Impact of Large Language Models · Pith](https://pith.science/paper/2608.06977)
25. [Towards Understanding Sycophancy in Language Models](https://www.alphaxiv.org/overview/2310.13548)
26. [\[2310.13548\] Towards Understanding Sycophancy in Language Models](https://ar5iv.labs.arxiv.org/html/2310.13548)
27. [Towards Understanding Sycophancy in Language Models - MATS Research](https://www.matsprogram.org/research/towards-understanding-sycophancy-in-language-models)
28. [Careless Whisper: Speech-to-Text Hallucination Harms](https://www.researchgate.net/publication/381199740_Careless_Whisper_Speech-to-Text_Hallucination_Harms)
29. [CASPER: A Large Scale Spontaneous Speech Dataset](https://arxiv.org/pdf/2506.00267)
30. [End-to-End Joint ASR and Speaker Role Diarization with Child-Adult Interactions](https://arxiv.org/pdf/2601.17640)
31. [Comparing Human and Machine Errors in Conversational Speech Transcription](https://arxiv.org/pdf/1708.08615)
32. [Real-time multilingual speech recognition and speaker diarization system based on Whisper segmentation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11041969/)
33. [Terms of Service](https://www.youtube.com/static?template=terms)
34. [27\. In my course, I link to YouTube videos but some students are not able to access them. May I download or otherwise reproduce or screenshare YouTube videos for students who are unable to view them?](https://uwaterloo.ca/copyright-at-waterloo/catalogs/frequently-asked-questions/27-my-course-i-link-youtube-videos-some-students-are-not)
35. [How to Download YouTube Videos Legally in 2026](https://lynote.ai/blog/download-youtube-videos-legally)
36. [Documentary Filmmakers' Statement of Best Practices in Fair Use - Center for Media and Social Impact](https://cmsimpact.org/code/documentary-filmmakers-statement-of-best-practices-in-fair-use/)
37. [Fair Use](https://fsufilmhandbook.com/fair-use/)
38. [Fair Use Tips for Documentary Filmmakers](https://www.vondranlegal.com/fair-use-guidelines-for-documentary-filmmakers)
39. [Fair Dealing: A Six Factor Analysis - Copyright - LibGuides UFV at University of the Fraser Valley](https://libguides.ufv.ca/Copyright/FairDealing6Factors)
40. [Fair dealing in Canadian copyright law](https://en.wikipedia.org/wiki/Fair_dealing_in_Canadian_copyright_law)
41. [Copyright and Fair Dealing GUIDELINES FOR DOCUMENTARY FILMMAKERS MAY 2010](https://docorg.ca/wp-content/uploads/2010/05/DOC-FairDealing-EN-v2-web_4.pdf)
42. [\[PDF\] The cost of interrupted work: more speed and stress](https://www.semanticscholar.org/paper/The-cost-of-interrupted-work:-more-speed-and-stress-Mark-Gudith/b8da65570a3955db52b117b9bedd8f131316501d)
43. [Task Switching Statistics: The Real Numbers (2026) - The Blog Timer](https://theblogtimer.com/guides/task-switching-statistics)
44. <https://www.psychiatry.org/File%20Library/Psychiatrists/Practice/Ethics/APA-Ethics-Committee-Goldwater-Opinion.pdf>
45. [Psychiatry.org - APA Reaffirms Support for Goldwater Rule](https://www.psychiatry.org/news-room/news-releases/apa-reaffirms-support-for-goldwater-rule)
46. [Grant v. Torstar – Canadian Media Lawyers Association](https://canadianmedialawyers.com/grant-v-torstar/)
47. [WIC Radio Ltd. v. Simpson – Canadian Media Lawyers Association](https://canadianmedialawyers.com/wic-radio-ltd-v-simpson/)
48. [(PDF) The ‘Analysis of Competing Hypotheses’ in Intelligence Analysis](https://www.academia.edu/47828252/The_Analysis_of_Competing_Hypotheses_in_Intelligence_Analysis)
