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

### A single run was never a result

**Read this before trusting any number below.** The shipping judge was run
twice over the same 40 judgements, an hour apart, nothing changed in between:

| | false support | real support refused |
|---|---|---|
| run A | 0.0% | 2 of 16 |
| run B | 11.1% | 0 of 16 |

That is one model disagreeing with itself by more than any model swap would
need to show. Nothing in this product set a sampling `temperature`, so every
call ran at the provider's default and the judge was never deterministic.
Every single-run figure reported before this was one sample of a noisy
quantity — including two "0.0% false support" results that read as clean
sheets.

Two problems, and the eval is the smaller one. A verdict that flickers is a
receipt that sits under a claim today and is gone tomorrow, which is invariant
4 failing in the direction nobody checks: "every claim keeps its receipt"
means it keeps the *same* receipt.

The fix, in `src/models.ts`: a capability whose answer is a decision is pinned
to temperature 0 — `judge`, `classify`, `arrange` — while `direct` and `name`
write prose and stay sampled. `read` has no eval set, so it was left alone
rather than changed on a hunch.

**It narrowed the spread and did not close it.** Two runs with the judge
pinned:

| | false support | real support refused | said "backs" |
|---|---|---|---|
| pinned run 1 | 0.0% | 1 of 16 | 15 |
| pinned run 2 | 0.0% | 0 of 16 | 16 |

Better than 0.0%-to-11.1%, and still not the same answer twice. Temperature 0
is a request, not a guarantee: the serving stack has its own
nondeterminism, and the re-ask path adds a second call on any claim the first
answer did not cover. So the conclusion holds with the fix in place — a point
estimate from one run is not a property of the model. `npm run eval:model --
--runs 3` prints the range, and a one-run figure now comes with a line saying
so.

**That fix does not reach Claude.** Opus 5.5, Opus 5, Sonnet 5.5 and the Fable
line all return a 400 for `temperature`, so an Anthropic judge cannot be
pinned at all and `src/llm.ts` refuses to put one on that wire. Its variance
has to be measured instead of removed: score it over several runs and compare
ranges, never two single runs. A model-swap decision taken from one run of
each is a coin toss with a table around it.

### It was saturated, which is a result and not a pass

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

So the next thing this file needed was harder cases, and it has them: seven
categories chosen to survive a judge that already handled denial, tense,
attribution, subject, place, time, self-correction, half-claims, topical
overlap and qualification.

| | the difference |
|---|---|
| `scope` | some, where the claim says all — the quantifier is the only change |
| `agency` | the act happened and the clip says nobody knows who did it |
| `strength` | a weaker verb: reluctance is not refusal |
| `role-swap` | the claim's own words with doer and done-to exchanged |
| `magnitude` | the right act at the wrong size |
| `correlation` | two facts in one sentence, and the claim says one caused the other |
| `aggregate` | two clips that together cover the claim, neither alone — shown side by side, so the test is whether the other half promotes either one |

29 claims and 40 judgements now, 8 of them controls (27.6%). Three of the new
controls are deliberately hard: a universal established by what everyone
assumed, support that is two dates and a subtraction, and — the set had none
before — a claim whose content is an *absence*.

**The new categories did not add the discrimination.** The judge scored 0
wrong on all seven at the first attempt. What stopped the set being saturated
was the control side and the variance above, which is a different finding from
the one these cases were written to produce, and worth saying plainly rather
than claiming the credit.

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
