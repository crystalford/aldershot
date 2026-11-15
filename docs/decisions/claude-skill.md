# A Claude skill over the engine — a spike, not a build

**Status:** spike only. No code. Owner's decision, 28 Oct 2026: *"just a spike
to see what it'd take"*, asked alongside the real question —

> "i noticed capcut has an editing plugin for claude and a lot of people are
> saying how they are editing with claude opus 5.5 … so was hoping to do some
> research into these and see where we are at because maybe an SAAS is going
> to die in this upcoming video editing renaissance"

So this note answers two things: what a skill would actually expose, and
whether an agentic editor makes this product redundant. The second one first,
because it decides whether the first is worth building.

## Does an agent with ffmpeg make this redundant?

**Not for the thing this product does, and the reason is in the invariants.**

An agent with a shell and ffmpeg is genuinely good at the mechanical half:
trim here, concatenate these, burn captions, make it vertical. That half is
commodity now and will keep getting cheaper. Anything whose value was *being
the UI for ffmpeg* is in trouble.

What it is bad at is the half this repo is mostly made of, and the evidence is
in this codebase rather than in an opinion:

- **It will not hold a line.** `src/rules.ts` re-produces the cut from the
  rules every time (invariant 1), which is what makes "switch rule 02 off" a
  real operation rather than a request to redo the work. An agent editing a
  timeline has no such object: ask it for a change and it re-derives
  everything from a conversation it may have compacted.
- **It invents timecodes.** Invariant 2 exists because models do this
  constantly. The whole shape here — the model directs, a deterministic solver
  places, every edit is measured before it is shown — is a response to that.
  `src/grounding.ts` rebuilds every quote from our own segments and drops
  ranges outside the transcript rather than clamping them.
- **It cannot show its working.** Invariant 4 says every claim keeps its
  receipt and "nothing backs this" must be reachable. `scout_ledger`,
  `receipt_pages`, the dispute file and the cue sheet are that. An agent can
  say where a clip came from; it cannot be *checked*, and for the kind of
  video this product is for — one that argues something — being checkable is
  the product.
- **It does not know what you have.** The library, hybrid retrieval, threads
  and the clip index are months of reading somebody's footage. An agent
  starts every session not knowing that a line about rent exists in a video
  from March.

The honest summary: **the editing is commoditising and the evidence is not.**
A tool that is only an editor should be worried. The parts of this one worth
defending are the library, the rules, and the receipts — which is also the
order they should be exposed in, if they are exposed at all.

## What a skill would expose

Read-only, and deliberately: the dangerous version is one that edits.

| Tool | Returns | Why it is safe to expose |
|---|---|---|
| `search_moments(query, mode)` | moments with word-id spans, source, and the line that matched | `findMaterial` already fuses meaning and word search by reciprocal rank. No model writes a timestamp. |
| `get_clip(moment_id)` | the quote, its span, its source and its credit | Rebuilt from our segments, so it cannot carry an invented time. |
| `get_receipts(project_id)` | every external source, what was quoted, and whether it was checked | Already produced for the dispute file and the cue sheet. |
| `explain_cut(project_id)` | the rules, what each kept and dropped, and the contested moments | This is the thing no agentic editor has. |

What it must NOT expose, in order of how badly it would go wrong:

1. **Anything that downloads.** Invariant 9: Scout finds and links, and
   nothing in this codebase downloads audiovisual content from platforms that
   forbid it. A skill is a new caller, and a new caller is exactly how that
   rule gets broken by somebody who did not read it. The gate's
   `no-download` rule covers `src/`; it would have to cover the skill too.
2. **A timeline edit.** "Things that bite" in CLAUDE.md: *the model will
   propose timeline edits if you let it; only accept rule objects and
   directives.* A skill that took an EDL would delete that guarantee on the
   first call.
3. **Scores.** Invariant 3 — no percentage reaches a user. A tool returning
   `score: 83` puts one in a chat window, and the band-and-reason shape
   (`Strong / Worth a look / Long shot` with the line that caused it) has to
   survive the trip.

## The thing that actually blocks it

**A receipt that can be discarded is not a receipt.**

Invariant 4 holds because this product controls the surface: a claim and its
proof are rendered together and the proof is one press away. Hand the same
data to an MCP client and the model can quote the moment and drop the
provenance — not maliciously, just by summarising. The integrity envelope has
to be enforced somewhere the client cannot skip, and a tool result is not
such a place.

Three ways out, none free:

- **Return the receipt inline and make it part of the quote**, so dropping it
  mangles the text visibly. Ugly, and the model will still paraphrase.
- **Return a receipt URL per claim** (`/r/:token` already exists and is the
  only public page this product has). Cheap, and it makes the quote useless
  without the link.
- **Sign the payload** and refuse to serve the clip to anything that cannot
  present the signature back. Real work, and it only moves the problem.

The second is the one worth spiking: it reuses a page that exists and it fails
visibly rather than silently.

## Cost and risk

- **Cost to build:** small. The four tools above are thin wrappers over
  `findMaterial`, `getSegments`, the receipt builders and `compute()`. A week,
  not a quarter — the engine is the part that exists.
- **Cost to be wrong:** large and one-directional. An agent endpoint is a
  second front door with no UI to constrain it, and three of the ten
  invariants are currently enforced partly by the fact that the only caller is
  this product's own pages.
- **Strategic risk of NOT doing it:** moderate and rising. If editing is where
  people already are — in a chat window — then a product that cannot be
  reached from there is a product people have to remember to open.

## Recommendation

**Not before launch, and the order matters when it happens.**

> **AMENDED 15 Nov 2026 — narrowly overturned, and here is the argument.**
>
> The strategic risk above said "moderate and rising". It has arrived and it is
> now specific: a free, competent model-driven ffmpeg orchestrator exists, and
> its own documentation positions the planner as somebody else's job. Waiting
> costs the position rather than the time, so "not before launch" no longer
> holds as written.
>
> What was right about it was the part about **front doors**, and exploration
> made that cost concrete: there is no machine authentication anywhere in this
> codebase. `requireUser` is a cookie read and nothing else, and `src/auth.ts`
> has no bearer path. An agent endpoint would need one built from nothing,
> which is the expensive, one-directional half of the cost above.
>
> So only the part that opens **no new door** is built: `/r/:token` was already
> public, already revocable, and already a deliberate publishing act, so
> serving its existing contents as data adds no reachable state and no new
> consent surface. That is `/r/:token.json`, and it answers "the thing that
> actually blocks it" above — the receipt cannot be detached from its subject,
> because the only way to hold one is to hold a link the maker can switch off.
>
> The four tools below still wait, for the amended reason: not that it is too
> early, but that each needs an authentication system that does not exist. With
> the JSON receipt shipped, a wrapper can be written OUTSIDE this repo against
> public receipt URLs — which is the better side of the line anyway. The asset
> here is the evidence, not the adapter.

1. `get_receipts` first. It is the thing nothing else has, it is read-only,
   and it is the one that makes the case for the rest.
2. `search_moments` second, returning bands and reasons, never scores.
3. `explain_cut` third.
4. `get_clip` last, behind the receipt-URL decision above.

Never an edit tool. If an agent should be able to change a cut, it should do
it the way the product does: by proposing a RULE, which the user can see and
switch off. That is `12-DEFERRED.md`'s "agent endpoint exposing
`search_moments`, `get_clip`, `get_receipts`, `render_variant` with the
integrity envelope enforced server-side" — which is the same conclusion
reached from the other end, and `render_variant` is the one item on that list
this note would drop.
