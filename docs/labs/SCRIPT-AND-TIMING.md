# Script and timing — the read is the timing master

7 Oct 2026, from the script research pass. **The voice-profile half of that pass (fine-tuning a model on the user's speech, a style profile, a reward model, a voice clone) is tabled** — a possible per-account feature much later, not the direction. What survives is the timing system, the reading surface, and a short list of writing rules with evidence under them. Nothing here is built.

## The one-line version

**Everything planned is anchored to word ids, never to seconds.** The user records one take; a forced aligner gives every word a time to within a frame; a compile step turns every beat, cut and type hit into times. Change the read and everything re-times. Change a line and nothing downstream breaks.

## Alignment — why the tool choice matters

- One frame at 24 fps is 41.7 ms. Dedicated forced alignment (Montreal Forced Aligner class, wide beam) lands words at ≈20–22 ms mean error — sub-frame. Whisper's built-in aligner lands at ≈110 ms, with only ~15% of boundaries within 50 ms — two to three frames late, which is visible when a word slams onto the screen. Beam width alone halves the aligner's error.
- **So:** Whisper for the transcript and the search index (the footage system); a real forced aligner, on the *actual transcript* not the script, for anything that has to hit a frame. CPU-bound, faster than real time for one read voice — a short container job.
- Verbalise numbers before aligning (letter-level aligners degrade on digits); add names and terms from the archive's documents to the pronunciation dictionary.
- **Outputs:** a word table (word id · start · end · script-word id or ad-lib flag · breath-group id) · breath-group boundaries with pause lengths · a per-word stress estimate (relative energy and pitch over the vowel, normalised within the group) · speech rate per group.

## Re-timing — how the real read propagates

- **Beat in/out points snap to the nearest breath-group pause** — ending at the start of the pause, not the last phoneme. Prosodic boundaries are the natural seams; cutting there hides the cut. If a beat's picture needs more time than the read gives, extend into the pause (up to the user's typical long pause) before borrowing from the next beat.
- **Hard cuts and type hits land on the onset of the group's final stressed word, minus 1–2 frames** — the picture arrives *with* the stress, not after it. Frame-accurate at 20 ms; visibly late at 110.
- **Word-synced type**: each on-screen token takes its aligned start, minimum hold 2–3 frames. Only key terms and receipts are set — never the whole sentence.
- **Music is retimed to speech, never the reverse**: beat-track the bed, choose a stretch or offset that lands downbeats on beat-boundary cuts within ±1 frame; stems cut at phrase ends.
- **Skipped lines**: if a skipped span carried a must-see proposition, flag the beat — keep the picture silent, keep it with a card, or drop it; re-run the claim check if the voice no longer supports it.

## The read — teleprompter and one take

- **One line = one breath group**, about 4–7 words (spoken English comes in intonation units averaging ~4.8 words, each carrying at most one new idea — and the brain measurably tracks those units). The user reads one group per line; pauses fall where the script expects them; alignment gets easier. Bold the final stressed word — the edit depends on it. Beat breaks as dividers.
- **The scroll follows the voice** (streaming speech recognition matched against the known script), not a fixed speed. With a fixed scroll the read conforms to the machine; the point of one take is the reverse.
- **Flubs**: restart from the beginning of the current line. A repeated span in the transcript → take the *last* complete instance; the partial becomes a cut. The script is ground truth.
- **Don't over-clean.** Remove fillers only *inside* a breath group; between groups, shorten pauses rather than delete them. Fillers cost a little local certainty and nothing in perceived competence or warmth; naturally placed ones aren't even heard as disfluent. Airless, compressed delivery is what makes edited voice sound synthetic.
- **Ad-libs are welcome.** Transcript words with no script match become new blocks attached to the nearest beat — surfaced as *freestyle inserts*, not errors. In react mode, most reactions should be these: factual corrections scripted, incredulity left free, a one-line cue on the prompter.
- *Later:* because the prompter already hears the read, it can tell the user between beats when an ad-lib has already covered the next beat's proposition, and offer to skip it.

## Scratch voice — what it's for and what it isn't

- **Don't trust a synthetic voice's pace as a duration predictor.** The one controlled comparison found humans at ~153 wpm against synthetic at ~185, with a wide spread; vendor figures conflict. Use the user's *own* measured words per minute from their footage as the duration prior; calibrate once with three short paragraphs read aloud.
- Use it for three things: **stumble detection** (synthesise each line, run recognition on it, flag round-trip errors — homophone traps, consonant clusters, ambiguous parses) · **relative pacing** (beats whose read is far shorter than their picture) · a rough animatic.
- A cloned voice reads impossible sentences fluently, so never calibrate speakability against it; never let a clone line ship. (The clone itself is tabled with the voice profile.)

## Writing rules that survive (evidence, not taste)

- **One new idea per breath group; given before new, weight at the end** — the end of a group is where English puts the stress, and where cuts and type land.
- **Restate key terms across beat boundaries instead of pronouns** — a listener can't re-read, and a viewer may have looked away.
- **Numbers for the ear, figures for the eye**: say "about a third"; put 33.7% on screen, where it's a receipt rather than a caption.
- **Write to picture**: where the screen already carries the proof, the line says what it means, not what it shows.
- **Curiosity is a ledger.** It works through prediction and surprise, not suspense: a question is opened, the viewer guesses, the answer surprises — and memory is best for surprising answers people guessed wrong. So every opened question has a scheduled closing beat; no open loop runs longer than a few minutes; before a key reveal, the line invites a guess.
- **Turns over additions.** Keep the ratio of *but / therefore* links to *and* links high between consecutive beats — the practitioners' heuristic, applied at the plan level where it belongs rather than by counting words in prose.
- **A concrete case per section.** Narrative beats exposition on comprehension and recall by about half a standard deviation (150 effect sizes); it helps persuasion much less. Collect the advantage where it exists.
- **Judges rank, they don't score.** Model judges agree with humans on pairwise comparisons and barely at all on absolute "quality"; they prefer their own fluency. Pairwise only, positions swapped, a different model family from the writer, calibrated against the user's own picks.
- **Every factual claim binds to a source span** — decomposed into atomic claims (with pronouns resolved), retrieved against the archive, labelled supported / contradicted / not found; the span is the candidate receipt. Opinion lines are tagged and exempt, but may not smuggle an unsourced factual premise.
- **Folklore to discount:** a universal "hook in the first N seconds" (platform practice, not research); the 6-minute engagement figure (compulsory coursework, not voluntary viewing); the Narrative Index as a quality predictor (useful heuristic, never validated).

## React mode — the legal frame, as design rules

The leading case (Hosseinzadeh v. Klein, S.D.N.Y. 2017) found a reaction video that interspersed short source segments with long commentary to be "quintessential criticism and comment", while noting it was not ruling that all reaction videos are fair use — a "group viewing session without commentary" is different. Design rules that follow, as evidence capture rather than legal advice:

1. Every source clip is immediately preceded or followed by commentary *about that clip*; the planner refuses clip runs without an adjacent commentary beat.
2. Track commentary-to-source time per video; warn below 1:1 (the case ran at roughly 3:1 on screen).
3. Clip length is set by what the commentary needs: the moment plus enough context to be fair.
4. **Fairness guard:** for every quoted segment, retrieve ±30–60 s of surrounding source and check whether the clip's meaning changes in context — a reversal, a hypothetical presented as an assertion, someone else's words presented as the speaker's. A flag blocks the beat until the user widens the clip or adds the context in voice.
5. Finding the best parts: segment the source into breath groups; score each on claim density, contestability (conflicts with the archive, or with the source elsewhere) and salience (strong assertions, prosodic peaks); propose reaction slots with a move — correct · contextualise · agree-and-extend · mock · predict.

## What this changes in Aldershot

- **The editor's voice beats and the Words view get a timing contract**: anchors are words, not seconds; the record flow (3-s countdown, one line at a time, every take kept) gains *line = breath group*, voice-following scroll, restart-from-line-start pickups, and freestyle inserts. Design decisions for when recording is real.
- **Music under voice follows the voice**, never the reverse — a rule in the product's vocabulary.
- **The react flow** gets its four rules: commentary adjacent to every clip, the ratio warning, clip length by need, the fairness guard — and lands in *Before you post* as evidence capture alongside attribution.
- **The claim check** (every factual line bound to a source span) is the same judge as the footage system's; the span is the receipt shot's source.
- **Tabled:** voice fine-tune, style profile, reward model, clone. Revisit only as a per-account feature when the SaaS needs it.

## Sources

- Alignment: Montreal Forced Aligner 3.0 benchmark (2026 preprint); Nyra/FuseAlign; Interspeech 2024 aligner comparison; WhisperX.
- Speech units: Chafe's intonation units; Inbar, Genzer, Perry, Grossman & Landau (Journal of Neuroscience, 2023); Griffiths 1990; Buck 2001; Audible/ACX production norms.
- Curiosity and narrative: Kang et al. (Psychological Science 2009); Brod & Breitwieser (npj Science of Learning 2019); Mar et al. (Psychonomic Bulletin & Review 2021); van Laer et al. (Journal of Business Research 2019); Shen, Sheer & Li (Journal of Advertising 2015); Guo, Kim & Rubin (L@S 2014).
- Disfluency: 2026 *Cognition* study on filled pauses and trust.
- Judges and claims: LLM-judge creativity studies (2026); FActScore; VeriScore; Wachsmuth et al. argument-quality taxonomy.
- Synthetic voice pace: Hayakawa et al. (LREC 2018).
- Law: Hosseinzadeh v. Klein, 276 F. Supp. 3d 34 (S.D.N.Y. 2017).
- Tabled material (for the record): Chakrabarty, Ginsburg & Dhillon on author-specific fine-tuning; Antislop (ICLR 2026); Chakrabarty, Laban & Wu (CHI 2025); Kobak et al. (Science Advances 2025).
