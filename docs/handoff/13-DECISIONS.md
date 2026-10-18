# 13 · Decisions

The decisions that shaped the product, with the reasoning — so nobody re-opens them by accident. Each is a sentence you can quote back.

## Shape

1. **One room and Settings.** Nine surfaces became three, then two, then one. Home and the Editor were the same object at two depths; they are now one room with two states — no project, and a project. Footage is the first tab; Projects is a tab; Shorts is a tab; there are no rooms or workspaces. *Every extra place was a place to get lost.*
2. **The merge forked the Editor; it did not rebuild it.** Three attempts that rebuilt or re-navigated lost what the Editor already did well. The fourth kept Editor X whole, swapped the useless Overview for Footage, moved status into the conversation, and put Home's front door in the empty state. *Fold, don't rebuild.*
3. **Home is footage-first.** Attach, then say what you want; or say what you want and let it find the footage. *The product is the material plus a sentence.*
4. **The nav names states, not pages.** Home = no project; Editor = the project; the wordmark closes it. *Three pages that looked like three sites was the first thing the founder noticed.*

## Language

5. **Rules, not scores.** Rule numbers on blocks; Strong / Worth a look / Long shot with reasons, never percentages. *A number without a reason is a black box.*
6. **Sentences, not labels.** Every string someone would say out loud. *Copy is the quality signal people skip.*
7. **Observable, never psychological.** The Read, the plan and Scout describe behaviour; the planner refuses diagnoses. *A fairness defence survives "he berated chat"; it does not survive "he's a narcissist".*
8. **The product's vocabulary is fixed** (`14-GLOSSARY.md`). Moments, blocks, beats, rules, ghosts, missions, receipts. *Code, copy and commits use the same words.*

## Engine

9. **Rules are the source of truth; a cut is a view.** *Timeline tools store outcomes; we store reasons.*
10. **The model directs, a solver places; the model never outputs a timestamp.** *Agents resolve ~27% of real editing tasks and claim success 93% of the time.*
11. **Validate and measure before showing.** The model's own report of success is never trusted. *Quality-only failures were most of the failures.*
12. **One footage file, one engine** (`footage.js`) shared by Home and the Editor. *Two copies of the sample drifted within a week.*
13. **Edits as policies.** "Tighten 10%" is one setting; Shorts and the cut are two profiles of one rule set. *Re-solve, don't rebuild.*
14. **Direct manipulation stays as the door.** *The one user study: people succeed because they can refine by hand.*

## Writing

15. **The genre word never reaches the writer.** Intent parse → brief → plain register; genre applied afterwards as an edit profile. *A genre word is a costume; the model performs it.*
16. **Drafting from a thesis is allowed.** What failed was drafting from a genre with no plan. The founder was right; the earlier "never from a brief" line was withdrawn. *The interview is for when there is no material.*
17. **The voice profile is tabled.** *Light editing of a plain draft is enough when the material is facts and argument.*
18. **Pre-production stops once** — at the beats. *Ten gates is a research pipeline with a UI on it.*

## Footage

19. **Read once; editing is free.** Hours are charged at first read. *The processing-minute model, confirmed by the cost research.*
20. **Match on utterances, give context from topic spans. Retrieve by words and by meaning independently; fuse by rank.** *On transcripts a keyword search is a peer, not a re-scorer.*
21. **"Nothing backs this" is engineered.** Three-way label, our threshold, near-miss negatives. *Models alone never abstain or always do.*
22. **Threads are labels, not the index.** *"Everything tagged DSP" is a scope filter.*
23. **Visual reading is a tier, not a default.** *It's most of the cost and mostly serves B-roll search.*
24. **The eval set is the highest-leverage asset.** *It routes every model and is the only thing a model release can't give us.*

## Pictures

25. **The picture answers "why am I seeing this".** Move → job → source order. *The stock gavel is an integrity problem.*
26. **Own → documents → open world → generated; generated never photoreal, never over a claim or its proof.** *AI imagery lowers trust even when labelled.*
27. **Graphics are code, never pixels; bars start at zero; the receipt shot is the house move.** *Pixel models can't draw a word; truncated axes mislead even when explained.*
28. **Style belongs to the user.** Tokens per project; the constructivist look is a preset. *Aldershot is the mechanism, not the style.*

## Outside

29. **Scout finds and links; it never downloads.** *Platform policy, and a SaaS dies from bans.*
30. **Acquisition is hybrid**: auto only where downloads exist by design; missions elsewhere; match-back by words. *YouTube included.*
31. **Ghosts.** The cut is built before anything is fetched; missions are generated from the cut. *The video never ships with a silent hole.*
32. **Counterpoints are mandatory and shown as effort.** *A battle shown from one side is the bias a fairness defence exposes.*
33. **Attribution is automatic and removable only on purpose.** *"The internet" is not a source.*
34. **The outside toggle lives in Settings as a default and per project as an override.** *Always · Ask me · Never; asked once per project when the footage is thin.*
35. **Stock is a direct integration, not Scout.** *Pixabay and NASA are buttons; Scout is for things that have to be found.*

## Operations

36. **Done means every item is accounted for.** *300 processed, 200 didn't, nobody knew — that is the failure to design against.*
37. **Same model, another pool, before another model.** *Same weights, no drift.*
38. **Meter footage-hours and landed generated seconds at ~3× cost; a spend cap.** *Charge for what drives cost; absorb the failed attempts.*
39. **BYOK covers direction and reading; never falls back to our bill without opt-in.** *Blame attribution is a copy rule.*
40. **Models are rented parts.** Contracts, an eval router, content-addressed invalidation. *Price per capability falls ~50× a year.*

43. **Forced alignment runs in the render container, on torchaudio's MMS_FA, over ~30-second windows.** *A container because the Worker cannot hold a model or a file; MMS_FA because it is an aligner rather than an ASR model repurposed, and the product will not stay English; windows because a wav2vec2 forward pass over an hour of audio does not fit in any machine we would rent. Measured in the sandbox: a 20.1 ms frame step — the ≈20 ms the handoff claims — and agreement with `WAV2VEC2_ASR_BASE_960H` inside one frame on the same clip.*

**The counter-argument**, since it is a real one: MMS_FA is 1.26 GB against the English model's 378 MB, which is 900 MB of image, of CI, and of cold start for a product whose owner's footage is in English. The answer is that the capability contract in `src/align.ts` makes this a model swap rather than a rewrite, so the cheap model is one line away the day cold starts matter — and the expensive one is the one that does not have to be revisited when somebody uploads a podcast in Portuguese.

## Position

41. **"The edit you can interrogate."** Not "AI that edits your video." *Others already say that; receipts are the opening — frontier models ground an answer with correct evidence 1% of the time.*
42. **Hypermediacy for journalism**: show the joins, the ledger, the receipts. *Visible seams are the aesthetic form of the integrity commitment.*
