# The eval set

Phase 0: *"~200 claims over ~10 hours across a stream, a meeting and a vlog;
each labelled with the backing utterance (word span) or 'none'; near-miss
negatives written on purpose; two labellers, agreement recorded."*

Everything downstream of retrieval is a guess until this exists, and nothing
in this repo can invent it: it is somebody's own footage, judged by somebody
who watched it.

## How it gets here

1. Label in the app, at `/eval`. A claim, the moments retrieval found for it,
   three taps each. The page says who is answering — change the name and a
   second person's answers sit beside the first's rather than replacing them,
   which is what makes the agreement figure possible at all.
2. Export it: `curl -o eval/set.jsonl <host>/api/eval/export` while signed in.
3. Read the numbers: `npm run eval:set`, or `npm run eval:set -- --live` with
   a dev server running to get recall@5 as well.

## What is in here

- `example.jsonl` — three claims, obviously invented, as a worked example.
  It exists so the runner can be exercised and tested without anybody's real
  footage, and it is **not** the set: three claims measure nothing.
- `set.jsonl` — the real one, when it exists. Not committed by default: it is
  a person's own transcript, and whether that belongs in a repository is
  their decision rather than this file's.

## What the numbers mean

**recall@5** — did retrieval put a backing moment in the top five? Claims
nothing backs are not misses; they are the set's negatives, and they are the
reason a threshold can ever learn to say "nothing here backs this".

**precision and recall per label** — per label, because a judge that never
says *related, not enough* can look excellent overall while being useless at
the one job the threshold exists for.

**false-support rate** — how often something is called support when a person
said it is not. A near-miss counts as wrong here, deliberately: near-miss
evidence presented as a receipt is the failure this whole set exists to catch.

**agreement** — raw, and Cohen's kappa. A set two people cannot agree on is
measuring the labellers rather than the system. Below about 0.6 the labelling
guidance needs work before any other number here means anything.

## `adversarial.jsonl` — the constructed half

19 claims, 25 judgements, authored rather than collected. Every one is a way a
judge says "backs" when it should not: the claim's own words used to deny it, a
counterfactual, somebody else's words quoted, the right act about the wrong
person, a claim asserted and then narrowed to nothing. Five are controls —
genuine support — because a set of nothing but near misses rewards a judge for
refusing everything, and a judge that refuses everything has a false-support
rate of zero and is useless.

Run it against the judge:

    npm run eval:set -- --file eval/adversarial.jsonl

**What it is not.** One author's labels, so it measures failure modes and not
inter-rater agreement — kappa over this set is a number about nobody. A worst
case rather than a sample, so a rate here is not the rate in the wild. And it
says nothing about retrieval: whether the right clip is found at all is
`set.jsonl`'s job, over real footage, which nothing in this repo can invent.

It exists so a model swap is a measurement. CLAUDE.md requires one — "gated by
the eval set before a model swap" — and until this file there was nothing to
gate against, so every model in the product was chosen on price and
plausibility.

The categories are in `src/eval-adversarial.ts` with a sentence each, and
`coverage()` fails the set if one of them is empty or the controls fall below a
fifth. That check caught its own author on the first draft: three controls in
seventeen claims.

### It is saturated, which is a result and not a pass

As of 21 Oct 2026 the shipping judge gets all 25 right: 0.0% false support,
nothing refused, nothing unanswered. That is **not** the set working. A set
everything passes cannot say which of two models is wrong less often, and that
is the only question it exists to answer.

The three numbers behind that run, each one a separate fix:

| | false support | real support refused | unanswered |
|---|---|---|---|
| first run | 0.0% | 5 of 9 | 4 |
| re-ask + measured budget | 0.0% | 1 of 9 | 0 |
| prompt: entailment counts | 0.0% | 0 of 9 | 0 |

Two of that first "5 of 9" were never answered at all — a truncated response
parsed to nothing and every moment defaulted to `unrelated`, which read as
caution. The other three were real over-caution: the prompt's one line
"judge what was SAID, not what the speaker probably meant" was killing
paraphrase along with the hypotheticals it was written for.

So the next thing this file needs is harder cases, not more of these: near
misses that survive a judge which already handles denial, tense, attribution,
subject, place, time and self-correction. Until it has them, a green run here
licenses nothing.

### When a model's disagreement may change a label

Almost never, and once so far. The rule:

A disagreement is a **flag for re-reading the pair**, never an answer. The
label changes only if a careful reader with the claim and the clip in front of
them, and no knowledge of what any model said, would not have written it — and
then the row records what it used to say and why it was wrong. If the re-read
confirms the label, the label stands and the model is wrong; that is the normal
case and the whole point.

`adv-backs-1` is the one. Its claim read "she priced the move in rent because
the other price was harder to say" over a clip that names both prices and never
says why she led with rent. A reason for a choice is an interpretation of the
speaker, not a thing said — the same distinction the judge's own prompt draws —
and the note called it "stated plainly" when it was not stated at all. The
claim now reads what the clip establishes.

The failure mode this rule guards against is obvious and fatal: relabel every
disagreement and the set converges on whatever the current model happens to
say, scores 100%, and measures nothing. The table above is already one row away
from that.
