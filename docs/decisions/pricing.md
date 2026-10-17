# Pricing: the handoff contradicts itself

## What disagrees

`docs/archive/handoff-v2/05-INFRA-AND-COSTS.md` §"Pricing shape this implies":

- **Free** — 60 source minutes/month
- **Pro $39/mo** — 15 source hours
- **Studio $119/mo** — 50 source hours

`design/Landing.dc.html` (pricing section) and the Settings panel in
`design/Aldershot.dc.html`:

- **Free $0** — 300 processing minutes/month, 25 GB
- **Studio $29/mo** — 1,200 processing minutes/month, 100 GB

Three tiers or two. $39/$119 or $29. 60 minutes or 300. And a different
unit: *source* minutes (how long the video is) versus *processing* minutes
(time spent reading, rendering, burning captions).

## What we shipped, and why

The prototype. Two tiers, $0 and $29, 300 and 1,200 minutes, 25 and 100 GB.

Two reasons:

1. The standing rule in the handoff is that where prose and prototype
   disagree, the prototype is authoritative.
2. The prototype's numbers are the ones on the pricing page. A customer
   reads them before paying, so they are the promise; the prose doc is
   internal reasoning about cost.

`pro` is kept in `PLANS` as an alias of `studio` rather than removed. The
column is free-text `TEXT`, and any row already carrying `"pro"` has to keep
working — falling through to Free's allowance would cut off an account that
had paid.

## The bug this surfaced

Settings hardcoded 300/1,200 while `checkCap` enforced 60/900/3000. A free
account was told it had 300 minutes and cut off at 60. Both now read
`PLANS`, so the number shown and the number enforced are one number.

## Still unresolved

We cap on *source* minutes and label it *processing* minutes. Those are the
same for reading (the dominant cost) but not for rendering, which the design
counts and we do not. Closing that means metering render duration into the
same bucket `checkCap` reads. Until then the cap is slightly generous, which
is the safe direction to be wrong in — it never refuses work the user was
told they could do.

**For the owner:** if you want the prose doc's pricing instead ($39/$119,
three tiers, source minutes), say so and both prototypes need updating too —
the pricing page is the thing customers see.
