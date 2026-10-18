# 19 · The Scout eval — what to gather, and what it will tell you

Doc 18's v0 acceptance has five criteria. Four are enforced in code and
tested. The fifth — *"`search.list` spend stays under the daily cap on the
20-brief eval"* — names an eval that did not exist, so it could not pass or
fail. `src/scout-eval.ts` is the measuring half. This is the half only the
owner can supply.

## Why the ground truth is not in the repo

`labs/SCOUT.md` asks for **10–20 creators with fan-curated timestamp lists —
Reddit and wiki incident lists, compilation chapters — as recall ground truth
within ±30 s.**

That is real people's work about real subjects. Inventing a set would be
inventing the answer: a harness scored against timestamps somebody made up
measures how well the system agrees with whoever made them up, and it would
report a number that looks exactly like a real one. So the metrics are
written and tested, and the set is empty until it is gathered.

## What a brief looks like

One JSON file per brief in `eval/scout/`, which is gitignored by default
because these are notes about named living people.

```json
{
  "briefId": "dsp-begging",
  "brief": "a video about his constant asking for money on stream",
  "subject": "DarksidePhil",
  "sources": [
    { "sourceId": "yt:abc12345678", "url": "https://www.youtube.com/watch?v=abc12345678" }
  ],
  "truth": [
    { "sourceId": "yt:abc12345678", "tS": 872, "provenance": "r/LivestreamFail thread 2024-03-14", "note": "asks for a donation mid-boss-fight" }
  ]
}
```

- `tS` is **seconds into that source**, as the human wrote it down. It does
  not have to be exact — the recall window is ±30 s for precisely this reason.
- `provenance` is not decoration. An eval is only as good as where its labels
  came from, and a set whose rows cannot be traced back is a set nobody can
  argue with later.
- `note` is what the list says happens there. It is read when a row is MISSED,
  which is the half of the result worth anything.

## What makes a good set

- **Twenty briefs, not five.** The research's "about 20 briefs shows large
  effects" is a statement about statistical power. Below that, the ablations
  cannot distinguish a real difference from noise, and `MEANINGFUL_DELTA`
  exists so the harness says so rather than reporting the noise.
- **Unlike each other, along named axes.** `docs/research/PASS-4-BRIEF.md`
  sets them out for the composition work and they apply here: library density,
  who the subject is, where the evidence lives, the spine, legal exposure, and
  whether a thesis exists before the footage. Twenty briefs about twenty
  streamers is one brief twenty times.
- **Including subjects nobody has indexed.** A set made only of people with
  Reddit incident threads measures the crowd family and little else, and the
  crowd family is the one that works. The interesting failures are the
  subjects where it has nothing to point at.
- **Including at least one brief that should find nothing.** A claim that is
  not true, or is not on camera. A system that cannot return an honest empty
  result on that brief will return something, and what it returns is the
  product's worst output.

## What each number means, and how it lies

| Number | What it is | How it flatters |
|---|---|---|
| **Recall** | Of the fan-indexed moments, how many the run found | Matching a set rather than a window scores near zero on a system that worked. Matching greedily counts one find between two timestamps twice. |
| **Precision** | On-beat and correctly attributed, **human-rated** | A model rating its own output measures agreement, not accuracy. Averaging off-beat with misattributed hides the second rising. |
| **Verification pass rate** | Of everything judged, what survived the verifier | Measured over the survivors it is always 1. The denominator is everything the scan handed over, rejections included. |
| **Counterpoint coverage** | Counter beats with a verified find | A plan with no counter beats has not covered the other side; zero over zero must not be 1. |
| **Time to first good clip** | To the first verified **and on-beat** one | Measured to the first verified one, a fast confident answer about the wrong thing scores best. |
| **Cost per accepted moment** | Spend over verified finds | A run that found nothing has no cost per moment. Zero would read as free. |
| **Saturation** | Held-out budget after stopping, counting new finds | The stopping rule's own numbers cannot falsify it — a knee firing early produces a curve that looks flat. This is the only honest test, and a high ratio is a failure of the RULE, not of retrieval. |

## The acceptance criterion, read off the report

`setReport(...)` sums `search.list` calls across the whole set and compares
them against the daily cap of 100. **Summed, not averaged** — the cap is a
daily total for the API project, and averaging would say twenty briefs at ten
calls each were within a hundred.

The report carries a sentence for exactly this purpose, so the criterion is
read rather than inferred:

> `80 search.list calls across 20 briefs, under the daily cap of 100`

An unrun eval is trivially within the cap, which is why an empty set reports
*"no briefs were run, so nothing has been measured"* instead.

## The ablations

Four, from the research: the counter branch, vocabulary discovery, window
size, and one versus several questions per window. Each is run by turning the
thing off and re-running the set.

The counter branch is the one to run first. It is the most expensive part of
every run — a whole extra family of queries per beat — and it is the part a
cost-conscious reading of the numbers would cut. If it does not move recall or
coverage, that is worth knowing; if it does, it stops being negotiable.

## What this eval does not measure

- **Whether the finished video is any good.** It measures finding, not
  cutting, and the two are different problems — `PASS-4-BRIEF.md` is about the
  second.
- **Whether a gap is real.** "Nothing found" and "nothing there" are
  indistinguishable to a harness, and the diligence log is what separates them
  for a person.
- **Harm.** A run can score well on every number here and produce a supercut
  that is unfair, which is what section 7's fairness rules and the review
  obligation in `PASS-4-BRIEF.md` are for.
