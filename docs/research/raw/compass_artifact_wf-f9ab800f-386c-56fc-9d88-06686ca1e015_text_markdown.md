# Aldershot Format Modes: Evidence-Based Design for React Mode and Its Sibling Formats

React mode should be built around one rule: every source-clip segment must be followed by commentary about that specific clip. The law and platform policy support that rule. Nothing supports a fixed clip-to-commentary ratio, because no court, no YouTube policy and no measured study sets one. The proposed per-gap narration defaults are mostly right. The fact-check gap needs reworking into "anchored freestyle". The document read-through and Shorts modes need structural changes.

## TL;DR

- **Structure and policy:** No measured data exists on how much of a reaction video is clip versus commentary. YouTube's reused-content policy, which it explicitly left unchanged in the July 15, 2025 "inauthentic content" update, judges whether "viewers can tell that there's a meaningful difference" and applies "to your channel as a whole". Pacing should therefore be a set of configurable flags plus an engagement-per-clip check, not a ratio.
- **Transcripts and law:** The official YouTube Data API can't give you captions of other people's videos, because `captions.download` "requires the user to have permission to edit the video". The YouTube Terms bar automated access (scrapers) without written permission. The legitimate routes are user-supplied transcripts, speech-to-text on lawfully held files, manual use of YouTube's on-page transcript, and creator permission. US fair use (*Hosseinzadeh v. Klein*) and Canadian fair dealing (*CBC v. Conservative Party*, 2021 FC 425) both favour short clips interspersed with criticism. Canada adds a hard requirement to mention the source and author.
- **Narration:** Listeners reliably hear the difference between read and spontaneous speech (87.3% correct identification in Adigwe, Wallbridge and King's Interspeech 2024 study). Scripted lines should therefore be confined to descriptive or factual content written to audio-description rules: objective, present tense, no interpretation, fitted to the gap. Opinion should be freestyle from a cue card. Fillers should be trimmed toward about 5 per minute, not to zero.

## Key Findings

Evidence labels used throughout: **[Measured]** = empirical study with data; **[Policy/Standard]** = platform policy, legal text, court decision or official guideline; **[Practitioner]** = professional consensus or practitioner guidance; **[Inference]** = my reasoning from the above.

### 1. How react, commentary and response videos are actually structured

- **[Measured — thin]** I found no peer-reviewed or systematic content analysis of how reaction videos are built. That covers four things: clip share of runtime, pause-and-comment versus talk-over versus picture-in-picture, interruption frequency, and segment lengths. A dedicated subagent search confirmed the gap.
- **[Measured — qualitative]** The most recent peer-reviewed study is "Watch Me Watch: Reaction Videos as a Social Form of Online Video Engagement" (Okyere, Bautista Isaza, Pyon, Ogbonnaya-Ogburu, Niu and Lee, *Proceedings of the ACM on Human-Computer Interaction*, 2026). It is based on 16 semi-structured interviews with regular viewers.\[1\]
  - More than half of the participants had watched reaction videos for over five years, and six watched daily.\[2\]
  - Findings "highlight the significance of emotional connections with reactors, the value of communal experiences centered on shared interests, and the role of RVs in facilitating content discovery and critique."\[1\]
  - Viewers "form parasocial bonds with reactors." They valued "watching multiple reactors interpret the same content, as each reaction offered distinct perspectives, humor, or cultural context."\[1\]\[2\]
  - The paper is qualitative. It does not rank commentary against expertise or authenticity numerically.
- **[Measured — n=4, unreviewed thesis]** Carrêlo (2023, Malmö University) coded the 4 most-viewed videos in the REACT channel's series.\[3\]
  - The recurring structure was "intro, reaction to content, 'question time' and 'endslate'". Runtimes were about 10–16 minutes.\[3\]
  - In one video "the video shown to the teens only occupied the first 2 minutes". That is roughly 2 of 15 minutes of source clip, and the video was "mainly being a discussion rather than a reaction."\[3\]
  - This is the only clip-share figure I found, and it describes a panel-reaction format, not commentary.
- **[Measured — qualitative]** Media-studies work treats the genre as a hybrid "in-between media text and media reception; in-between narrative and sensation; in-between authenticity and performativity" (Bliss & Nansen, *Television & New Media*, 2023).
  - The usual visual form is close-ups of the reactor beside "a divided screen showing the content that they react to" (Meng & Bliss, 2026).\[4\]
  - Authenticity in reaction videos is "performed and received rather than inherent" (Cox, BYU thesis, 2023).\[5\]
- **[Policy/Standard]** The best "documented structure" evidence comes from a court. In *Hosseinzadeh v. Klein* the judge distinguished two kinds of reaction video:
  - videos that "intersperse short segments of another's work with criticism and commentary";\[6\]
  - videos that are "more akin to a group viewing session."\[6\]
  - The Klein video used 3 min 15 s of a 5 min 24 s source inside a video that Judge Katherine B. Forrest described as "almost fourteen minutes long" and that "intersperses relatively short segments of the Hoss video with long segments of the Kleins' commentary." That is about 60% of the source but only about 23% of the reaction video's runtime.
- **[Folklore — do not use]** Figures such as "40 to 50 percent of your video should be your original commentary" or "12 to 25 minute" runtimes come from creator-marketing blogs with no stated method.\[7\]

**Cheap way to measure it [Inference]:** Annotate 20–40 videos per subgenre: music/entertainment react, political commentary, debunk/rebuttal, and expert breakdown. Watch them normally on the platform with a keystroke-logging timer, so no downloading or scraping is involved. Run automated analysis only on files the user lawfully holds. Measure:
- source-on-screen seconds versus creator-voice seconds;
- the proportion of creator speech that happens while the source is paused, ducked or still playing (pause-and-comment versus talk-over);
- layout (full-screen source, picture-in-picture, split screen, creator-only);
- the distribution of clip-segment lengths (median and 90th percentile);
- the distribution of commentary-segment lengths;
- interruptions per source-minute;
- the longest unbroken clip run;
- the proportion of the source work used (seconds used ÷ source length);
- whether each commentary segment refers to the clip just played (coded yes/no).

Compare medians across subgenres and against the user's own retention analytics. This yields calibrated defaults instead of guesses.

### 2. YouTube policy for reaction and clip-heavy content

- **[Policy/Standard]** The July 15, 2025 entry on YouTube's monetization-policy page says: "We're making a minor update to our 'repetitious content' policy to better clarify this includes content that is repetitive or mass-produced. We are also renaming this policy from 'repetitious content' to 'inauthentic content.'… There is no change to our reused content policy which reviews content like commentary, clips, compilations, and reaction videos."\[8\]
- **[Policy/Standard]** The reused-content policy covers content repurposed "without adding significant original commentary, substantive modifications, or educational or entertainment value."\[8\]
  - The core test: "we allow reused content if viewers can tell that there's a meaningful difference between the original video and your video."\[8\]
  - Allowed examples include "Using clips for a critical review" and "Reaction videos where you comment on the original video."\[8\]
  - Disallowed examples include "Clips of moments from your favorite show edited together with little or no narrative", "Content that gets views from mostly non-verbal reactions to your videos without added voice commentary", and "Content that exclusively features readings of other materials you did not originally create, like text from websites or news feeds."\[8\]
- **[Policy/Standard]** Three enforcement features matter most for design:
  - The policy "applies to your channel as a whole… monetization may be removed from your entire channel."\[8\]
  - It "applies even if you have permission from the original creator."\[8\]
  - It "is separate from YouTube's Copyright enforcement… it's not based on copyright, permission, or fair use."\[8\]
  - Reviewers may look at the channel's "Main theme", "Most viewed videos", "Newest videos", "Biggest proportion of watch time", and its metadata and "About" section.\[8\]
- **[Policy/Standard]** The inauthentic-content rule (formerly "repetitious") targets "content that looks like it's made with a template, or that may feel repetitive to viewers after watching several videos in a row from the same channel." Its examples include "AI-generated content made with generic or unoriginal templates giving the impression of mass production without adding the creator's original, authentic insights or perspective."\[8\]
  - The same page now lists "Unsatisfying or Off-putting Content" and "AI Personas Related to Sensitive Topics", which covers AI personas giving legal or political advice.\[8\]
  - Allowed: "Same intro and outro for your videos, but the bulk of your content is different."\[8\]
- **[Policy/Standard]** On Content ID and fair use:
  - YouTube says "Automated systems like Content ID can't decide fair use because it's a subjective, case-by-case decision that only courts can make."\[9\]
  - YouTube "can't determine what qualifies for exceptions to copyright, such as fair use or fair dealing."\[10\]
  - When a Content ID claim is disputed, the claimant is notified. "If the claimant doesn't respond within 30 days, the claim on your video will expire."\[10\]
  - YouTube has said rights holders can set Content ID policies "depending on the proportion of a claimed video that contains their work, or the absolute length of the clip used."\[11\] Claims can therefore follow length thresholds that have nothing to do with fair use or fair dealing. Rights holders do not publish those thresholds.
- **[Reporting — secondary]** Industry coverage of 2026 enforcement describes terminations of mass-produced AI "slop" channels. XDA Developers (January 29, 2026), citing Kapwing's updated November 2025 report, says "16 of the top 100 channels have been removed from YouTube", with over 35 million subscribers combined, 4.7 billion lifetime views and $10 million in annual earnings. These figures come from Kapwing's report, not from YouTube. Reputable coverage and YouTube's own creator liaison describe the 2025 change as a clarification, not a crackdown on reaction channels.\[12\] Treat claims that "reaction channels are most at risk" as creator-blog speculation.\[13\]
- **[Policy/Standard]** **No official clip-to-commentary ratio exists.** YouTube's policy gives examples and a "meaningful difference" test, not a number.

### 3. Legitimate transcript access for other people's videos

- **[Policy/Standard]** The YouTube Data API documentation says `captions.download` "is requires [sic] the user to have permission to edit the video". It costs 200 quota units and returns `forbidden (403)` when "The permissions associated with the request are not sufficient."\[14\] `captions.list` (50 units) lists tracks but "does not contain the actual captions."\[15\] The official API therefore cannot fetch third-party captions, whatever scope or key is used.\[16\]
- **[Policy/Standard]** The YouTube Terms of Service (current main version) prohibit two things:
  - accessing, reproducing or downloading any Content "except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube and, if applicable, the respective rights holders";\[17\]
  - accessing "the Service using any automated means (such as robots, botnets or scrapers) except (a) in the case of public search engines, in accordance with YouTube's robots.txt file; or (b) with YouTube's prior written permission."\[17\]
  - Some regional versions of the Terms add "(c) as permitted by applicable law".\[18\] Which version binds a Canadian user, and whether Canadian fair dealing counts as "applicable law" here, are questions for counsel.
  - Unofficial transcript libraries that fetch captions "the way the player does" are automated access outside the API.\[16\] They fall within the scraping prohibition.
- **[Policy/Standard]** YouTube's own on-page transcript is an expressly provided feature: "You can see the full transcript of any video that has captions… In the video description, click Show transcript."\[19\] A user reading or manually copying it uses the service as offered. Having Aldershot fetch it automatically would not be.
- **Legitimate routes, ranked by risk [Inference]:**
  1. The user's own videos, through the official API with ownership.
  2. A transcript or caption file supplied by the creator or rights holder, with written permission.
  3. Speech-to-text on a media file the user lawfully possesses: a broadcaster's press copy, a file from the creator, a government or court recording, or a platform's own sanctioned download feature where its terms allow that use.
  4. The user manually copying YouTube's "Show transcript" text and pasting it into Aldershot, labelled as user-supplied.
  5. Third-party transcript services. Read their terms. Many put all responsibility for lawful sourcing on the user through indemnities, so using them shifts risk to the user without removing it.
- **[Inference]** Whatever the route, the transcript is only an index. Under the earlier finding that ASR hallucinates, every quote must be re-heard against the media before publication.

### 4. Fair dealing (Canada) versus fair use (US) for reaction videos

- **[Policy/Standard — US]** *Hosseinzadeh v. Klein*, 276 F. Supp. 3d 34 (S.D.N.Y. 2017):
  - "Any review of the Klein video leaves no doubt that it constitutes critical commentary of the Hoss video; there is also no doubt that the Klein video is decidedly not a market substitute."\[20\]
  - The copying was "plainly necessary" to the critique.\[21\] The source being a creative work weighed against fair use but did not change the result.\[22\]
  - The court warned: "the Court is not ruling here that all 'reaction videos' constitute fair use."\[23\]
  - On June 19, 2025, Ethan Klein's company Ted Entertainment sued Twitch streamers Denims, Frogan and Kaceytron, whose reactions allegedly played his whole video with minimal commentary. Kaceytron settled. In *Ted Entertainment v. Saber*, Judge Wesley Hsu granted Denims judgment on the pleadings, "holding her nearly four-hour livestream reaction… was fair use as a matter of law" (Copyright Lately, Aaron Moss, update dated June 29, 2026). So even long co-viewing streams can win, and the "group viewing session" line gives rights holders less protection than the *Hosseinzadeh* caveat suggested.
- **[Policy/Standard — Canada]** Copyright Act s. 29.1: "Fair dealing for the purpose of criticism or review does not infringe copyright if the following are mentioned: (a) the source; and (b) if given in the source, the name of the (i) author… (ii) performer…" Section 29 separately covers parody and satire, and s. 29.2 covers news reporting, with the same mention requirement.\[24\]
- **[Policy/Standard — Canada]** *Canadian Broadcasting Corporation v. Conservative Party of Canada*, 2021 FC 425:
  - The clips used were under ten seconds each, plus tweets under a minute long drawn from a two-hour debate. The court held this was a "substantial part" of the works but still fair dealing for criticism.\[25\]
  - Criticism "is not limited to criticism of the work itself but extends to the idea set out in the work," including the actions it depicts.\[26\]
  - The attribution requirement is "met if the source is identified or identifiable to a reasonably informed watcher" (para. 85).\[27\]
  - The fairness analysis follows the Supreme Court of Canada's six *CCH* factors: purpose, character, amount, alternatives, nature of the work, and effect.\[28\]
- **[Policy/Standard — Canada]** *United Airlines v. Cooperstock*, 2017 FC 616: a gripe site qualified as parody but failed the fairness test. Its purpose was found to be to defame and punish rather than to mock with humour, the amount taken was excessive, and less confusing alternatives existed.\[29\]\[30\]
- **Difference that matters [Policy/Standard + Inference]:** US fair use asks whether a use is "transformative", and attribution is not formally required. Canadian fair dealing first requires an enumerated purpose plus, for criticism or review, the mention of source and author. Only then does it weigh fairness. For a Canadian creator, attribution is a gate, not a courtesy, and tone and purpose (criticism versus punishment) are judged.
- **Design implications [Inference]:**
  1. Each clip must be followed by commentary that engages with that clip.
  2. Unbroken clip runs should be flagged.
  3. The share of the source work used should be tracked.
  4. On-screen attribution of source and author must appear at first use.
  5. The system should prompt for "why this clip is necessary".
  6. Linter rules should catch insult-only gaps that read as punishment rather than criticism.

### 5. Finding "the moments worth reacting to"

- **[Measured]** Check-worthiness detection is the most mature signal. In CLEF-2023 CheckThat! Task 1B (English political debates), the top systems reached F1 0.898 and 0.878 on the positive class. Results were weaker on harder data: Arabic tweets 0.809, Spanish 0.641, and multimodal tweets 0.712.\[31\]\[32\]
  - Human annotators agree only moderately on what is check-worthy (Cohen's kappa 0.49 on the 2023 multimodal test set).\[31\]
  - This works best on debate-style transcribed speech, which is close to Aldershot's input.
- **[Measured]** Audio audience-response cues are reliable in clean audio. One highlight sound-effects detector reported laughter precision/recall of 0.927/0.879 and applause 0.910/0.850. Performance degrades "when sound effects are mixed with music, speech."\[33\]
  - A simple applause detector retrieved 491 of 500 applause segments in 50 hours of meeting audio, with 38 false hits.\[34\]
  - Laughter marks audience response, not importance.
- **[Measured]** Detecting humour from speech is weak. A humour classifier trained on real conversational speech reached F1 63.2 and accuracy 73.9.\[35\] Do not let the system decide what is "funny".
- **[Measured — dataset]** Rhapsody (2025) frames podcast highlight detection as segment-level classification over 13K episodes. Its labels come from YouTube's "most replayed" data, which shows highlight detection can be approximated from transcripts plus audio.\[36\] I did not obtain its accuracy figures.
- **[Inference — no numbers gathered]** I found no measured accuracy figures for:
  - argument mining and rhetorical-move detection (claim, concession, appeal, attack, hedge);
  - contradiction detection against a source library;
  - prosodic emphasis (pitch and energy peaks, sudden changes in speaking rate).
  
  Treat all three as candidate-generators that a human confirms, not as verdicts.
- **Clip boundaries that keep context [Inference + journalistic practice]:** Cut at sentence boundaries and in natural pauses.
  - Include the question or prompt the speaker is answering.
  - Extend forward through any qualifier that follows ("but", "unless", "except", "to be fair").
  - Show the user ±2 sentences of surrounding transcript with a required "context preserved" confirmation before a clip is locked.

### 6. Scripted vs freestyle vs mixed narration

- **[Measured]** Listeners detect read speech. In an Interspeech 2024 study by Adigwe, Wallbridge and King, participants "correctly identified the conversational sample 87.3% of the time" when paired with a read-aloud version by the same speaker. Zurich German listeners identified read versus spontaneous speech well above chance (mean A′ = 0.82) "based on very subtle cues."\[37\]
  - The cues: spontaneous speech has "more variation in f0 contours, an increased speech rate, hypoarticulation, hesitations, repetitions, partial words, and disfluencies."\[38\]
  - A 2026 deepfake-perception study found spontaneous interview speech easier to judge as real than audiobook-style read speech for Spanish listeners.\[39\]
  - **Implication [Inference]:** a scripted line inside an otherwise freestyle video will be audible as a register switch. Use it where a "reading" register is appropriate (stating facts, describing footage), not for opinion.
- **[Measured]** Fillers:
  - Laske and DiGennaro Reed (2024, *Journal of Applied Behavior Analysis* 57(3)) tested speeches with 0, 2, 5 and 12 fillers per minute. They found 12 per minute hurt perceived effectiveness and credibility, and "a rate of five or fewer disfluencies per minute may be acceptable."\[40\]
  - A 2026 *Cognition* study using spontaneous speech found disfluency "does not reduce perceived person-level competence and trustworthiness."\[41\]
  - Fillers carry information: listeners expect new information after "um" (Barr & Seyfeddinipur, 2010).\[42\]\[43\]
  - **Implication:** trim fillers toward about ≤5 per minute, not zero.
- **[Measured — qualitative]** Viewers watch reaction videos for "emotional and social connection" and parasocial bonds (Watch Me Watch, 2026).\[2\] This supports keeping the user's own voice and opinion unscripted.
- **[Policy/Standard]** Audio-description standards for descriptive lines:
  - DCMP Description Key: "Describe what you see"; "Describe from general (global) to specific (local)"; "Describe objectively, without interpretation, censorship, or comment"; "don't interpret emotion or reasoning"; "Use present tense, active voice"; "Do not try to fill every pause"; "Avoid describing over audio that is essential to comprehension."\[44\]\[45\]\[46\]
  - CAB/AMI Described Video Best Practices (Canada, developed with CRTC support): description should be "clear, concise, accurate, relevant, and written in the present" tense, follow "broadcast writing/writing for the ear", and use transition words: "then" for back-to-back scenes, "now" after a straight cut, "later" for passage of time.\[47\]\[48\]
  - Ofcom: description "should not encroach on dialogue", and when time is short "it is better to focus on key moments."\[49\]
  - None of these standards sets a per-gap word limit. They set rate and priority rules.
- **Transfer to react videos [Inference]:**
  - These rules transfer well to *setup/context* lines: who, where, what is on screen, what was said just before.
  - They transfer poorly to commentary, which is meant to interpret. Audio description bans interpretation.
  - Words per gap is best derived from gap length × the user's own measured speaking rate from his previous takes, minus a pause at each end.
- **Evaluation of proposed defaults:**
  - *Setup = scripted*: **supported**. It is descriptive and benefits from audio-description rules, and the reading register is acceptable for it.
  - *Opinion reaction = freestyle*: **supported** by detectability of read speech and by the parasocial value viewers report. It is also the safest route under the earlier finding that LLM-written opinion reads as fake.
  - *Fact-check = mixed*: **partly supported, but restructure.** The risk is the audible switch between a read line and a freestyle line. Replace it with **anchored freestyle**:
    - The cue card shows the verdict, the exact number, the source name and a date.
    - The user says them in his own words.
    - The linter checks the take's transcript for the locked tokens (number, name, date) and flags any that are missing or altered.
    - Keep a fully scripted verdict only for legally sensitive wording, such as allegations about named people.

### 7. Cue cards for freestyle

- **[Inference — no measured study found]** I found no controlled study of cue-card composition (bullet count, keywords versus sentences) for unscripted speech. The design below combines three things: the measured read-versus-spontaneous findings (sentences on a card get read, and reading is audible); filler tolerance (≤5 per minute is acceptable); and audio-description priority rules (lead with what matters). Treat it as a hypothesis to A/B test on the user's own takes.
- **Card content [Inference]:** Use keywords and fragments, not sentences, so the card can't be read aloud verbatim. Include:
  - **what happened** (≤8 words);
  - **why it matters** (≤8 words);
  - **one receipt**: a number, a date or a document, locked if it will be checked;
  - **one suggested angle** framed as a question ("Who benefits if this is wrong?");
  - a **target duration**.
  
  Limit the card to 3–4 lines.
- **Capture and trim [Measured where noted + Inference]:**
  - Record 2–3 takes per gap and let the user pick one.
  - Trim leading and trailing dead air and abandoned false starts.
  - Shorten long internal pauses, but keep short breaths.
  - Reduce fillers only to about ≤5 per minute (Laske & DiGennaro Reed 2024). Keep fillers that come right before new information (Barr & Seyfeddinipur 2010).
  - Never make cuts that create pitch or room-tone jumps. Flag any trim that removes more than about a third of a take for user review, because heavy cutting turns spontaneous speech into "edited" speech.

### 8. Mode taxonomy

- **[Policy/Standard — academic framework]** Bill Nichols' six documentary modes are expository, poetic, observational, participatory, reflexive and performative. In his scheme a dominant mode "does not determine every aspect of a film's organization", and modes mix.\[50\]\[51\] In Nichols' terms, most of Aldershot's list is *expository* (argument-led narration) or *participatory/reflexive* (the journalist on screen, showing his method).
- **Assessment of the proposed list [Inference]:**
  - **Merge:** Rebuttal/response and react run on the same engine and differ only in what drives the structure: the opposing video's claim map versus its beats. Make rebuttal a react preset.
  - **Merge:** Correction/follow-up and fact-check short share the verdict pipeline. Keep correction as a distinct preset only because of its fixed ethical skeleton: what was wrong, what is right, how it happened.
  - **Re-classify:** Shorts cut-down is not a mode. It is a **render target**: aspect ratio, maximum length and a hook-first reorder, applied to any mode's output.
  - **Restructure:** Document read-through must not be mostly reading. YouTube's reused-content policy disallows content that "exclusively features readings of other materials you did not originally create". The mode must interleave excerpts with analysis.
  - **Missing:**
    1. **Investigation/accountability report**: participatory mode, driven by the user's own reporting, with interviews, documents and a right-of-reply step. This is the user's core genre.
    2. **Footage verification/evidence walkthrough**: establishing where, when and who for a viral clip.
    3. **Explainer**: concept-driven expository, distinct from a thesis-driven essay.
    4. **Developing-story update**: short, dated, and linked to a previous video.

## (a) React-mode spec

**Pipeline**

1. **Intake:** source media via a lawful route (§3). Record the source title, author/performer and URL, which are required for s. 29.1 attribution.
2. **Transcribe and align** with word timestamps. Mark low-confidence spans for re-hearing.
3. **Segment into beats:** sentence boundaries, topic shifts, speaker turns.
4. **Score beats** (rubric below), then rank and present the top candidates. The user selects them. The system never auto-publishes picks.
5. **Set clip boundaries** using the context rules in §5. The user confirms "context preserved".
6. **Assign gap types** with narration-style defaults (table below).
7. **Draft:** scripted descriptive lines (audio-description rules), cue cards for freestyle, locked tokens for anchored freestyle.
8. **One-take record** using the existing chunked record block. Align, split and trim (§7).
9. **Run the linter suite:** pacing flags, engagement-per-clip check, attribution check, locked-token check, filler-rate check, and re-hearing of every quote.
10. **Render.** An optional Shorts target is available.

**Beat scoring rubric** (weights configurable; every signal is a candidate-generator, and the human decides)

| Signal | Source | Evidence strength | Default role |
|---|---|---|---|
| Check-worthy factual claim (number, named entity, causal claim) | Transcript | Measured: F1 ≈0.88–0.90 on English debates; human κ 0.49 | High weight |
| Contradiction with user's source library | Transcript + user documents | No measured figure obtained | High weight, must show the source passage |
| Rhetorical move (assertion, attack, concession, appeal to authority) | Transcript | No measured figure obtained | Medium |
| Audience response (laughter, applause) | Audio | Measured: P/R ≈0.85–0.93 in clean audio | Medium; marks response, not importance |
| Prosodic emphasis (pitch/energy peak, rate change) | Audio | No measured figure obtained | Low–medium tiebreaker |
| Quotability (self-contained, short, attributable sentence) | Transcript | Inference | Medium |
| User's own flag while watching | User | — | Overrides all |
| ASR confidence | Transcript | Required by earlier finding | Gate: low-confidence beats need re-hearing before use |

**Gap types and narration-style defaults (revised)**

| Gap type | Purpose | Default style | Rule set |
|---|---|---|---|
| Cold open | Hook in the user's voice | Freestyle | Cue card; no source clip before attribution |
| Setup/context | Who, where, when, what came before | Scripted descriptive | Audio-description rules; fits the gap; present tense |
| Context restore | Supplies the omitted surrounding words of a quote | Scripted descriptive | Quote verbatim, re-heard |
| Reaction/opinion | User's view on the clip just played | Freestyle | Cue card; must reference this clip |
| Fact-check | Verdict plus receipt | Anchored freestyle (was "mixed") | Locked tokens checked against the take; fully scripted only for legally sensitive wording |
| Rebuttal point | Counter-argument to a specific claim | Anchored freestyle | Claim restated fairly; receipt locked |
| Bridge | Move to the next beat | None or ≤1 short freestyle line | Prefer a cut |
| Close | Summary and takeaway | Freestyle | Cue card; no new claims |

**Pacing and legal rules as configurable flags (no invented ratios)**

- `max_unbroken_clip_seconds`: warn when exceeded. Calibrate from the measurement study in §1.
- `max_source_work_share`: seconds of source used ÷ source length, tracked per source. Reference points: about 60% in *Hosseinzadeh*; under 10-second clips from 10-minute-plus segments in *CBC v. CPC*.
- `max_runtime_clip_share`: clip seconds ÷ final runtime.
- `require_engagement_per_clip` (default on): every clip is followed by a gap whose transcript references the clip's content. This is checked by matching entities and keywords plus user confirmation.
- `require_voice_commentary` (default on): blocks clip-only or non-verbal-reaction-only sequences, which YouTube's policy names as disallowed.
- `attribution_on_first_use` (default on): an on-screen source and author card, plus the description field.
- `necessity_note` (default on): a one-line "why this clip" note stored with each clip, for dispute files.
- `punishment_tone_lint`: flags gaps that are insult-only with no criticism of substance (*Cooperstock* risk).
- `channel_template_variance`: warns if recent videos share near-identical structure and narration, which is inauthentic-content risk.

**Cue-card template** (hypothesis to test)

```
WHAT: [≤8 words, keywords]
WHY IT MATTERS: [≤8 words]
RECEIPT: [number / date / document]  ← locked if fact-check
ANGLE?: [one question]
TARGET: [n] s
```

**Descriptive-line rules** (from DCMP, CAB/AMI and Ofcom)

- Describe what is seen or said, from general to specific.
- No interpretation of emotion or motive.
- Present tense, active voice.
- Use "then / now / later" for transitions.
- Never talk over essential source audio.
- Don't fill every gap.
- Word budget = gap seconds × the user's measured words per second, minus padding.
- The linter rejects evaluative adjectives in scripted lines, so evaluation moves to freestyle.

## (b) Mode-preset table

| Mode | Structure driver | Pipeline passes | Default narration by segment | Legal/policy checks | Skeleton |
|---|---|---|---|---|---|
| React | Source clip beats | Transcribe, beat scoring, clip pacing, verdicts (optional) | Setup scripted; reaction freestyle; fact-check anchored | Engagement-per-clip, attribution, source-share, reused-content | Open → [clip → gap]×n → close |
| Rebuttal/response (react preset) | Opposing video's claim map | Claim extraction, research, verdicts, clip pacing | Claim restated scripted-descriptive; rebuttal anchored; close freestyle | As react, plus fair restatement and a right-of-reply note | Thesis → [their claim clip → rebuttal]×n → what they got right → close |
| Factual video essay | Thesis | Research, claim map, verdicts | Mostly user's spoken words; facts anchored | Attribution for any clips; claim sourcing | Hook → thesis → 3–5 argument sections → counterpoint → conclusion |
| Explainer (new) | Concept | Research, glossary | Descriptive scripted; analogies freestyle | Sourcing | Question → building blocks → worked example → recap |
| Documentary | Chronology or characters | Research, interview capture, archive log | Narration scripted-descriptive; reflection freestyle | Archive licences/fair dealing per clip; consent | Cold open → acts by chronology → resolution |
| Investigation/accountability (new) | Reporting findings | Research, documents, interviews, verdicts, right of reply | Findings anchored; method reflexive freestyle | Defamation review, right of reply, source protection | Allegation → evidence → response → significance |
| Document read-through | Document structure | OCR/text alignment, claim map | Excerpt quoted on screen; analysis freestyle; never mostly reading | Reused-content "readings" rule; attribution | Context → [excerpt → analysis]×n → what it means |
| Fact-check short (merged with correction) | Single claim | Claim, research, verdict | Claim clip; verdict anchored; one freestyle line | Attribution; verdict sourcing | Claim → verdict → receipt → why it matters (≤60 s) |
| Correction/follow-up (fact-check variant) | Prior error | Diff against original video, verdict | Fully scripted correction; freestyle explanation | Link to original; transparent wording | What we said → what's right → how it happened → what changes |
| News recap/timeline | Chronology | Event extraction, dating, sourcing | Event lines scripted-descriptive; significance freestyle | News-reporting fair dealing (s. 29.2) attribution | Today's development → timeline → what's next |
| Developing-story update (new) | Delta since last video | Diff, dating | Anchored | Link to prior; dated | What's new → what's unchanged → next date |
| Footage verification (new) | Visual evidence | Frame and location checks, metadata | Descriptive scripted; reasoning freestyle | Attribution; privacy | Claim about the clip → checks → verdict |
| Interview cut-down with framing | Interview arc | Interview capture, quote selection, context check | Framing scripted-descriptive; host reflection freestyle | Consent/release; context-preserved check | Who and why → [Q → A]×n → host framing → close |
| Shorts (render target, not a mode) | Inherits parent mode | Hook-first reorder, length cap | Inherits | Inherits, plus attribution visible in-frame | Hook → single beat → payoff |

## (c) Transcript-access and monetization constraints as design rules

1. **No automated fetching** of third-party YouTube captions or media: no API workaround, no player-endpoint scraping. The official API refuses non-owners (403), and the Terms bar scrapers without written permission.
2. Every source carries a **provenance field**: owned / permission (stored document) / lawful file (how obtained) / user-pasted platform transcript / third-party service (terms acknowledged).
3. **Owned-video path:** official API captions are allowed for the user's own channel.
4. **Transcripts are an index only.** Quotes must be re-heard against the media before lock.
5. **Attribution is mandatory metadata.** Source title, author/performer and platform are captured at intake and rendered on screen at first use and in the description (s. 29.1 and s. 29.2).
6. **Channel-level risk dashboard:** clip share, engagement-per-clip pass rate and template similarity across the last N videos. YouTube's reused-content policy "applies to your channel as a whole" and reviewers look at newest, most-viewed and highest-watch-time videos.
7. **Dispute file per video:** each clip's necessity note, timestamps, attribution and commentary transcript, ready for a Content ID dispute. Content ID "can't decide fair use", and an unanswered dispute expires after 30 days.
8. **Disclosure:** keep YouTube's synthetic-content disclosure flow for any realistic AI-generated or AI-altered material. Never use an AI persona for political or legal commentary.

## (d) Questions for a Canadian media lawyer

1. Which version of the YouTube Terms binds a Canadian user? Does any "as permitted by applicable law" carve-out, or Canadian fair dealing, permit automated retrieval of captions or media for criticism or news reporting?
2. Is running speech-to-text on media obtained through a platform's own download or offline feature a breach of contract, a copyright issue, or both? Does circumventing any technical measure engage the Copyright Act's anti-circumvention provisions (s. 41) regardless of fair dealing?
3. For s. 29.1, is an on-screen source and author card at first use enough, or must the mention be spoken or repeated for each clip? Does "identifiable to a reasonably informed watcher" (*CBC v. CPC*, para. 85) cover a description-box credit alone?
4. How do *CCH* "amount" and "alternatives" apply when a reaction uses a large share of a short source, such as 60% of a five-minute video?
5. Where is the line between criticism and *Cooperstock*-style "punish" purpose for an investigative journalist's critical commentary on a named creator?
6. Is the system-drafted scripted narration, or a user-approved LLM-written line, treated any differently for defamation purposes than the user's freestyle speech? What pre-publication review should the investigation and rebuttal modes enforce?
7. What exposure arises from third-party transcript services whose terms make the user indemnify them, and should Aldershot integrate any of them at all?
8. If a US rights holder files a DMCA takedown against a Canadian creator's video, what is the practical risk of counter-noticing? Which forum's law (fair use or fair dealing) would likely apply?
9. Do news-reporting (s. 29.2) or criticism (s. 29.1) purposes better cover the news recap and footage-verification modes?

## (e) What the evidence does NOT support

- **Any clip-to-commentary ratio** ("50% commentary", "30 seconds is safe"). No court, YouTube policy or measured study sets one.
- **The claim that the July 2025 YouTube update targeted reaction videos.** YouTube states there was no change to the reused-content policy.
- **Assuming Content ID respects fair dealing or fair use.** YouTube says automated systems can't decide it, and rights holders can set length-based claim rules.
- **Getting third-party captions through the official API.** It requires edit permission on the video.
- **Measured interruption frequencies, segment lengths, or pause-versus-talk-over shares** for successful commentary or debunk channels. These are undocumented, so measure them (§1).
- **A controlled finding that freestyle beats scripted on engagement in reaction videos specifically.** The evidence is indirect: read speech is detectable, and viewers value parasocial connection.
- **Measured cue-card composition rules** (bullet counts, keywords versus sentences). These are hypotheses.
- **Removing all fillers.** Moderate rates (≤5 per minute) appear acceptable, and spontaneous disfluency did not reduce perceived competence in a 2026 study.
- **Per-gap word limits from audio-description standards.** They give rate and priority rules, not word counts.
- **Reliable automatic humour, rhetorical-move or contradiction scoring.** Humour detection from speech sits around F1 0.63, and I obtained no figures for the others.

## Caveats

- Several sources here are summaries or snippets rather than full texts. The ACM "Watch Me Watch" full text and the *CBC v. CPC* paragraph numbers were seen through abstracts and law-firm summaries. Verify before quoting publicly.
- Check-worthiness and audio-event accuracies come from benchmark conditions (clean debate transcripts, curated audio). Expect lower performance on noisy reaction sources.
- The 2026 figures on channel terminations come from Kapwing's report as relayed by XDA Developers, not from YouTube.
- None of this is legal advice. The fair-dealing analysis is fact-specific, and Canadian case law on online reaction video specifically is sparse. *CBC v. CPC* concerned political ads, not YouTube commentary.

## Sources

1. [Watch Me Watch: Reaction Videos as a Social Form of Online Video Engagement](https://doi.org/10.1145/3788078)
2. [Watch Me Watch: Reaction Videos as a Social Form of Online Video Engagement](https://dl.acm.org/doi/full/10.1145/3788078)
3. <https://www.diva-portal.org/smash/get/diva2:1775163/FULLTEXT02.pdf>
4. [Reaction Media As A Cross-Platform Practice: A Case Study Of Friction And Flow In Uncle Roger’s Reaction Media On Youtube, Tiktok, Douyin, And Bilibili - Ziying Meng, Lauren Bliss, 2026](https://journals.sagepub.com/doi/10.1177/20570473261425270)
5. [Not Acting, Reacting: An Analysis of Reaction Videos, Reactors, Viewers and Authenticity](https://scholarsarchive.byu.edu/etd/9836/)
6. [Ethan Klein Files Copyright Lawsuits Over 'Lazy' Reaction Videos](https://copyrightlately.com/ethan-klein-files-copyright-lawsuits-over-lazy-reaction-videos/)
7. [Reaction Videos on YouTube: Format and Copyright](https://voclify.io/blog/reaction-videos-youtube-format-tips-copyright-fair-use)
8. [YouTube channel monetization policies - YouTube Help](https://support.google.com/youtube/answer/1311392?hl=en)
9. [Fair use on YouTube - YouTube Help](https://support.google.com/youtube/answer/9783148?hl=en)
10. [Dispute a Content ID claim - Computer - YouTube Help](https://support.google.com/youtube/answer/2797454/dispute-a-content-id-claim?hl=en)
11. [Content ID and Fair Use - YouTube Blog](https://blog.youtube/news-and-events/content-id-and-fair-use/)
12. [YouTube clarifies "inauthentic content" policy changes](https://ppc.land/youtube-clarifies-inauthentic-content-policy-changes/)
13. [YouTube Demonetization in 2026: 10 Rules Creators Don't Follow!](https://onestream.live/blog/youtube-demonetization-creator-mistakes/)
14. [Captions: download](https://developers.google.com/youtube/v3/docs/captions/download?authuser=6)
15. [developers.google.com](https://developers.google.com/youtube/v3/docs/captions/list?hl=zh-tw)
16. [YouTube Data API Transcripts: Why captions.download Fails](https://youtube2text.org/blog/youtube-data-api-transcripts)
17. [Terms of Service](https://www.youtube.com/static?template=terms)
18. [Terms of Service](https://archives.greenairnews.com/www.youtube.com/t/terms.html)
19. [View video transcripts - YouTube Help](https://support.google.com/youtube/answer/15930243?hl=en)
20. [Judge sides with YouTubers Ethan and Hila Klein in copyright lawsuit](https://techcrunch.com/2017/08/23/judge-sides-with-youtubers-ethan-and-hila-klein-in-copyright-lawsuit/)
21. [Hosseinzadeh v. Klein.](https://www.loeb.com/en/insights/publications/2017/08/hosseinzadeh-v-klein)
22. [Victory for YouTubers as New York District Court rules "reaction video" is fair use - Lexology](https://www.lexology.com/library/detail.aspx?g=0b05c134-6654-4527-805b-45213bac1326)
23. [Hosseinzadeh v. Klein, 276 F. Supp. 3d 34](https://www.casemine.com/judgement/us/5c080954342cca1de2313e19)
24. [Fair dealing in Canadian copyright law](https://en.wikipedia.org/wiki/Fair_dealing_in_Canadian_copyright_law)
25. [Court's Liberal Approach To "Criticism" Fair Dealing In Favour Of Use Of Copyrighted News Material In Political Ads - Copyright - Canada](https://www.mondaq.com/canada/copyright/1073840/court39s-liberal-approach-to-criticism-fair-dealing-in-favour-of-use-of-copyrighted-news-material-in-political-ads)
26. [Federal Court Finds Conservative Party’s Use of CBC’s Copyrighted Works Constituted “Fair Dealing”](https://www.dww.com/articles/federal-court-finds-conservative-party%E2%80%99s-use-of-cbc%E2%80%99s-copyrighted-works-constituted-%E2%80%9Cfair)
27. [Court's Liberal Approach To "Criticism" Fair Dealing In Favour Of Use Of Copyrighted News Material In Political Ads - Copyright - Canada](https://www.mondaq.com/canada/copyright/1073840/court39s-liberal-approach-to-criticism-fair-dealing-in-favour-of-use-of-copyrighted-news-material-in-political-ads?type=popular)
28. [Society of Composers, Authors and Music Publishers of Canada v Bell Canada](https://en.wikipedia.org/wiki/Society_of_Composers,_Authors_and_Music_Publishers_of_Canada_v_Bell_Canada)
29. [Parody Cannot Be Relied On As A Defence To Copyright Infringement If It Causes Marketplace Confusion - Trademark - Canada](https://www.mondaq.com/canada/trademark/850894/parody-cannot-be-relied-on-as-a-defence-to-copyright-infringement-if-it-causes-marketplace-confusion)
30. [Website meets definition of a parody but ultimately does not fall within the fair dealing exception](https://canliiconnects.org/en/summaries/45891)
31. [Overview of the CLEF-2023 CheckThat! Lab Task 1 on ...](https://ceur-ws.org/Vol-3497/paper-019.pdf)
32. [arxiv.org](https://arxiv.org/html/2408.01118v1)
33. [HIGHLIGHT SOUND EFFECTS DETECTION IN AUDIO STREAM ](https://hcsi.cs.tsinghua.edu.cn/Paper/Paper03/200306.pdf)
34. [A Machine Learning Model for Laughter Detection Lasse Wolter](https://project-archive.inf.ed.ac.uk/ug4/20222999/ug4_proj.pdf)
35. [Future of Information and Communication Conference (FICC) 2018](https://cs.stanford.edu/~katepark/Laughbot.pdf)
36. [\[2505.19429\] Rhapsody: A Dataset for Highlight Detection in Podcasts](https://arxiv.org/abs/2505.19429)
37. [The recognition of read and spontaneous speech in local vernacular: The case of Zurich German - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S009544701400093X)
38. [Differences between acoustic characteristics of spontaneous and read speech and their effects on speech recognition performance](https://www.researchgate.net/publication/221999276_Differences_between_acoustic_characteristics_of_spontaneous_and_read_speech_and_their_effects_on_speech_recognition_performance)
39. [Human perception of audio deepfakes: the role of language and speaking style - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0167639326001354)
40. [Um, so, like, do speech disfluencies matter? A parame…](https://behavioristbookclub.com/aba-research/aba-fundamentals/um--so--like--do-speech-disfluencies-matter--a-parametric-evaluation-o/)
41. [Does disfluency affect social judgments and decisions? Evidence from spontaneous speech - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0010027726002660)
42. [The role of fillers in listener attributions for speaker disfluency](https://pure.mpg.de/rest/items/item_442640/component/file_442639/content)
43. [Fillers in Spoken Language Understanding: Computational and Psycholinguistic Perspectives](https://arxiv.org/pdf/2301.10761)
44. [Audio Description Tip Sheet](https://dcmp.org/learn/227-audio-description-tip-sheet)
45. [Describing Description](https://dcmp.org/learn/272-describing-description)
46. [Description Key - How to Describe](https://dcmp.org/learn/617-description-key---how-to-describe)
47. [Post Production Described Video Best Practices](https://www.ami.ca/sites/default/files/2020-07/PP_Described_Video_Best_Practices_0.pdf)
48. [Post Production Described Video (DV)](https://www.ami.ca/described-video-dv)
49. [Code on Television Access Services Ofcom’s Code on Television Access Services](https://www.ofcom.org.uk/siteassets/resources/documents/tv-radio-and-on-demand/broadcast-codes/other-codes/access-service-code-jan-2017.pdf?v=335784)
50. [Bill Nichols' Six Documentary Modes](https://www.scribd.com/document/102586436/Modes-of-Documentary)
51. [Documentary mode](https://en.wikipedia.org/wiki/Documentary_mode)
