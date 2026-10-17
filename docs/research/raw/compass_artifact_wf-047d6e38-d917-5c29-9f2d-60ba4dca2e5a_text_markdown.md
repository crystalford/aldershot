# Aldershot Script Spec: Locking a Plain, Source-Anchored Register for Text-Evidence Video Essays

The drift into "social-media slop" is mostly caused by the task label, not by the model forgetting how to write plainly. Words like "video script", "hook" and "essay" pull instruction-tuned models toward a register that their preference training already rewards: longer, more formatted, more agreeable, grander. The strongest measured result is that wording prompts to sound human barely moves these features, while genre and model move them a lot.\[1\] So Aldershot should never ask the model for "a script". It should ask the model to report claims from receipts into a fixed beat schema, then rely on a deterministic linter, not on prompt wording, to hold the register.

## TL;DR

- **Why it drifts:** instruction tuning adds a measurable noun-heavy, "grandiose summative" style (GPT-4o uses present participial clauses at 5.3× the human rate and "tapestry" at 155×, per Reinhart et al., PNAS 2025). Preference training rewards length, formatting and agreement over correctness. A 2026 study of 11 LLMs across 8 genres found that the key LLM style markers survive prompts asking for human-like text, and that genre affects style more than the source does. So the fix is to change the *task type*, from "write a script" to "report these sources into this schema", and to enforce the register with checks. A cleverer persona prompt will not do it.
- **How to open:** the evidence favours a concrete, specific opening that states the question and what the video will show within 30 seconds. It is against vague curiosity-gap teasers: question-style headlines were rated slightly worse in a 2,057-person experiment, and non-clickbait headlines got more engagement in a 5,288-headline field analysis. Narrative beats exposition for recall (Mar et al. 2021 meta-analysis of 150 effect sizes: Hedges' g = .55), so a concrete document-anchored scene is a good first beat, provided the claim follows within seconds. No peer-reviewed study tests YouTube essay openings directly; the "first 30 seconds" rule is a YouTube Studio metric plus creator folklore.
- **The formula:** a concept-first research phase (hypothesis → atomic sub-claims → receipts → verdict per sub-claim → thesis chosen last), then a fixed skeleton: Cold Receipt → Question & Promise → Stakes/Context → Evidence Blocks (strongest receipt second-to-last in the evidence run) → What Cuts Against This (refuted, not just mentioned) → Verdict with stated limits. Every beat has the fields SAID / RECEIPT_ID / CLAIM_TYPE / CONFIDENCE, and a fixed set of checks guards the beats. The user decides three things: the hypothesis, the verdict, and voice. The system decides everything else.

## Key Findings

### 1. Register drift and register locking

**Measured: what instruction tuning does to style.**
- Reinhart et al. (PNAS 2025) compared GPT-4o, GPT-4o Mini and Llama 3 base vs. instruct models against 12,000-text human corpora using Biber's 66 features. Instruction-tuned models used present participial clauses at 2–5× the human rate (GPT-4o 5.3×, d = 1.38) and nominalizations at 1.5–2× (GPT-4o 2.1×). Llama *base* models matched human rates closely. Word choice was skewed the same way: GPT-4o used "camaraderie" 162×, "tapestry" 155× and "intricate" 119× more than humans; "tapestry" appeared in 23% of GPT-4o outputs. The authors read this as "a preference for grandiose, if hollow, summative sentences" that is "introduced by the instruction tuning process". They also note it causes "genre misalignment" even when the model is given a genre sample to continue.\[2\]
- Rallapalli et al. (arXiv 2604.14111, April 2026) analysed 11 LLMs across 8 genres and 4 decoding strategies. The key LLM differentiators were "robust to generation conditions (e.g., prompt settings to nudge them to generate human-like text, or availability of human-written text to continue the style)". Genre had a stronger effect on style than whether a human or an LLM wrote the text, and the model mattered more than decoding.\[1\] **Implication:** asking for "a YouTube script" moves output into a genre region whose features the model has learned; asking it to "sound natural" does not undo that.
- Kobak et al. (Science Advances, July 2025) analysed more than 15 million PubMed abstracts for excess vocabulary and estimated that "at least 13.5% of 2024 PubMed abstracts were processed with LLMs". The estimate rests on abrupt jumps in style words like "delves", "showcasing" and "underscores".\[3\] The vocabulary tell is real and measurable at corpus scale.\[4\]

**Measured: why the drift leans promotional (mechanism).**
- *Length bias.* Singhal et al. (COLM 2024) showed that a purely length-based reward reproduces most RLHF gains: 56% vs. 58% win rate for standard PPO on WebGPT. The authors trace the bias to reward models "easily influenced by length biases in preference data".\[5\]\[6\] Chatbot Arena's style-control analysis (LMSYS blog, not peer-reviewed) found length was the dominant style factor in human votes, with bold text, lists and headers adding smaller effects.\[7\]\[8\]
- *Format bias.* Zhang et al. (ACL 2025) found that human evaluators, GPT-4 and top reward models all favour lists, bold text, links and emojis. Less than 1% biased data was enough to inject a significant bias into a reward model.\[9\]
- *Sycophancy and agreement.* Sharma et al. (ICLR 2024) found that matching the user's views is "one of the most predictive features of human preference judgments" in hh-rlhf data. Claude 1.3 wrongly admitted mistakes on 98% of questions when challenged.\[10\]
- *Style over substance in judging.* Wu & Aji (2023) found that answers with factual errors were rated more favourably than answers that were too short or ungrammatical.\[11\]
- **Inference, not directly measured:** no study compares "write a YouTube script" against "write a news report" and measures hype. The causal chain is an inference: preference training rewards length, polish, agreement and emphasis; genre labels like "script", "hook" and "editorial" activate audience-directed, persuasion-heavy patterns from pretraining; the two compound. The subagent search found no direct genre-framing hype study. Treat this as the best-supported explanation, not an established result.

**Measured: what holds a register.**
- *Source-attribution framing helps a little.* Weller et al. (EACL 2024) showed that "according to [source]" prompting raises the share of output quoted directly from trusted text. In follow-up work it raised quoting only from 34.9% to 36.2% on NQ for Llama-2-7B-chat, while quote-tuning reached 54.5%.\[12\]\[13\] Framing the task as reporting from sources is directionally right, but the prompt alone is a weak lever.
- *Exemplars beat descriptions.* Jemama et al. (arXiv 2509.24930) found that zero-shot style imitation scored below 7% accuracy, and that statistical style summaries in the prompt "were not effective anchors". Few-shot prompting gave up to 23.5× higher style matching.\[14\] A companion study (Wang et al., EMNLP Findings 2025) found that few-shot output still defaults to a generic tone in informal domains, with diminishing returns beyond 4–5 examples.\[15\]\[16\] **Design rule:** anchor with 3–5 of the user's *own* plain paragraphs (his publication essays sound right to him), not with adjectives like "plain, factual, unpretentious".
- *Drift over long contexts is real but fixable by re-anchoring.* Li et al. (COLM 2024) reported "a significant instruction drift within eight rounds of conversations" in LLaMA2-chat-70B and GPT-3.5 and linked it to attention decay on the system prompt. ContextEcho (arXiv 2605.24279) found that re-inserting an anchor restored the deployed register with no measurable decay across the next 20 turns. **Design rule:** generate beat by beat, re-sending the register spec and exemplars with every call, rather than writing a long script in one pass.
- **Folklore (untested as written):** "ban audience-directed language", "claim-evidence-reaction" scaffolds and per-beat sentence templates. None has a controlled study for register. They are still the right tools, because they turn the register into something a deterministic check can verify, and earlier research already supports the linter-plus-one-rewrite approach.

### 2. Opening structure

**Measured:**
- *Curiosity gaps tend to backfire in news.* Scacco & Muddiman's 2016 experiment with 2,057 U.S. adults ("Investigating the Influence of 'Clickbait' News Headlines", Engaging News Project/Center for Media Engagement) found that question-based headlines produced "slightly more negative reactions" and "slightly decreased anticipated engagement with the news compared to traditional news headlines". Forward-reference teasers ("This is what happened next") were no different from traditional headlines. In their field analysis of 5,288 headlines, non-clickbait headlines got more engagement. Aubin Le Quéré & Matias (Scientific Reports 2024), in a meta-analysis of 8,977 Upworthy headline experiments, found that "when the baseline headline is too vague, higher headline concreteness increases clickthrough rates. When headlines are too concrete, higher headline concreteness decreases clickthrough rates." The goal is a specific statement with one open question, not a withheld fact.
- *Narrative aids recall.* Mar et al. (2021) pooled 150 effect sizes from more than 33,000 participants and found narrative texts better understood and recalled than expository ones (Hedges' g = .55). Dahlstrom (PNAS 2014) summarises studies where "narrative text was read twice as fast and recalled twice as well, regardless of topic familiarity or interest in the content itself." Hillier et al. (PLOS ONE 2016, 732 abstracts) found that more narrative abstracts were cited more, but this was confounded with journal identity.\[17\]\[18\]
- *Inverted pyramid vs. narrative: mixed results.* Experiments find narrative structure raises involvement or appreciation for some topics (adolescents, N = 706: one of two topics). One study found readers spent less time on inverted-pyramid stories yet recalled them better. Yaros (2006, N = 235) found that an explanatory structure beat the inverted pyramid on understanding of complex science news.\[19\]\[20\] **Reading:** lead with the core point for *comprehension*, and use narrative for *engagement and recall*. A hybrid ("hourglass": key point first, then chronology) captures both.\[21\]
- *Video attention.* Guo, Kim & Rubin (2014; 6.9M edX sessions) found median engagement time was at most 6 minutes regardless of video length. Kim et al. (2014; 862 videos) found that dropout "changes quite dramatically at the beginning" and that 61% of interaction peaks coincide with visual transitions.\[22\]\[23\]\[24\] These are lecture videos, not essays; use them as direction, not as targets.

**Folklore / platform metrics:**
- YouTube Studio's "Intro" metric is the share still watching after 30 seconds.\[25\]\[26\] That is a measurement window, not evidence of a rule. Claims like "over 33% drop off in the first 30 seconds" come from creator-tool blogs citing YouTube Creator Academy without data.\[27\] One vidIQ example fell from 95% to about 65% retention by 0:30 and then flattened.\[25\] That pattern is consistent with the edX dropout curve, but it is an n=1 anecdote.
- ABT (And-But-Therefore, Randy Olson) is a well-taught framework with a proposed "narrative index" (ratio of buts to ands).\[28\] I found no controlled trial of ABT itself. Its core move, establishing context and then introducing a contradiction, is the same tension that the narrative meta-analyses reward, so it is reasonable to use as a structural check.
- Toulmin and claim-evidence-reasoning are argument-quality frameworks, not engagement frameworks. Use them for the body, not the hook.

**Opening templates (testable):**

| # | Template (first ~30 s) | Evidence position |
|---|---|---|
| A. **Cold Receipt** | Read one concrete line from the strongest *scene-setting* document (a date, a name, an amount) → "That [document] says X. Here is what it led to / why it matters." → state the question and what the video will show | **Favoured.** Concrete and narrative (recall advantage), specific rather than vague (avoids the curiosity-gap penalty), and anchored to a receipt, which keeps the register plain. |
| B. **Headline Finding** | State the finding in one sentence with its number → name the source → "This video goes through how we know that, and what cuts against it" | **Favoured for comprehension** (inverted-pyramid evidence). Safest when the finding is strong and the audience came for an answer. |
| C. **Contradiction (ABT)** | "The official account is X [receipt]. The records show Y [receipt]. So this video asks: which is true, and why the gap?" | **Supported by inference** (tension plus specificity). Good default when two receipts conflict. |
| D. **Bare question / teaser** | "What if everything you knew about X was wrong?" | **Not supported.** Question and teaser framing tested slightly negative or null, and it is the template most likely to pull in the content-creator register. Ban it. |

Default: **A**, falling back to **B** when there is no scene-quality receipt. In both, the question and the promise ("by the end you will see…") must land within the first 3 beats (about 30 seconds). Previously established: the 11 sampled essays split evenly between statistic and anecdote openings, with no retention data either way. So A vs. B should be an A/B test on the user's own channel, not dogma.

### 3. Overall structure

**Measured:**
- *Counterarguments.* O'Keefe's meta-analysis (1999) found that *refutational* two-sided messages (raise the objection, then answer it) beat one-sided messages on both credibility and persuasiveness for non-advertising topics. *Non-refutational* two-sided messages (mention it, then move on) were significantly *less* persuasive. A later synthesis (O'Keefe & Hoeken 2021; k = 107, N = 20,111) found the overall sidedness effect averages near zero (r ≈ −0.002) with a wide prediction interval.\[29\]\[30\] The lesson is narrow but firm: if you raise an objection, answer it with a receipt or concede it explicitly. Never leave it dangling.
- *Pacing.* Visual transitions coincide with 61% of interaction peaks (Kim et al. 2014). Median engagement time is at most 6 minutes per video segment (Guo et al. 2014).\[24\]\[31\] Inference: put a receipt change (new document on screen) at least every 45–90 seconds, and plan chapters of 6 minutes or less.
- *Where the strongest receipt goes, and how endings work:* no measured study found. Craft practice (investigative features, the "hourglass") puts the decisive document late in the evidence run, after context makes it legible. Investigative manuals (UNESCO Story-Based Inquiry) stress ending on what the facts establish and what remains open, not on a moral.

**Default skeleton:** see Section 5.

### 4. Concept-first essays: the research phase

**Practitioner method (documented):**
- UNESCO's *Story-Based Inquiry* (Hunter et al., 2009/2011; 2nd edition 2025) is the standard investigative method. It treats "a story [as] only a hypothesis until verified": write the hypothesis, break it into checkable statements, map sources to each, verify, then revise or drop the hypothesis.\[32\]\[33\] This matches the user's need: a concept becomes a hypothesis, which is the thing the research phase tests.

**Measured (AI-assisted research):**
- *Atomic decomposition works as a check.* FActScore (Min et al., EMNLP 2023) splits text into atomic facts and checks each against a source. ChatGPT reached only 58% factual precision on biographies, and the automated estimator was within 2% of human scores. A typical generation contains 26–41 atomic facts. FActScore measures precision only, so a system that says less scores higher.\[34\]\[35\]\[36\]
- *Research before outlining improves structure.* STORM (Shao et al., NAACL 2024) uses multi-perspective question asking before outlining and produced articles judged better organised (+25% absolute) and broader in coverage (+10%) than an outline-driven RAG baseline.\[37\] Expert editors flagged "source bias transfer" and "over-association of unrelated facts" as new failure modes.\[38\]\[39\]
- *Deep-research agents still produce many unsupported claims.* DeepTRACE (2025) found citation accuracy ranging from 40–80% across systems and one-sided answers on 54.7–94.8% of debate queries.\[40\]\[41\] "Cited but Not Verified" (2026, 14 LLMs) found link validity above 94% and relevance above 80%, but factual accuracy of only 39–77%. A citation that exists and is on-topic still often fails to support the claim.\[42\] A separate study found LLM summaries overgeneralised scientific findings in 26–73% of cases even when prompted for accuracy (Peters & Chin-Yee, R. Soc. Open Sci. 2025).\[43\]

**Implication:** the pipeline must check *support* at the receipt level (a quoted span that entails the sub-claim), not just that a citation exists. The thesis must come from sub-claim verdicts, never be written first.

**Proposed concept → outline pipeline:**
1. **Concept → hypothesis (USER DECIDES).** The system proposes 2–3 falsifiable hypotheses from the concept; the user picks or edits one. This is the only creative call that sets the direction.
2. **Hypothesis → atomic sub-claims (SYSTEM).** Split into 5–12 checkable sub-claims, each tagged with what would confirm it and what would refute it.
3. **Perspectives & counter-hypothesis (SYSTEM).** STORM-style: generate questions from at least three stakeholder perspectives, including a deliberate steelman of the opposite conclusion.
4. **Source gathering & triage (SYSTEM).** Rank sources primary > official > reported > commentary. Store each receipt as an exact quoted span with locator.
5. **Support check (SYSTEM).** For each sub-claim and receipt pair, verify that the quoted span entails the claim (supports / contradicts / insufficient). Mark sub-claims with no supporting span as UNSUPPORTED. Never paraphrase them into the script.
6. **Evidence map → verdict (USER CONFIRMS).** Show a table: sub-claim × verdict × strongest receipt × strongest counter-receipt. The system proposes the thesis that the verified sub-claims actually support (which may be narrower than the hypothesis). The user accepts or adjusts it. Second human decision.
7. **Outline (SYSTEM).** Fill the fixed skeleton automatically from the map (Section 5).

## The Fixed Formula (Script Spec v1)

**A. Task framing (always).** Never send "write a script/hook/essay". Send: *"Report the following verified claims to a listener. For each beat, write the SAID text using only the attached receipt spans. You are transcribing what the documents show."* Include 3–5 exemplar paragraphs from the user's own plain writing, and re-send framing plus exemplars with every beat call.

**B. Beat schema (every beat has these fields).**
- `beat_id`, `section` (from skeleton)
- `claim` (one atomic sentence, or `none` for transitions)
- `receipt_ids` (≥1 for any factual claim; exact span + locator)
- `claim_type`: `fact` | `inference` | `uncertainty` | `counter`
- `confidence`: `established` | `likely` | `contested`
- `SAID` (narration, ≤3 sentences)
- `on_screen` (which receipt is shown)

**C. Section skeleton.**
1. **Cold Receipt** (1–2 beats): Template A or B.
2. **Question & Promise** (1 beat, done by ~0:30): the question, and what the viewer will have seen by the end.
3. **Context** (2–4 beats): minimum background, each beat with a receipt.
4. **Evidence Run** (N beats, grouped into chapters of 6 minutes or less): one sub-claim per block, in an order that builds; strongest receipt at the end of the run; a receipt change every 45–90 seconds.
5. **What Cuts Against This** (≥1 block): the strongest counter-receipt from the evidence map, then a refutation with a receipt *or* an explicit concession. Placed after the evidence run and before the verdict.
6. **Verdict & Limits** (1–3 beats): what the receipts establish, at what confidence; what remains unknown; where the viewer can read the sources. No moral, no call to action.

**D. Register rules (enforced by a linter).**
- Allowed sentence frames: "[Source] says/shows/records X." / "That means Y." / "We don't know Z." / "This cuts against it: …"
- Banned: second-person audience address outside the Promise beat ("you won't believe", "let's dive in", "imagine"); rhetorical questions outside beat 2; "it's not X, it's Y"; tidy-moral closers; the Reinhart high-ratio word list (tapestry, delve, intricate, underscore, amidst, palpable, vibrant…); participial-clause openers; emojis, lists and exclamation marks in SAID.\[2\]
- Sentence-length variance floor (flag a beat if its standard deviation falls below that of the user's exemplars).

**E. Automatic checks (run after each beat; one targeted rewrite, then flag to the user).**
1. **Support check:** every `fact` beat's claim is entailed by its receipt span, otherwise rewrite or downgrade it to `uncertainty`.
2. **Unsupported-sentence check:** atomic decomposition of SAID; any atomic fact without a receipt is a fail.
3. **Register lint:** banned-pattern counts, participial and nominalization rate against the user exemplar baseline, sentence-length variance.
4. **Structure check:** question and promise by beat 3; at least one `counter` beat with a refutation or concession; strongest receipt in the evidence run; final beat contains the `uncertainty` type.
5. **Overclaim check:** confidence wording matches `confidence` (no "proves" on `likely`).

**F. Where to stay flexible.**
- *Voice is user-chosen; register is locked.* Exemplars can come from any voice the user likes. The bans above are fixed.
- *Opening choice (A vs. B vs. C):* this is an empirical question for the user's audience; test it rather than hard-code it.
- *Section lengths:* the 6-minute chapter and the 45–90 second receipt cadence are inferences from lecture-video data, not essay data.

## Caveats

- No peer-reviewed study tests openings, counterargument placement or endings for YouTube video essays specifically. The opening and structure rules extrapolate from headline experiments, text-comprehension meta-analyses and MOOC analytics.
- The causal story for "script framing → promotional register" is inferred from reward-bias and genre-style studies; it has not been directly measured.
- Several AI-research numbers come from 2025–2026 preprints (DeepTRACE, Cited but Not Verified, ContextEcho, Rallapalli et al.) and may change on review.
- O'Keefe's later work shows message-design effects are small and inconsistent on average.\[30\] The refute-don't-mention rule is the most defensible one, but no structural rule guarantees retention.

## Sources

1. [Interpretable Stylistic Variation in Human and LLM Writing Across Genres, Models, and Decoding Strategies](https://arxiv.org/abs/2604.14111)
2. [Do LLMs write like humans? Variation in grammatical and rhetorical styles](https://arxiv.org/html/2410.16107v2)
3. [Research Shows That AI-Generated Slop Overuses Specific Words](https://futurism.com/the-byte/ai-overuses-specific-words)
4. [Delving into LLM-assisted writing in biomedical publications through excess vocabulary](https://arxiv.org/html/2406.07016v5)
5. [A Long Way to Go: Investigating Length Correlations in RLHF](https://arxiv.org/abs/2310.03716)
6. [A Long Way to Go: Investigating Length Correlations in RLHF](https://arxiv.org/html/2310.03716v2)
7. [Does style matter? Disentangling style and substance in Chatbot Arena - LMSYS Org](https://www.lmsys.org/blog/2024-08-28-style-control/)
8. [Chatbot Arena](https://aiwiki.ai/wiki/lmsys_chatbot_arena)
9. [From Lists to Emojis: How Format Bias Affects Model Alignment](https://arxiv.org/abs/2409.11704)
10. [Towards Understanding Sycophancy in Language Models](https://arxiv.org/html/2310.13548v4)
11. [Style Over Substance: Evaluation Biases for Large Language Models](https://arxiv.org/abs/2307.03025)
12. [“According to . . . ”: Prompting Language Models Improves Quoting from Pre-Training Data - ACL Anthology](https://aclanthology.org/2024.eacl-long.140/)
13. [Verifiable by Design: Aligning Language Models to Quote from Pre-Training Data](https://arxiv.org/pdf/2404.03862)
14. [How Well Do LLMs Imitate Human Writing Style? Rebira Jemama](https://arxiv.org/pdf/2509.24930)
15. [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors](https://www.alphaxiv.org/abs/2509.14543)
16. [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors — Lacuna](https://lacuna.tiptreesystems.com/work/catch-me-if-you-can-not-yet-llms-still-struggle-to-imitate-the-implicit-writing/wrk_538ca421af66d4cbb1bfcfbc53dec074)
17. [(PDF) Narrative Style Influences Citation Frequency in Climate Change Science](https://www.researchgate.net/publication/311701701_Narrative_Style_Influences_Citation_Frequency_in_Climate_Change_Science)
18. [\[PDF\] Narrative Style Influences Citation Frequency in Climate Change Science](https://www.semanticscholar.org/paper/Narrative-Style-Influences-Citation-Frequency-in-Hillier-Kelly/706b4eeeb1e4dcc20a7cd87a24706cfd0293b65c)
19. [Does Storytelling Help Adolescents to Process the News?](https://www.researchgate.net/publication/276369114_Does_Storytelling_Help_Adolescents_to_Process_the_News)
20. [Is It the Medium or the Message? Structuring Complex News to Enhance Engagement and Situational Understanding by Nonexperts - Ronald A. Yaros, 2006](https://journals.sagepub.com/doi/10.1177/0093650206289154)
21. [Article structure](https://en.wikipedia.org/wiki/Article_structure)
22. [(PDF) How video production affects student engagement: An empirical study of MOOC videos](https://www.researchgate.net/publication/262393281_How_video_production_affects_student_engagement_An_empirical_study_of_MOOC_videos)
23. [(PDF) Understanding in-video dropouts and interaction peaks inonline lecture videos](https://www.researchgate.net/publication/262320238_Understanding_in-video_dropouts_and_interaction_peaks_inonline_lecture_videos)
24. [MIT Libraries logoDSpace@MIT](https://dspace.mit.edu/handle/1721.1/90413)
25. [YouTube Audience Retention: What's a Good Rate and How to Improve It?](https://vidiq.com/blog/post/increase-audience-retention-youtube/)
26. [YouTube Audience Retention 2026: Read the Curve & Keep Viewers Watching](https://socialrails.com/blog/youtube-audience-retention-complete-guide)
27. [The Ultimate Guide to YouTube Audience Retention (2025)](https://www.retentionrabbit.com/blog/ultimate-guide-youtube-audience-retention)
28. [More Conversations with Randy Olson about the use of narratives in science](https://ian.umces.edu/blog/more-conversations-with-randy-olson-about-the-use-of-narratives-in-science/)
29. [\[PDF\] How to Handle Opposing Arguments in Persuasive Messages: A Meta-Analytic Review of the Effects of One-Sided and Two-Sided Messages](https://www.semanticscholar.org/paper/How-to-Handle-Opposing-Arguments-in-Persuasive-A-of-O%E2%80%99Keefe/f1b60f3edc56b5a4aeb4bbb9c13c990219b0303d)
30. [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.664160/full)
31. [How Video Production Affects Student Engagement:](https://summeracademy.academic.wlu.edu/files/2020/07/Guo-et-al-2014-videos-and-student-engagement.pdf)
32. [Story-Based Inquiry: A Manual for Investigative Journalists (New Full Text Book From UNESCO, Free) - Library Journal infoDOCKET](https://www.infodocket.com/2011/07/19/story-based-inquiry-a-manual-for-investigative-journalists-new-full-text-book-from-unesco-free/)
33. [Story-Based Inquiry](https://tcij.org/handbooks/story-based-inquiry/)
34. [FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation](https://arxiv.org/pdf/2305.14251)
35. [FactScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation](https://ai.meta.com/research/publications/factscore-fine-grained-atomic-evaluation-of-factual-precision-in-long-form-text-generation/)
36. [FACTSCORE: Fine-grained Atomic Evaluation of Factual ...](https://martiansideofthemoon.github.io/assets/factscore.pdf)
37. [Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models - Scholar Inbox](https://www.scholar-inbox.com/paper/Shao2024ARXIV_Assisting_in_Writing_Wikipedia)
38. [Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models - ACL Anthology](https://aclanthology.org/2024.naacl-long.347/)
39. [\[PDF\] Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models](https://www.semanticscholar.org/paper/Assisting-in-Writing-Wikipedia-like-Articles-From-Shao-Jiang/2fcad63cc68ca74acdfafdbc145325ee59952f24)
40. [DeepTRACE: Auditing Deep Research AI Systems for Tracking Reliability Across Citations and Evidence](https://arxiv.org/pdf/2509.04499)
41. [DeepTRACE: Auditing Deep Research AI Systems for Tracking Reliability Across Citations and Evidence](https://arxiv.org/html/2509.04499)
42. [Cited but Not Verified: Parsing and Evaluating Source Attribution in LLM Deep Research Agents](https://arxiv.org/html/2605.06635v1)
43. [Generalization bias in large language model summarization of scientific research](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12042776/)
