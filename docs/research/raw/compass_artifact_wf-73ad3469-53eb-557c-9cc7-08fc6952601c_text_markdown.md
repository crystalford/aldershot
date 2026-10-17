# Aldershot Editorial Measurement: Spoken Lines, Receipts, Pacing, Hooks and VO Recording

**Bottom line: the evidence supports an anecdote-led opening only if the headline stat arrives inside the first ~15 seconds, a SAID column that averages about 15 words per sentence with a short "punch" sentence every 4–6 lines, music sitting about 20 dB under the voice, and a recording flow built into the editor session (teleprompter plus per-line retake), not chat prompts. The "3–5 second shot" rule is neither confirmed nor killed. No published stopwatch measurement of a Vox video exists, so Aldershot should measure it rather than inherit it.**

## TL;DR
- **SAID rule (measured from two scripts):** Every Frame a Painting's script averages about 15 words per sentence, with 28% of sentences at 7 words or fewer. Folding Ideas' *Line Goes Up* caption export averages about 28 words per sentence, with about 17% short sentences. hbomberguy's *Vaccines and Autism* works out to about 176 words per minute.\[1\] Recommended default: 12–18 words per sentence (hard cap 30), one sentence or clause per visual beat, and a ≤7-word punch line every 4–6 sentences.
- **Pacing and audio:** I found no measured Vox shot-length or music-change data. The "3–5 s" and "music every 20 s" figures trace back to AI-video vendor blogs.\[2\] For loudness, the most authoritative anchor is W3C WCAG 1.4.7: background audio at least 20 dB below speech.\[3\] Practitioner guidance ranges from 10 to 25 dB. −14 LUFS is a common YouTube mastering convention, but YouTube doesn't publish it as an upload spec.
- **Hooks and recording:** In 11 essay openings I could check, statistic and anecdote openings tied (4 each). There were no confirmed cold clips. Open on the anecdote, but put the 37% in the first beat or two. Descript, Riverside and Audacity all record VO inside an editor or recorder session, using a scrolling teleprompter, retakes that replace a selection, and a 5-second pre-roll.\[4\]\[5\]\[6\] None of them uses chat-driven capture.

## Key Findings

### 1. The spoken-line formula (SAID column)

**Method.** I counted sentences by hand from published text. Sentence boundaries follow the source's punctuation. Caption exports put punctuation in somewhat arbitrary places, so treat the Folding Ideas figures as ±15%. Word counts are hand tallies, not script output.

| Creator / source | Sample | Words/sentence (mean) | Range | Short sentences (≤7 words) | Notes |
|---|---|---|---|---|---|
| Every Frame a Painting (Tony Zhou & Taylor Ramos), "Postmortem" script, Part I "Origins" | 25 sentences, ~370 words | **~14.8** | 3–33 | **28%** (7/25) | A written VO script, never recorded. Closest thing to a pure "SAID" column |
| Folding Ideas (Dan Olson), *Line Goes Up*, opening through the 2008 section (caption export, eizebasa.baby)\[7\] | 29 sentences, ~820 words | **~28** | 3–60 | **~17%** (5/29) | Lists run long ("One: … Two: …"). Punch lines like "It's a bubble." (3 words) and "There's some problems, though." (4)\[7\] |
| hbomberguy, *Vaccines and Autism: A Measured Response* (Pickscribe)\[1\] | Whole video: 18,370 words over 104:09\[1\] | not measured | — | — | **~176 words/min** (derived). Includes clips and other voices |
| Vox / Johnny Harris | — | **not measured** | — | — | Couldn't retrieve full-text transcripts (Johnny Harris transcript sites block automated access). Gap flagged |

**What the numbers mean.**
- The two essayists bracket a range. EFAP writes in short, spoken sentences, close to the 15-word line that broadcast-style VO aims for. Olson writes long, clause-stacked sentences and relies on delivery to carry them.
- Both use the same device: a very short sentence after a long build ("So let me tell you a story." / "Then she closed the door." / "Harsh, but true.").\[8\] That short line is where the breath and the beat land.
- In EFAP the short lines cluster at turns in the narrative. In *Line Goes Up* they mark transitions ("There's some problems, though.", "So here's the incentives that are created.").\[7\]

**Speaking rate (useful for converting SAID text into time):**
- hbomberguy's ~176 wpm (derived) sits just above the 150–165 wpm conversational range that Wikipedia's interactive-transcripts article cites, and well above the 100–120 wpm it gives for slide presentations.\[1\]\[9\]
- At 165–176 wpm, a 15-word sentence takes about 5–5.5 s to speak. If each sentence gets its own visual, that lands close to the "3–5 s shot" folklore (inference, not measurement).

**How quotes are introduced (qualitative, small sample).**
- In *Line Goes Up*, Olson plays a quoted voice verbatim with no "as X put it" lead-in. The victim's message ("Yo, this is fake, this is fake…") just runs, and the visuals carry the attribution.\[7\]
- In EFAP, a quote is framed as reported speech ("She said that I should stop complaining…").\[8\]
- I found no corpus large enough to give a ratio of "as X put it" to unframed reading. Treat this as an open measurement.

**Where the breath lands.**
- Neither text source marks pauses. The best proxy is structure. *Line Goes Up* marks chapter breaks with "[Drumming]" music cues, which means a breath plus a music change at section boundaries rather than on a fixed timer.\[7\]
- EFAP's process note matters here: Zhou says the script lives on flash cards and "Tony has to memorize all the flash cards in order."\[8\] The unit of performance is the card, not the paragraph.
- Johnny Harris describes a "two-column scripting process" (script plus visual direction) in a Jon Youshaei interview.\[10\] This is the same SAID/SHOW split Aldershot already uses, which confirms the column model is how this genre is actually written.

### 2. How essayists put a text source on screen (Document block)

**Patterns I found documented (descriptive sources, not measured):**
- **Highlighter sweep on the real document.** Vox-style breakdowns repeatedly name "the famous highlighter effect", a colour block animated behind the key phrase "on cue".\[11\]\[12\] Prompt guides describe a slow push into a scanned page while a yellow marker sweeps one line, after which "the highlighted phrase enlarges as bold kinetic typography."\[2\]
- **Match cut on text (Johnny Harris).** The same word or phrase is collected from several documents and centred on screen, so the cut lands on the matching phrase.\[13\]\[14\] It shows the pattern across sources at a glance.
- **Physical, textured treatment.** Harris-style edits add film grain, paper texture and "pinned" archive-photo looks, plus sound effects that suggest objects being physically placed.\[13\]\[14\]\[15\] The receipt reads as an artifact, not a slide.
- **Short re-typed labels.** Collage-style guides limit re-typed text to "one short label of 1 to 4 words" and warn against paragraphs of on-screen text.\[16\]

**Read it aloud or not? (inference from reading and speaking rates).**
- Adults read prose at 275–350 wpm and speak at 150–165 wpm (Wikipedia, interactive transcripts).\[9\] A viewer finishes a short highlighted excerpt before the narrator could.
- Reading the excerpt word for word is therefore redundant unless the wording itself is the evidence: a damning phrase, an exact figure, a legal formulation. In that case the narrator should read **only the highlighted span**, in sync with the highlighter, and nothing else on the page.
- EFAP's founding principle ("Many people can't understand something until you show it AND explain it to them") supports showing the receipt while the narration explains what it means, rather than reciting it.\[8\]

**How long it stays on screen.** Nobody publishes timings for Vox document holds. The best-grounded reading-time standard is Netflix's English (USA) Timed Text Style Guide, which allows "up to 20 characters per second" for adult programs and "up to 17" for children's programs. Each subtitle stays on screen for a minimum of ⅚ s and a maximum of 7 s. The 17 cps figure is what an open-source Vox-style renderer uses. At ~5–6 characters per word, 17–20 cps works out to about 3–3.5 words per second.

### 3. Vox with a stopwatch: shot length, exhibits, music, dB

**Measured: nothing.**
- I found no published shot-by-shot or cuts-per-minute analysis of any Vox, Johnny Harris or Kurzgesagt video.
- The closest journalistic account (The Open Notebook's "Videogram" on Vox's black-hole explainer, with Joss Fong) is descriptive. It only notes that the video "started off with the images of the telescopes instead of any sort of immediate lede."\[17\]

**Claimed (unverified, and they conflict):**
- One AI-video vendor (easy-peasy.ai) says Vox "holds one image for five or six seconds" and "change[s] the music roughly every 20 seconds."\[2\]
- Another (Calliope Labs) prescribes "cuts every 1 to 3 seconds."\[16\]
- An open-source Claude Code skill defines a beat as "1–3 sentences, 8–14 seconds spoken" plus one visual.\[18\]
- None cites a measurement. They are the same kind of AI-blueprint numbers the user is trying to get rid of.

**Reference points from film measurement (measured, different medium):**
- David Bordwell ("Intensified Continuity," *Film Quarterly*, 2002) found that most Hollywood features from 1930 to 1960 had 300–700 shots, "so the average shot length (ASL) hovered around eight to eleven seconds." He describes recent films as moving toward a range of 4–6 seconds.
- *2001: A Space Odyssey* has an ASL of about 13 s.\[19\]
- ASL means runtime divided by shot count. Bordwell warns that averages hide variation, so report a median and range as well.\[20\]

**Verdict on "3–5 s":**
- Unconfirmed, but plausible as a *visual-beat* rate. It matches the 5–5.5 s spoken length of a 15-word sentence.
- It is not supported as a *hard-cut* rate, because Vox-style scenes often hold one graphic while elements animate in.\[21\]

**Audio levels (published guidance, not a measured Vox mix):**
- **W3C WCAG 1.4.7 (Level AAA):** background sounds must be "at least 20 decibels lower than the foreground speech content, with the exception of occasional sounds that last for only one or two seconds." It is formally scoped to prerecorded audio-only content, but it is the only standards-body number.
- **Practitioners:** music under dialogue at −18 to −25 dB (Pixflow);\[22\] 15–20 dB under VO (ProTunes One);\[23\] "about 10 decibels below" (YTTalk users quoted by Kevin Muldoon, who settled on music at −25 dBFS);\[24\] about 12 dB under (an Adobe forum editor of YouTube documentaries).\[25\]
- **Delivery loudness:** −14 LUFS is widely cited as YouTube's playback target, but I found no primary YouTube source for it. APU Software notes that YouTube "adjusts playback volume but does not publish -14 LUFS as an upload requirement; this is a practical production reference." Treat it as a convention, not a spec.

### 4. Hook structures

**Sample.** The research subagent pulled 11 openings from fan-wiki transcripts, a Kaggle Whisper transcription set, and podcast-mirror transcripts of Wendover, Kurzgesagt and one Johnny Harris NYT piece. I added *Line Goes Up* and EFAP. These were **not** selected by measured retention, and only one has timestamps. Treat this as a pattern census, not proof of what retains.

| Type | Count | Examples |
|---|---|---|
| Statistic | 4 | Wendover casino ("51 licensed casinos… 2,879 gaming tables… $3.1 billion");\[26\] Kurzgesagt "58 Lives" ("58 of you watching right now will not be alive");\[27\] "Immune" ("roughly 40 trillion cells");\[28\] "Oldest Lie" (a blood-vessel "fun fact")\[29\] |
| Anecdote / scene | 4 (+2 mine) | Wendover treasure hunting ("It's the summer of 1990");\[30\] Africa/China (a UN vote "47 years ago");\[31\] Kurzgesagt slaver ant;\[32\] dinosaurs ("66 million years ago");\[33\] *Line Goes Up* ("So let me tell you a story… In 2008 the economy functionally collapsed");\[7\] EFAP postmortem |
| Claim / question | 2 | Kurzgesagt climate ("So why don't we just… prevent all of that?");\[34\] food |
| Teaser | 1 | Johnny Harris/NYT: "There is one graph… that blows my mind."\[35\] |
| Cold clip | 0 confirmed | Text transcripts can't show a visual cold open |

**Retention context.**
- YouTube Studio's "Intro" key moment is the share of viewers still watching after 30 seconds, and the steepest drop happens there. One vidIQ example falls from 95% to about 65% by 0:30.\[36\]\[37\]\[38\]
- Vendor benchmarks (e.g., "Retention Rabbit": intros holding >65% correlate with 58% higher average view duration) are unaudited marketing claims.\[39\]
- What practitioners agree on is *promise-match*: the opening must pay off the title or thumbnail fast.\[36\]\[40\]\[41\]

**Interpretation.**
- Both openings are mainstream. The strongest stat hooks (Kurzgesagt's "58 of you") are stats *dramatized as a scene about the viewer*.\[27\]
- The strongest anecdote hooks (Wendover's UN vote) carry a number inside the scene.\[31\]
- The real distinction is not anecdote vs. stat but whether the number arrives early.

### 5. Recording ergonomics

- **Descript:**
  - Built-in teleprompter with font size, scroll speed, restart, and "Import from script" (pulls text from the composition).\[42\]
  - Auto-scroll when recording starts; a "Focus mode" gradient around the centre line; a 3-second countdown.\[5\]\[43\]
  - The teleprompter window is never captured in desktop recordings.\[42\]
  - The Editor Recorder can **record into script** at the playhead, **replace selection** (highlight script text and re-record over it), or record a new layer.\[5\]
  - Overdub/Regenerate patches single flubbed lines, and Descript positions it for corrections, not whole scripts.\[44\]\[45\]
- **Riverside:** studio "Script" panel turns into a teleprompter overlay with scroll speed, text size and Focus Mode.\[4\]\[46\] Async recording lets a guest "record again until they're happy," using the host's script.\[47\]
- **Audacity:** Punch and Roll (Shift+D) plays a **5 s pre-roll** (default) and applies a **10 ms crossfade** at the splice. The Audacity Manual warns that choosing a splice point "will then discard the selection as well as all audio following it," so recording only continues from the end of the track. Forum users complain that it takes three steps (stop, place cursor, Shift+D) and ask for a one-key macro.\[48\]
- **Pro practice:** Every Frame a Painting memorized flash cards in order.\[8\] Audiobook and VO practitioners bind punch-and-roll to a single hotkey.\[49\]

**Conclusion.** For a 25+ line script, every incumbent puts the script inside the recording surface, scrolls or advances it, and makes the retake unit a *selection* of script text. None asks the user to trigger takes from a chat. Chat suits drafting and revising lines, not performing them.

## Recommendations: Design Rules for Aldershot

**SAID column rule**
1. Target 12–18 words per sentence (EFAP measured ~15). Show a soft warning above 25 and a hard flag above 30. Exempt deliberate list sentences, Olson-style, with an explicit "long line" tag.
2. Require a ≤7-word punch sentence every 4–6 sentences, placed at turns. Both measured scripts run 17–28% short sentences, so the editor should keep the short-sentence share in that range.
3. Store pace as words per minute per narrator (default 165, calibrate from the first take; hbomberguy ~176). Show each line's spoken duration live.
4. Breath marks: an automatic breath after every sentence, a long breath plus a music-change candidate at every section break (the *Line Goes Up* "[Drumming]" pattern).
5. Quote handling: default to *no* "as X put it" lead-in when a Document block on screen carries the attribution. Require a spoken attribution only when no receipt is on screen.

**Document block**
1. Render the real artifact (page scan or PDF crop) with an animated highlighter on one span. Optional texture or grain. An optional "match-cut" mode lines up the same phrase across several receipts.
2. Highlighted span ≤20 words. Any re-typed pull-label ≤4 words.
3. Read-aloud flag, off by default. Turn it on only when the exact wording is the evidence. When it is on, the SAID line must quote exactly the highlighted span and the highlighter is timed to the VO.
4. Minimum hold = max(2 s, highlighted characters ÷ 17 + 1 s), capped at about 7 s per highlight. This uses Netflix's conservative children's rate of 17 cps; the adult rate is 20 cps, and Netflix's maximum subtitle duration is 7 s. If the read-aloud flag is on, hold = spoken duration + 0.5 s.

**Shot length and audio defaults**
1. Default one visual beat per SAID sentence (≈4–6 s at 165 wpm). Do not enforce a 3–5 s cut. Report median and range, not just the average.
2. Before shipping the rule, measure it: run scene detection (e.g., PySceneDetect) on 3–5 Vox videos and store the measured ASL, median and music-cue intervals as the default.
3. Music bed ducked to −20 dB relative to VO (WCAG floor), with a user range of −12 to −25 dB. Bring the bed up only in VO gaps longer than 1.5 s.
4. Master to −14 LUFS integrated for YouTube. This is a production convention, not a published YouTube requirement.
5. Music changes at section breaks, not on a timer. Drop the "every 20 s" rule.

**Hook ordering**
1. Keep the anecdote first, but compile the hook so the headline stat ("37%") lands within the first one or two SAID sentences, about 15 s or less. Ideally the stat sits *inside* the anecdote (the Kurzgesagt "58 of you" or Wendover UN-vote pattern).
2. Offer "Stat-first" as a one-click alternate hook, and A/B it using YouTube Studio's 30-second Intro metric. Retention evidence for either order is not established.

**VO recording flow**
1. Record in an editor session, not via chat prompts. Use a line-highlight teleprompter that advances on each line (it can stay on screen, since audio-only VO isn't captured), with a 3-second countdown.
2. Make the retake unit the SAID line: one hotkey re-records the selected line with a 2–5 s pre-roll of the previous take and a 10 ms crossfade.
3. Auto-transcribe each take and diff it against the SAID text to flag dropped or changed words.
4. Offer voice-clone patching only for single-word fixes.
5. Keep chat for rewriting lines between takes.

## Caveats
- Per-creator figures cover only EFAP and Folding Ideas (hand counts, n=25 and n=29 sentences) plus one derived hbomberguy rate. **Vox and Johnny Harris spoken-line numbers were not obtained.** That is the biggest gap.
- No shot-length, exhibit-duration or music-cadence figure in this report comes from a measured Vox video. Every such number is labelled as a claim or an inference.
- The hook sample is small, not selected by retention, and drawn from unofficial transcripts.
- WCAG 1.4.7 is written for audio-only content.\[50\] Using it for video mixes is a reasonable stretch, not a requirement.

## Sources

1. [Pickscribe](https://pickscribe.com/channel/UClt01z1wHHT7c5lKcU8pxRQ)
2. [How to Make Vox-Style Videos with AI (Step-by-Step Guide)](https://easy-peasy.ai/blog/how-to-make-vox-style-videos-with-ai)
3. [Understanding Success Criterion 1.4.7: Low or No Background Audio](https://w3c.github.io/wcag21/understanding/low-or-no-background-audio.html)
4. [Launch the teleprompter in the studio](https://support.riverside.com/hc/en-us/articles/14269623297309-Launch-the-teleprompter-in-the-studio)
5. [How to use the editor recorder in Descript - Descript Help Center](https://help.descript.com/record/editor-recorder)
6. [Punch and Roll Recording](https://support.audacityteam.org/au4/manual/manual-index/punch-and-roll-recording)
7. [Captions For Dan Olsen’s Line Goes Up Video - eizebasa dot baby](https://eizebasa.baby/line-goes-up)
8. [Postmortem: Every Frame a Painting](https://medium.com/@tonyszhou/postmortem-1b338537fabc)
9. [Interactive transcripts](https://en.wikipedia.org/wiki/Interactive_transcripts)
10. [The Rise of Johnny Harris, Explained (Interview)](https://podwise.ai/episodes/2768274)
11. [Vox-Style Video Production: Bring Your Ideas to Life](https://www.shashankpandey.com/2023/01/Vox-Video-Editor.html)
12. [How Vox-Style Edits Are Built (Style Deconstruction)](https://earnedits.com/how-vox-style-edits-are-built/?v=0b3b97fa6688)
13. [Edit Documentaries in Premiere Pro: 3 Johnny Harris Style Tips - Motion Array](https://motionarray.com/learn/premiere-pro/edit-documentary-in-premiere-pro/)
14. [Master the Art of Documentary Editing with Johnny Harris](https://www.toolify.ai/gpts/master-the-art-of-documentary-editing-with-johnny-harris-383438)
15. [How to Get the Vox / Johnny Harris Documentary Style in Final Cut Pro](https://fcpxfullaccess.com/blogs/blog/vox-johnny-harris-documentary-style-final-cut-pro)
16. [How to Make Vox Style Videos: The Prompt Pack](https://www.calliopelabs.co/guides/vox-style-shorts)
17. [Videogram: How a Vox Video Explains the Science behind the First Photo of a Black Hole - The Open Notebook](https://www.theopennotebook.com/2020/01/07/videogram-how-a-vox-video-explains-the-science-behind-the-first-photo-of-a-black-hole/)
18. [vox-explainer-skill/SKILL.md at main · CK42BB/vox-explainer-skill](https://github.com/CK42BB/vox-explainer-skill/blob/main/SKILL.md)
19. [Average Shot Length (ASL) - Filmmakers Academy](https://www.filmmakersacademy.com/glossary/average-shot-length-asl/)
20. [5dcb488e 0f5c 4a5c 824b a052518861ba](https://cinemetrics.uchicago.edu/article/5dcb488e-0f5c-4a5c-824b-a052518861ba)
21. [How to Make a Vox-Style Explainer Video (Step by Step)](https://korpi.ai/blog/how-to-make-vox-style-explainer-videos)
22. [How to Mix Dialogue, Music & Sound Effects in Premiere Pro](https://pixflow.net/blog/audio-mixing-premiere-pro/)
23. [Top Tips for Balancing Voiceovers and Background Music](https://protunesone.com/blog/top-tips-for-balancing-voiceovers-with-background-music-in-videos/)
24. [The Right Audio Levels for YouTube - Kevin Muldoon](https://www.kevinmuldoon.com/audio-levels-youtube/)
25. [community.adobe.com](https://community.adobe.com/t5/premiere-pro-discussions/help-with-audio-settings-for-voice-over-and-music/m-p/12039621/highlight/true)
26. [How to Beat the Casino, and How They'll Stop You](https://www.flexilingo.com/en/podcasts/7264431-wendover-productions/how-to-beat-the-casino-and-how-they-ll-stop-you-wendover-productions-58614841476)
27. [This Video Might Save 58 Lives Next Week - Transcript](https://kurzgesagt-youtube-channel.fandom.com/wiki/This_Video_Might_Save_58_Lives_Next_Week_-_Transcript)
28. [Kurzgesagt\_Transcriptions](https://www.kaggle.com/datasets/maartengr/kurzgesagt-transcriptions)
29. [We Fell For The Oldest Lie On The Internet - Transcript](https://kurzgesagt-youtube-channel.fandom.com/wiki/We_Fell_For_The_Oldest_Lie_On_The_Internet_-_Transcript)
30. [How Modern Treasure Hunting Works](https://www.flexilingo.com/en/podcasts/7264431-wendover-productions/how-modern-treasure-hunting-works-wendover-productions-58581703503)
31. [How Africa is Becoming China's China](https://www.flexilingo.com/en/podcasts/7264431-wendover-productions/how-africa-is-becoming-china-s-china-wendover-productions-60594732716)
32. [The Horror of the Slaver Ant - Transcript](https://kurzgesagt-youtube-channel.fandom.com/wiki/The_Horror_of_the_Slaver_Ant_-_Transcript)
33. [How The Dinosaurs Actually Died - Transcript](https://kurzgesagt-youtube-channel.fandom.com/wiki/How_The_Dinosaurs_Actually_Died_-_Transcript)
34. [Can YOU Fix Climate Change? - Transcript](https://kurzgesagt-youtube-channel.fandom.com/wiki/Can_YOU_Fix_Climate_Change%3F_-_Transcript)
35. [Articles by Johnny Harris's Profile](https://muckrack.com/johnny-harris/articles)
36. [YouTube Audience Retention: What's a Good Rate and How to Improve It?](https://vidiq.com/blog/post/increase-audience-retention-youtube/)
37. [YouTube Audience Retention 2026: Read the Curve & Keep Viewers Watching](https://socialrails.com/blog/youtube-audience-retention-complete-guide)
38. [YouTube Hooks: The First 30 Seconds](https://monitoryt.com/blog/youtube-video-hooks)
39. [How to Read Retention Graphs Like a Pro](https://virvid.ai/blog/retention-graphs-how-to-read-youtube-analytics-2026)
40. [YouTube Audience Retention Guide (2026)](https://www.teleprompter.com/blog/youtube-audience-retention)
41. [Fix Low YouTube Audience Retention: Causes & Solutions](https://www.tubeanalytics.net/blog/fix-low-audience-retention-youtube-videos)
42. [Record with Descript's built-in teleprompter - Descript Help Center](https://help.descript.com/record/record-with-descript-s-built-in-teleprompter)
43. [Record with Descript's built-in teleprompter](https://help.descript.com/hc/en-us/articles/35482375421581-Record-with-Descript-s-built-in-teleprompter)
44. [Get started with Descript - Descript Help Center](https://help.descript.com/hc/en-us/articles/10601763396493-Get-started-with-Descript)
45. [4 Ways to Use Overdub for Better Voice Overs](https://www.descript.com/blog/article/better-voice-overs)
46. [Async: Use the teleprompter](https://support.riverside.com/hc/en-us/articles/15468135504541-Async-Use-the-teleprompter)
47. [Asynchronous Recording For Podcasts & Videos](https://riverside.com/async-recording)
48. [punch and roll macro (one click punch in) - Recording Techniques - Audacity Forum](https://forum.audacityteam.org/t/punch-and-roll-macro-one-click-punch-in/64494)
49. [Audacity Tutorial: Punch and Roll for Audiobooks — BRIAN WIGGINS](https://www.brian-wiggins.com/blog/2023/2/3/audacity-tutorial-punch-and-roll-for-audiobooks)
50. [Low or No Background Audio - DAISY Knowledge Bases](http://kb.daisy.org/publishing/docs/wcag/low-or-no-background-audio.html)
