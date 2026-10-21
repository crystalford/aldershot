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
