# Making Aldershot's SAID Column Sound Like a Person on the First Pass: What the Evidence Supports

The evidence points one way: Aldershot should stop asking an LLM to *write* narration and instead have it *edit the user's own spoken words* around the receipts. Research on instruction-tuned models finds a fixed, noun-heavy, formulaic house style that prompting, few-shot examples and self-critique only partly remove. Text that the user contributes does not take on that homogenization.\[1\] A cheap linter (lexicon, punctuation, rhythm, specificity) catches the surface tells reliably. It cannot catch "sounds fake" as a whole, and neither can an LLM judge.

## TL;DR

- **The fakeness is structural, not just lexical.** Instruction-tuned LLMs use present participial clauses 2–5× and nominalizations 1.5–2× as often as humans, overuse certain words by more than 100×, and repeat syntactic templates mostly taken from pretraining data. Some phrase patterns appear more than 1,000× more often than in human text. Banning words fixes only the top layer.
- **The highest-leverage fix is source material, not prompting.** In a controlled study, co-writing with an instruction-tuned model made essays more homogeneous, but "the user-contributed text remains unaffected." Few-shot style imitation consistently fails to reach a real author's style. Even after post-editing, LLM drafts stay closer in style to the LLM than to the person. Build the SAID column from the user's transcribed talk-through plus verbatim receipt quotes, and limit the model to cutting, ordering and bridging.
- **Automate the checks that are reliable, and don't trust self-critique or LLM judges with "naturalness."** Frontier LLMs score close to chance at judging writing quality. Iterative self-refinement inflates the model's own scores while human-rated quality falls. Use deterministic checks: a cliché lexicon of model-specific overused phrases, em-dash rate, sentence-length spread, short-sentence share, repeated n-grams and templates, and density of specifics. Apply targeted span rewrites with a hard stop after one pass.

## Key Findings

### 1. What makes AI scripts sound fake (measured)

**Grammar and register: the deepest tell.** Reinhart et al. (PNAS, 2025) used Douglas Biber's 66-feature tagset to compare human texts with parallel continuations from GPT-4o, GPT-4o Mini and Llama 3 variants. Instruction-tuned models used present participial clauses 2–5× more often than humans and nominalizations 1.5–2× more often. GPT-4o overused words like "camaraderie" and "palpable" at more than 100× human rates.\[2\] The key finding for Aldershot: Llama 3 *base* models used features at near-human rates, and instruction tuning made output *less* human. The authors conclude that instruction tuning "trains them in a particular informationally dense, noun-heavy style, and limits their ability to mimic other writing styles leading to, in some cases, genre misalignment."\[3\] *Mechanism:* the model packs information into nouns and -ing clauses ("highlighting the systemic failures underpinning the agency's oversight"). That is a written, informational register, and it sounds stilted when read aloud.

**Lexical overrepresentation.** Kobak et al. (Science Advances, 2025) tracked "excess vocabulary" across more than 15 million PubMed abstracts and found 379 style words that surged in 2024.\[4\]\[5\] Examples: *delves* (excess frequency ratio r = 28.0), *underscores* (13.8), *showcasing* (10.7).\[6\] This implies at least 13.5% of 2024 abstracts went through an LLM.\[7\] A follow-up by Holzwarth, González-Márquez & Kobak (arXiv preprint, August 2026) examined 1,194,287 PubMed Central full texts and found that "by the end of 2025, 89% of papers show excess of LLM-associated vocabulary." Juzek & Ward (COLING 2025) identified 21 "focal words" and found evidence pointing to RLHF/preference learning as a cause. In their tests on Llama, human-feedback training was associated with more overuse.\[8\] Implication: the tics are trained in, so they come back whatever the prompt says.

**Phrase- and template-level slop.** The Antislop paper (Paech et al., ICLR 2026) profiles model output against human baselines and finds "some slop patterns appear over 1,000× more frequently in LLM output than human text."\[9\]\[10\] This includes constructions like "It's not X, it's Y."\[11\] Shaib et al. (EMNLP 2024) define *syntactic templates* (recurring part-of-speech sequences). They find models produce templated text at higher rates than human references, and that 76% of templates in model text appear in pretraining data, against 35% for human-written text.\[12\]\[13\] These patterns "are not overwritten during fine-tuning or alignment processes such as RLHF."\[14\] *Mechanism:* even with every banned word removed, the sentence *shapes* repeat: the contrastive reframe, the participial tail, the paired adjective.

**Punctuation.** Freeburg (arXiv 2026) measured about 240,000 words from twelve instruction-tuned models. GPT-4.1 produced 10.62 em dashes per 1,000 words and GPT-4o 4.12, against a human essay baseline of 3.23 (range 0.33–17.12, a 50× spread).\[15\] Tested Llama models produced none.\[16\] Under explicit instructions to suppress them, some models barely changed: Freeburg reports "GPT-4.1 retains 9.10 em dashes per 1,000 words even under explicit suppression; DeepSeek V3 retains 5.41; Claude Opus 4.6 drops to 0.19." Conclusion: em dashes are a *rate* signal, not a binary one. Plenty of humans use them heavily.

**Rhythm (burstiness).** Muñoz-Ortiz et al. (2023/2024) compared six LLMs with human news text. LLM sentence lengths cluster in the 10–30-token range, while human texts "exhibit more scattered sentence length distributions" and more varied vocabulary.\[17\]\[18\] Burstiness is a weak signal on its own, though. The CT² study found that as models get larger, "the deviation in burstiness scores diminishes," and that perplexity and burstiness are not reliable detectors.\[19\] Use sentence-length spread as a *quality* check for spoken rhythm, not as proof of AI origin.

**Structure and endings.** Russell, Karpinska & Iyyer (ACL 2025) had annotators label 300 non-fiction articles. A majority vote of five annotators who frequently use LLMs for writing misclassified only 1 of 300, beating most automatic detectors even on paraphrased or "humanized" text.\[20\] Their most common clues were "AI vocabulary" (*vibrant, crucial, significantly*), then "formulaic sentence and document structures (e.g., optimistically vague introductions and conclusions)" and a lack of originality.\[21\] This is the measured basis for the "tidy-moral ending" and "hype opener" complaints. Your audience includes exactly these people, heavy LLM users, and they spot slop reliably.

**What expert editors cut.** Chakrabarty, Laban & Wu (CHI 2025) had 18 professional writers edit 1,057 LLM paragraphs, producing 8,035 fine-grained edits. The resulting seven-category taxonomy covers cliché, unnecessary/redundant exposition, purple prose, poor sentence structure, lack of specificity and detail, awkward word choice, and tense inconsistency.\[22\] GPT-4o, Claude 3.5 Sonnet and Llama 3.1-70B were no better than one another; all three shared the same idiosyncrasies.\[22\] Related work they cite notes "telling instead of showing" and stories that are "homogeneously positive and lack tension."\[22\]

**Homogenization.** In Padmakumar & He's (ICLR 2024) controlled study, writing with InstructGPT, but not the base GPT-3, measurably increased similarity between authors' essays, reduced lexical and content diversity, and raised repetition of 4- and 5-grams. Crucially, "this effect is mainly attributable to InstructGPT contributing less diverse text… the user-contributed text remains unaffected by model collaboration."\[1\]\[23\]

**Folklore vs. measured.** Measured: overused words, em-dash rate, participial clauses and nominalizations, template repetition, narrow sentence-length spread, vague optimistic intros and conclusions, low specificity. *Not* directly measured in what I found, so treat as practitioner observation: the "rule of three," "Here's the thing" / "let's dive in" openers as a category, and hedging or both-sidesing in narration specifically. They are plausibly covered by "formulaic structures" and the Antislop phrase profiles, and "dive" did appear among LLM words that post-editors deleted.\[24\] Still, I found no frequency ratios for them specifically.

### 2. Spoken vs. written register

**Measured register differences.**
- **Lexical density:** Ure (1971) found most spoken texts below 40% lexical (content) words and most written texts at 40% or above.\[25\] One telling exception: a study of BBC output found *scripted* spoken news at 52.15% against 55.05% for written news.\[26\] Scripted broadcast speech is basically writing read aloud. That is the exact trap here: a script "for the ear" can still be in written register.
- **Nouns:** the Longman Grammar of Spoken and Written English (Biber et al., 1999) reports about 150,000 nouns per million words in conversation against about 300,000 in academic prose, roughly double.\[27\]
- **Fragments:** in the same corpus, non-clausal units make up more than a third of conversational units, averaging two words.\[28\] Fragments are normal speech, not sloppiness.
- **Involvement features:** Biber's Dimension 1 ("involved vs. informational") puts contractions, first- and second-person pronouns, discourse markers (*well, anyway*), hedges, THAT-deletion and present tense on the involved side. Nouns, long words, prepositions, high type/token ratio and attributive adjectives sit on the informational side.\[29\] On the scale, face-to-face conversation scores around +35, prepared speeches around 0, and academic prose and press reportage around −15.\[30\]
- **US replication:** Xiao & McEnery's replication on American data gives standardized scores for contractions of +1.54 in conversation, +0.68 in public speech and −0.14 in academic prose.\[29\]

This lines up exactly with Reinhart's result: LLMs drift toward the informational pole, with more nominalizations and participial clauses.

**Video speech in particular.** Cooper (Applied Corpus Linguistics, 2023) tagged 2,602 YouTube transcripts for Biber's 67 features. Only 666 (about 26%) clustered with conversation from the Spoken BNC2014. Most YouTube speech is *not* conversational, and styles vary widely even within a category.\[31\] Your target is not "conversation". It is your own spoken narration, which sits somewhere between conversation and prepared speech.

**Writing for the ear (mostly practitioner guidance, with one old formula).**
- **Fang's Easy Listening Formula** (Journal of Broadcasting, 1966) counts syllables beyond the first in each word, per sentence. The broadcast guideline is an average below 10, with any sentence above about 20 flagged for a second look.\[32\]\[33\]
- **DINFOS (US Defense Information School) broadcast style guide:** "Follow the 20/25 rule," which limits leads to 20 words and other sentences to 25. It also tells writers to "vary your sentence length" and keep "one idea to one sentence."\[34\]
- **Other broadcast texts** suggest an average of about 15 words per sentence and avoiding relative clauses by splitting them into separate sentences.\[35\]

These are craft norms, not validated listenability research. Formal listenability studies, mostly on second-language learners, find sentence length and speech rate predict comprehension, but they don't give native-audience thresholds.\[36\]

**Disfluencies: don't fake them.** Hassan, Lison & Halvorsen (arXiv 2412.12710) inserted synthetic disfluencies into LLM utterances. This significantly increased perceived spontaneity but slightly lowered intelligibility: fluent M = 4.42 (SD 0.79) against disfluent M = 4.23 (SD 1.04) on a 5-point scale. Separately, in "Mind the Pause" (arXiv 2605.12242), TTS models given disfluent Hindi ASR transcripts scored poorly: ai4bharat/indic-parler-tts reached MOS 2.09 and suno/bark 2.03. In one-take human voiceover the speaker adds natural disfluency, so the script should not contain "um."

**Checkable SAID-column rules derived from this (inference from the measured contrasts):**
1. Contractions wherever the speaker would contract. Flag "do not / it is / they are" unless the stress is deliberate.
2. Keep the noun share low. Flag sentences with two or more nominalizations (-tion, -ment, -ity, -ness, -ance) or any sentence-final participial clause (", highlighting…", ", underscoring…").
3. One idea per sentence. Flag any sentence over about 25 words that contains a relative or subordinate clause, and any sentence with Fang ELF ≥ 20.
4. Allow and encourage fragments, especially before and after a receipt ("Read that again." "Nineteen pages.").
5. First and second person are allowed and expected: "I," "you," "we."
6. Present tense and spoken discourse markers ("so," "look," "now") at the user's own rate, not a generic rate.
7. No disfluencies written in. Leave those to the take.

### 3. What human essayists do differently

**Your own counts show human essayists don't share a "rhythm."** Your earlier transcript counts put Every Frame a Painting at about 15 words per sentence with 28% short sentences, and Folding Ideas at about 28 words per sentence with about 17% short. That is nearly a 2× difference in mean sentence length between two successful essayists. *Inference:* a fixed sentence-length target such as "average 15 words" would flatten Folding Ideas into broadcast copy. Measure the user's own distribution and match it, rather than matching a generic "human" norm. What both channels share, and LLM output lacks, is spread: a substantial share of short sentences alongside long ones.

**What the literature says human writing has that LLM text lacks (measured):**
- **Specificity and detail:** "Lack of Specificity and Detail" is one of the seven expert edit categories in LAMP, and LLMs "struggle with specificity" (Subbiah et al., cited in LAMP).\[22\]
- **Asymmetry and tension:** LLM stories are "homogeneously positive and lack tension" (Tian et al., cited in LAMP).\[22\]
- **Subtext:** LLMs reveal the subtext, "telling instead of showing."\[22\]
- **Originality and voice:** these were among the top cues for expert human detectors (Russell et al.).\[20\]
- **Personal involvement:** a statistics-education study (Reinhart and co-authors) found human writing has more "modulation of stress, confidence, and the inclusion of verbs linked to mental or verbal processes."\[37\] In plain terms: *I think, I noticed, he told me, she wrote.*

**Quoting sources (inference plus practitioner norm):** the receipt *is* the specificity. Your format's advantage is that a verbatim quote cannot be "LLM-ified" without being falsified. Human essayists typically (a) set the quote up with one plain sentence, (b) let it play verbatim, and (c) react to it, often briefly, sometimes with a fragment or a joke, before interpreting. LLMs tend to paraphrase the quote into abstraction ("the document underscores systemic failures"). I found no measured study of quotation handling in video narration. This is an inference from the specificity and "telling vs. showing" findings.

**Gap:** I found no peer-reviewed measured comparison of video-essay or documentary narration against AI narration. Your own channel counts are the best available data. Extend them, as described under Recommendations.

### 4. Methods for a good first pass, ranked by evidence

**(a) Voice-first / talk-it-out drafting: strongest support, from indirect evidence.**
- *Measured:* user-contributed text keeps its diversity while model-contributed text homogenizes (Padmakumar & He).\[1\]
- *Measured:* Rambler (CHI 2024), an LLM interface for dictated "rambles," showed that LLM cleanup plus gist-level operations (extracting keywords and summaries, merging, re-organizing) can turn disfluent, wordy speech into structured text.\[38\] A diary study (CHI EA 2025) with 12 academic and creative writers reported real-world use. One participant was surprised the output "was very close to screenplay."\[39\]\[40\]
- *Measured:* writers who care about voice welcome AI in *planning* but resist it in *translating ideas into language* and revising (Reza et al., 2025). AI help is least harmful to perceived authenticity at early exploratory stages (Hwang et al., 2025).\[41\]
- *Inference:* talk-through plus edit-only shaping keeps the user's lexicon, rhythm and asymmetries, because the words are his. The cost is that dictated text needs heavy cleanup. Rambler's raison d'être is that speech is "disfluent, wordy, and incoherent."\[38\] The LLM's job is therefore *subtractive*: cut, reorder, bridge.

**(b) Conditioning on the user's samples: helps, but has a hard ceiling.**
- *Measured:* Wang et al. (EMNLP Findings 2025) found few-shot prompting beats zero-shot on every metric but stays "significantly more distant than human writing," worst in informal domains, the category spoken narration falls in.\[42\]\[43\]
- *Measured:* PersonalBench (2026) found few-shot examples with explicit style instructions (authorship-similarity score 0.508) did no better than profile extraction (0.502), with both below the real-author floor (0.626). The authors' conclusion: "Instruction strength is not the bottleneck… the bottleneck is the model's capacity to shift its deep generative distribution at inference time."\[44\]
- *Measured:* Zeng & Nini (arXiv 2603.29454, March 2026) tested four prompting conditions on emails, text messages and social media posts. Prompted GPT-4o "failed to reproduce the fine-grained authorial markers" that authorship-verification tools detect.
- *Takeaway:* style profiles are useful as *linter targets* (the user's sentence-length distribution, contraction rate, pet phrases). They are weak as *generation conditioning*.

**(c) Grounding in receipts and specifics: supported.**
- *Measured:* in the WQRM study (Chakrabarty et al., 2025), giving the model detailed 180-word content briefs instead of 30-word ones raised writing-quality scores, but "LLMs still lag significantly behind trained human writers."\[45\]
- *Measured:* lack of specificity is a core expert edit category.\[22\]
- *Inference:* forcing each SAID beat to anchor on a specific receipt span (a name, a number, a date, a verbatim phrase) attacks the generic-abstraction failure directly. It is necessary but not sufficient, because the connective prose between receipts still defaults to house style.

**(d) Constraints: banned phrases and anti-slop decoding work on the surface layer.**
- *Measured:* Antislop's backtracking sampler suppressed 8,000+ patterns "while maintaining quality, whereas token banning becomes unusable at just 2,000," and achieved 100% suppression of "It's not X, it's Y." Its fine-tuning method (FTPO) cut slop by 90% with no loss on benchmarks.\[10\]\[11\]
- *Measured, a caution:* in "Science or Slop?" (Oh, Lee, Ahn, Kim & Kang, arXiv 2610.00531, 30 September 2026), "direct slop-aware prompting triggers reward hacking." Telling the model to "avoid slop" produces new tics rather than fixing the old ones. Their harness, which revises only where the evidence supports a change, "reduces the remaining AI–human gap by 63% over the strongest revision baseline."
- *Measured:* human post-editors rarely remove LLM words on their own. In the n = 81 post-editing study, words like "exploring" and "guiding" appeared 15–30 times in editable drafts and were removed only about twice each.\[24\]
- *Takeaway:* the system must catch these, because the user won't. With API models you can't run a custom sampler, so put the ban list in a *post-hoc detect-and-rewrite* step instead (see section 5). The Antislop result shows why: banning tokens outright at decode time degrades text.

**(e) Draft–critique–revise loops: the evidence is mostly negative for naturalness.**
- *Measured:* Self-Refine (Madaan et al., NeurIPS 2023) reported about 20% average gains, but mostly judged by GPT-4. In blind human A/B tests on dialogue responses, raters preferred Self-Refine 20.4% of the time, the base 11.2%, and rated them equally good 54.6% of the time.\[46\]\[47\]
- *Measured:* Huang et al. (ICLR 2024) found LLMs "struggle to self-correct… without external feedback." Gains in other studies came from oracle labels or weak first prompts.\[48\]\[49\]
- *Measured, most relevant:* Pan, He, Bowman & Feng (2024) ran iterative self-refinement on college-application essays. "Iterative self-refinement drives the evaluator scores to inflate while human annotator scores decrease." On Style ("writer's voice"), Depth and Details, human-judged improvement "plateaus after a single iteration or even degrades." Only grammar and conventions reliably improved. Reward hacking was worst when author and judge shared context.\[50\]
- *Measured:* in the PIT study, GPT-4 judged Self-Refine better while humans preferred the alternative by 23.53%. The cause: LLM judges reward length and detail.\[51\]
- *Positive case:* LAMP's targeted approach (detect problematic spans using a few-shot prompt built from expert edits, then rewrite only those spans) produced a statistically significant preference ordering of writer-edited > LLM-edited > raw LLM.\[22\]
- *Takeaway:* one targeted pass over flagged spans, with a judge that doesn't see the editing history, is supported. Open-ended "make it sound more human" loops are not.

**(f) Multiple variants vs. one: useful only if the selection is good.**
- *Measured:* WQRM generated multiple edited candidates and ranked them with a specialised writing-quality reward model. Professional writers ranked the WQRM-selected best edits at 1.58 on average, against 2.09 for random edits and 2.26 for first drafts.\[45\]
- *Measured, the catch:* on the 4,729-judgment Writing Quality benchmark, "state-of-the-art LLMs… barely outperform random baselines," and a generic reward model reached only 60.5%. WQRM itself reached 74%.\[45\]\[52\]
- *Takeaway:* best-of-N with an off-the-shelf LLM judge is close to a coin flip. If you generate variants, choose with deterministic metrics, or show two short alternatives for one *specific* beat, which is a cheap decision for the user. Don't show three whole drafts.

**How people actually edit AI text (HCI).**
- The n = 81 pre-registered post-editing study (Baumler et al., 2026) found post-editing moved text toward each participant's own style.\[41\] Post-edited text had 5× more contractions than the LLM drafts.\[24\]\[41\]
- Yet it "still remains stylistically closer in style to LLM text than to participants' unassisted control text" and was less diverse than unassisted writing. Participants *perceived* it as authentic anyway.\[16\]\[41\]
- *Implication for Aldershot:* starting from an LLM draft anchors the result in LLM style even after editing, and the user won't notice. This is the strongest argument against "generate, then let him fix it."

### 5. The automatic slop linter: which checks to trust

| Check | What it catches | Evidence of reliability | Verdict |
|---|---|---|---|
| Model-specific overused-word/phrase lexicon (Kobak list, Juzek focal words, Antislop profiles) | *delve, underscore, showcase, pivotal, crucial, vibrant, tapestry, testament*, "it's not X, it's Y" | Ratios of 10–1,000×+; expert humans rely on it most | **Run automatically**, weighted by ratio. Rewrite the span. |
| Em-dash rate per 1,000 words | Markdown-trained punctuation | GPT-4.1 10.62 vs human 3.23;\[53\] humans vary 50×\[15\] | **Run**, but against the *user's* rate, not zero |
| Sentence-final participial clauses and nominalization density | Informational, noun-heavy register | Participial 2–5×, nominalizations 1.5–2× (PNAS) | **Run.** Strongest grammatical signal, easy to compute with a POS tagger\[2\] |
| Sentence-length distribution: SD, coefficient of variation, % ≤ 8 words | Uniform rhythm | LLM lengths cluster at 10–30 tokens; weak as a detector for big models\[17\]\[19\] | **Run as a match to the user's profile** (e.g., EFAP-like 28% short), not as an AI detector |
| Repeated n-grams / compression ratio; POS-template rate | Repetition, templatedness | Shaib et al. (2024; 2025) metrics; templates persist through RLHF\[14\] | **Run.** Cheap and objective\[54\] |
| Specifics density per 100 words (numbers, proper nouns, dates, verbatim receipt quotes) | Genericness | "Lack of specificity" is a core expert edit category; no published threshold | **Run**, threshold from the user's past scripts |
| Contractions and first/second-person rate | Written register | Biber Dimension 1; post-editors added 5× contractions\[24\] | **Run** against the user's profile |
| Fang ELF per sentence, words per sentence > 25 with subordinate clause | Hard to say or follow | Broadcast norm (ELF < 10 average)\[32\] | **Run** as a speakability flag |
| Opener/closer pattern check (first and last sentence of each section) | Hype openers, tidy morals, "optimistically vague" conclusions | Expert detector cue (Russell)\[21\] | **Run** a regex lexicon plus one narrow LLM classification of "does this sentence state a moral/summary?" |
| TTS read-through / tongue-twister check | Clustered sibilants, stacked stresses | No validation found | **Optional.** Cheap if you already have TTS, but unproven |
| LLM-as-judge "sounds like a person?" | Holistic | Near random on WQ; GPT-5 zero-shot κ ≈ 0 against experts on binary slop; human experts themselves only κ −0.15 to 0.29\[55\]\[56\] | **Do not use** as a gate or score |
| Off-the-shelf AI detectors | Provenance | Beaten by expert humans; burstiness/perplexity unreliable on large models\[19\]\[20\] | **Do not use** |

The Shaib et al. (2025) "Measuring AI Slop" study adds important humility. Three professional copy-editors annotating 150 news articles and 100 QA passages agreed only weakly on the binary "is this slop" label (κ −0.15 to 0.29). They agreed better on *where* the problems were (span precision 0.65–0.80) and on specific codes such as structure (AC1 0.51).\[55\] *Design implication:* flag spans by named category, never give a single "slop score."

### 6. Big-swing options

1. **Evidence interview: the system interviews the user, and the script is built from his answers.** *Feasibility:* high; it's speech-to-text plus a question planner over the receipts. *Expected effect:* largest of any option. It combines (a) and (c): his words, anchored to specifics. Supporting evidence: user text stays diverse (Padmakumar & He), richer content briefs raise quality (WQRM), and writers accept AI at the planning stage (Reza; Hwang). The questions should be about *reactions*, not prose: "What's the first thing you noticed in this memo?" "What's the number that bothers you?" "Who would disagree, and are they right?" Rambler-style gist extraction then orders the answers. *Risk:* rambling answers need cutting, and the LLM's bridge sentences reintroduce house style. Lint the bridges hardest.
2. **Voice profile from past videos.** *Feasibility:* high, since it's computed from existing transcripts. *Expected effect:* moderate as a *linter target*, small as *generation conditioning*. Wang et al., PersonalBench and the impersonation study all find a ceiling. Compute: sentence-length distribution, short-sentence share, contraction rate, discourse-marker inventory, em-dash rate, signature phrases, and typical quote set-up and reaction patterns.
3. **Backwards from receipts.** Lay out receipts in argument order, record a reaction take per receipt, and let the system write only connective tissue capped at about one to two sentences per bridge. *Feasibility:* high, and it fits your block timeline. *Expected effect:* high for specificity and low for slop surface, because most words are either verbatim quotes or his speech.
4. **Fine-tuning a personal model or running Antislop/FTPO on an open model.** *Feasibility:* moderate for a solo developer. *Expected effect:* FTPO's 90% slop reduction is measured, and fine-tuning on high-quality books produced expert-preferred writing in Chakrabarty & Dhillon (2026).\[10\]\[57\] A personal fine-tune would need a lot of his transcripts, though. This is a later-stage option, not the first build.

## Recommendations: Design Rules for Aldershot

**A. How the first draft is generated (sound like the user):**
1. **Default flow is talk-first.** Chat-first collects the receipts. Then for each section the system asks 3–5 receipt-anchored questions, and the user answers aloud with rambling allowed. The SAID column is assembled from cleaned spans of those answers.
2. **The LLM is restricted to editing operations.** Delete, reorder, merge, split, and insert a bridge of 25 words or fewer when needed. Track the share of SAID words that are the user's verbatim words plus quotes, and aim for 80% or more. Show it in the editor.
3. **Every beat cites a receipt span.** A beat without an anchor (number, name, date, verbatim quote) gets flagged before the user sees it.
4. **Quote handling follows a fixed pattern:** a plain set-up sentence, the verbatim quote, then his recorded reaction. The model never paraphrases a receipt it can quote.
5. **No "write it from scratch" path by default.** If the user skips the interview, generate a *beat outline* with questions, not prose. The evidence shows LLM-first drafts stay LLM-styled even after he edits them.

**B. Automatic quality pass before display (one pass, deterministic first):**
1. Run the linter table's "Run" rows against the **user's profile**. Thresholds start from his past transcripts. Before he has any transcripts, use his own reference channels' ranges (for example a 15–28 words-per-sentence mean and 17–28% short sentences).
2. For flagged *LLM-authored* spans only (bridges), run **one** targeted rewrite. Use a judge that hasn't seen the editing history, give it the specific flagged category and his profile, and re-lint. If the span still fails, leave it highlighted for the user. Never loop. Pan et al. show human-judged voice degrades after one iteration.
3. Never rewrite the user's own transcribed words for "style." Only fix ASR errors and cut filler.
4. Show flags as named categories on spans ("participial tail," "generic summary ending"), never as a single score.

**C. Cutting the revise-in-chat loop to near zero:**
1. Replace open chat revision with **span-level, one-tap fixes**: "re-record this line," "use my original wording," "cut," or two short alternative bridges to choose between.
2. Make **one-take voiceover** the final edit. If he naturally deviates from the script while recording, prefer what he *said*: update SAID from the alignment rather than flagging a deviation. Every take then becomes training data for his profile.
3. **Learn from his edits automatically.** Every deletion and rewrite he makes updates his personal ban list and profile, which is the LAMP and WQRM insight applied to one person.

**What the evidence does NOT support:**
- "Write like a human" or "avoid slop" instructions on their own: they trigger reward hacking and new tics.
- Iterative self-critique loops for naturalness: model scores go up while human-judged quality goes down.
- LLM-as-judge or AI-detector scores as a gate: near chance against expert judgment.
- Few-shot style imitation as the main voice strategy: there is a measured ceiling.
- Matching a generic "15 words per sentence" or burstiness target: your two reference essayists differ by about 2×.
- Writing disfluencies into the script.
- Showing several full drafts and picking with an LLM: selection is the bottleneck.

## Caveats

- Most measured studies cover written genres (abstracts, news, essays, fiction), not spoken video narration. The spoken-register rules are inferences from Biber-tradition corpus contrasts and broadcast craft norms.
- Several key sources are 2025–2026 arXiv preprints not yet peer-reviewed: PersonalBench, the em-dash study, the post-editing study, and Science or Slop. Their numbers are plausible and consistent with each other but less settled.
- Overused-word lists are model- and version-specific. GPT-3.5 used few em dashes and GPT-4.1 many.\[58\] Profile the model you actually call, and update the profile.
- The interview-first design is supported by converging indirect evidence, not by a head-to-head trial against "generate and revise." Run that A/B on yourself: time to an acceptable script, and edit distance from draft to final take.

## Sources

1. [Does Writing with Language Models Reduce Content Diversity?](https://arxiv.org/pdf/2309.05196)
2. [Attribution Quality in AI-Generated Content:Benchmarking Style Embeddings and LLM Judges](https://arxiv.org/pdf/2510.13898)
3. [Do LLMs write like humans? Variation in grammatical and rhetorical styles](https://www.pnas.org/doi/10.1073/pnas.2422455122)
4. [Delving into ChatGPT usage in academic writing through ...](https://arxiv.org/pdf/2406.07016)
5. [Most biomedical publications show signs of LLM-assisted writing](https://arxiv.org/html/2608.10715v1)
6. [Delving into LLM-assisted writing in biomedical publications through excess vocabulary](https://www.science.org/doi/10.1126/sciadv.adt3813)
7. [\[PDF\] Delving into LLM-assisted writing in biomedical publications through excess vocabulary](https://www.semanticscholar.org/paper/9a870b9555fa12000df8947b9d71cac27e66acaa)
8. [Why Does ChatGPT “Delve” So Much? Exploring the Sources of Lexical Overrepresentation in Large Language Models — Lacuna](https://lacuna.tiptreesystems.com/work/why-does-chatgpt-delve-so-much-exploring-the-sources-of-lexical/wrk_865ceb87e34d00e73c4a73838417b24e)
9. [\[2510.15061\] Antislop: A Comprehensive Framework for Identifying and Eliminating Repetitive Patterns in Language Models](https://arxiv.org/abs/2510.15061)
10. [Antislop: A Comprehensive Framework for Identifying and Eliminating Repetitive Patterns in Language Models](https://mlanthology.org/iclr/2026/paech2026iclr-antislop/)
11. [Antislop: A Comprehensive Framework for Identifying and ...](https://arxiv.org/pdf/2510.15061)
12. [(PDF) Detection and Measurement of Syntactic Templates in Generated Text](https://www.researchgate.net/publication/381882903_Detection_and_Measurement_of_Syntactic_Templates_in_Generated_Text)
13. [Detection and Measurement of Syntactic Templates in ...](https://aclanthology.org/2024.emnlp-main.368.pdf)
14. [Detection and Measurement of Syntactic Templates in Generated Text - ACL Anthology](https://aclanthology.org/2024.emnlp-main.368/)
15. [The Last Fingerprint: How Markdown Training Shapes LLM Prose](https://arxiv.org/html/2603.27006v1)
16. [Why Large Language Models Seem to Overuse Em-Dashes - Gunvir Singh Dhesi](https://www.gunvir.ca/papers/why-llms-seem-to-overuse-em-dashes.html)
17. [Contrasting Linguistic Patterns in Human and LLM-Generated News Text](https://arxiv.org/pdf/2308.09067)
18. [Contrasting Linguistic Patterns in Human and LLM-Generated News Text](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11422446/)
19. [Counter Turing Test CT^2: AI-Generated Text Detection is Not as Easy as You May Think -- Introducing AI Detectability Index](https://arxiv.org/pdf/2310.05030)
20. [People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text](https://arxiv.org/abs/2501.15654)
21. [(PDF) People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text](https://www.researchgate.net/publication/388422135_People_who_frequently_use_ChatGPT_for_writing_tasks_are_accurate_and_robust_detectors_of_AI-generated_text)
22. [Can AI writing be salvaged? Mitigating Idiosyncrasies and Improving Human-AI Alignment in the Writing Process through Edits](https://arxiv.org/html/2409.14509v2)
23. [Vishakh Padmakumar (@vishakh\_pk) on X](https://x.com/vishakh_pk/status/1701693039494795560)
24. [Can You Make It Sound Like You? Post-Editing LLM-Generated Text for Personal Style](https://arxiv.org/pdf/2604.24444)
25. [Diachronic changes in lexical density of research article abstracts: A corpus-based study - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0024384124001682)
26. [(PDF) Lexical Density and Readability: A Case Study of English Textbooks](https://www.researchgate.net/publication/257527979_Lexical_Density_and_Readability_A_Case_Study_of_English_Textbooks)
27. [Noun Phrase Complexity in Academic Writing](https://files.eric.ed.gov/fulltext/EJ1225652.pdf)
28. [Longman Grammar of Spoken and Written English](https://www.tesl-ej.org/ej15wp/r14.html)
29. [Unit 21 Conversation and speech in American English (Case study 5)](https://www.lancaster.ac.uk/fass/projects/corpus/ZJU/xCBLS/chapters/C05.pdf)
30. [11 Oct 2005](https://www.comp.nus.edu.sg/~kanmy/dossier/courses/5244_2006/lectureNotes/w9-plagiarism_files/slide0011.htm)
31. [The identification of YouTube videos that feature the linguistic features of English informal speech](https://www.sciencedirect.com/science/article/abs/pii/S266679912300028X)
32. [Announcing/Writing Broadcast News - Wikibooks, open books for an open world](https://en.wikibooks.org/wiki/Announcing/Writing_Broadcast_News)
33. [UNIT 3 TELEVISION NEWS Structure Objectives Introduction](https://davuniversity.org/images/files/study-material/Unit-3.pdf)
34. [2015 DINFOS Broadcast Writing Style Guide.pdf](https://www.dinfos.dma.mil/Portals/66/Documents/Academics/BOMD/2015%20DINFOS%20Broadcast%20Writing%20Style%20Guide.pdf)
35. [Chapter Five: Writing for Broadcast](https://processofwritingnews.wordpress.com/chapter-five-writing-for-broadcast/)
36. [Learner Feature Variation in Measuring the Listenability for Learners of English as a Foreign Language](https://link.springer.com/chapter/10.1007/978-3-319-52836-6_36)
37. [Full article: Developing Students’ Statistical Expertise Through Writing in the Age of AI](https://www.tandfonline.com/doi/full/10.1080/26939169.2025.2497547)
38. [\[2401.10838\] Rambler: Supporting Writing With Speech via LLM-Assisted Gist Manipulation](https://arxiv.org/abs/2401.10838)
39. [Rambler in the Wild: A Diary Study of LLM-Assisted Writing With Speech](https://doi.org/10.1145/3706599.3706676)
40. [(PDF) Rambler in the Wild: A Diary Study of LLM-Assisted Writing With Speech](https://www.researchgate.net/publication/388883173_Rambler_in_the_Wild_A_Diary_Study_of_LLM-Assisted_Writing_With_Speech)
41. [Can You Make It Sound Like You? Post-Editing LLM-Generated Text for Personal Style](https://arxiv.org/html/2604.24444v1)
42. [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors](https://www.alphaxiv.org/abs/2509.14543)
43. [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors — Lacuna](https://lacuna.tiptreesystems.com/work/catch-me-if-you-can-not-yet-llms-still-struggle-to-imitate-the-implicit-writing/wrk_538ca421af66d4cbb1bfcfbc53dec074)
44. [PersonalBench: Measuring the Authorship Gap in LLM Personalization](https://arxiv.org/html/2608.19746v1)
45. [AI-Slop to AI-Polish? Aligning Language Models through Edit-Based Writing Rewards and Test-time Computation](https://www.alphaxiv.org/abs/2504.07532)
46. [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)
47. [SELF-REFINE: Iterative Refinement with Self-Feedback](https://proceedings.neurips.cc/paper_files/paper/2023/file/91edff07232fb1b55a505a9e9f6c0ff3-Paper-Conference.pdf)
48. [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)
49. [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/html/2310.01798v2)
50. <https://arxiv.org/html/2407.04549v1>
51. [Enabling Language Models to Implicitly Learn Self-Improvement](https://arxiv.org/pdf/2310.00898)
52. [\[2504.07532\] AI-Slop to AI-Polish? Aligning Language Models through Edit-Based Writing Rewards and Test-time Computation](https://arxiv.org/abs/2504.07532)
53. [Is the Em Dash an AI Tell? We Measured Dash Density Across Human vs AI Texts (2026)](https://slopdetector.org/blog/em-dash-ai-tell-data)
54. [Measuring AI “Slop” in Text](https://arxiv.org/html/2509.19163v2)
55. [\[Literature Review\] Measuring AI "Slop" in Text](https://www.themoonlight.io/en/review/measuring-ai-slop-in-text)
56. [(PDF) Measuring AI "Slop" in Text](https://www.researchgate.net/publication/395771218_Measuring_AI_Slop_in_Text)
57. [Can Good Writing Be Generative? Expert-Level AI Writing Emerges through Fine-Tuning on High-Quality Books](https://www.alphaxiv.org/abs/2601.18353)
58. [Why do AI models use so many em-dashes?](https://www.seangoedecke.com/em-dashes/)
