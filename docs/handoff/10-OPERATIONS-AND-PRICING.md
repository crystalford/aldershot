# 10 · Operations and pricing

## No frontier API is error-free; the product can be

- The same model reachable through **more than one capacity pool** (first-party → Bedrock → Vertex). Fail over to the same model on another host *before* a different model; a different model must pass the eval before it's enabled for a role.
- **One state row per item**, with a content-addressed idempotency key. A job is complete only when every item is terminal and none failed, or the user accepted a degraded result. A reconciler re-enqueues anything past its deadline. **Silent partial failure is a P1.**
- Error classes drive behaviour: 429 → back off on the headers; 529/5xx/timeout → switch pool; moderation → rewrite once, then another model, then ask; 4xx validation → surface with a fix-it line. Circuit breaker per provider+model; bulkhead per provider. SDK retries off; the gateway retries fast; the workflow retries slow with jitter. Dead-letter queues on every consumer.
- A **degradation ladder** for a generated shot — preferred model → same class elsewhere → cheaper tier → stock or still with motion → labelled placeholder with Regenerate — every rung recorded on the item and shown on the block.
- **Progress is per item, never a spinner**: "14 of 16 shots · 2 retrying on the backup provider"; *notify me* for anything measured in minutes. Acknowledge within 1 s; stream the plan.

## Speed tiers — keep the model out of the hot path

| Tier | Budget | What | Where |
|---|---|---|---|
| instant | < 100 ms | scrub, trim, cut, undo, apply an accepted diff | local, same compiler as the server |
| fast | < 1 s | deterministic ops over precomputed data ("remove ums", "tighten 10%") | server, no model |
| thinking | 2–10 s | real judgement ("find where he contradicts himself", "build the argument") | frontier model |
| background | minutes | final render, GPU jobs | never blocking |

Analyse once at upload. A router sends routine commands straight to ops; the frontier model sees only what needs reasoning. Speculate while idle (the tighter cut, the short version). Content-addressed render chunks so a revised export takes seconds. Compact block view and a cached prompt prefix per project; send deltas.

## Capability contracts and the eval router

Every intelligence task sits behind a typed interface (`Transcribe`, `Locate`, `Judge`, `Direct`, `Inpaint`…). A registry stores provider, version, price, latency. A **nightly run against the golden set** scores every provider; a router picks the cheapest that clears the bar per contract. A new model is a registry entry. Model-free forever: the solver, timeline compilation, QC, provenance signing, receipt verification.

## SLOs for one person

Job delivered without user-visible failure ≥ 99.5% over 28 days (launches freeze on budget burn) · chat acknowledged p99 < 1 s · edit → preview p50 < 20 s, p95 < 60 s · 2 h indexed p95 < 15 min · generated shot delivered (any rung) p95 < 8 min · **silent partial failures: 0**. Per-call telemetry rolled up nightly — **per-job cost is the most important number in the business**. Canaries per model path; a public status page. Page only on budget burn, any DLQ message, or per-job cost > 2× estimate.

## BYOK

The user's key covers **direction and reading**; rendering, QC, orchestration and the solver stay on the platform fee. Envelope encryption; decrypted only inside the calling worker; never logged; last four characters shown. **Probe on save** and say plainly what the key can carry ("about 80k tokens a minute; a two-hour read takes about 40 minutes"). A failing key **never falls back to our bill without opt-in**. Blame attribution is a copy rule: the provider's overload, your key's limit and our failure are three different sentences. Verify provider terms permit calling with a customer's key before launch.

## Cost per job (Oct 2026 list prices; re-run on the first 100 real jobs)

| Job | COGS |
|---|---|
| 10-min essay from 2 h of footage | $5–14 |
| first 60 s short from a 1 h podcast | $2–5; each extra short $0.5–1.5 |
| react video from a 20-min source | $2–4 |
| generative-heavy 3-min (90 s generated × 3 attempts) | $33–115 — premium models triple it |

Transcription, render and storage are rounding errors; the money is model tokens and generated seconds. Overgeneration (2–4 attempts per usable shot) is the real multiplier.

## Meters and plans

Meter what drives cost, at about 3× expected cost:

- **Footage-hour** — $12; counted once when footage is first read; every cut, short and revision afterwards is free.
- **Generated video** is made in clips of up to 8 seconds (Veo 3.1's limit; the models like it are close). Priced at about 3× the model's list price per second: **Fast** 36¢ a second (Veo 3.1 Fast lists at 12¢), **Full quality** $1.20 (Veo 3.1 lists at 40¢). A **generated still** is 12¢. A shot longer than one clip is one clip that then holds its last frame, a clip every 8 seconds cut together, or a still that moves; each is priced by the seconds actually generated. **Billed only for what lands in the final cut**; failed and rejected attempts are absorbed. List prices are November 2026 and are re-read before launch.
- **One monthly limit**, the person's, set in Settings: what generated pictures and voices may be charged this month, $50 until they choose. Nothing generates past it until they raise it; reading footage and editing never count against it.
- Behind it, a **brake** on what all of an account's work costs to run — $400 plus what the limit lets generation cost — so a runaway job stops the same day. It is not a second setting; it rises with the limit, and its refusal says to raise the limit. (22 Nov; doc 22, row 4. Until then the brake was the setting, and `spend_cap_usd` is kept but no longer read.)

| Plan | $/mo | Included |
|---|---|---|
| Starter | 39 | 3 footage-hours · 1080p · generation by top-up |
| Creator | 99 | 7 footage-hours + 20 standard seconds · 4K |
| Studio | 249 | 18 footage-hours + 60 standard seconds · priority queue · Scout included |
| BYOK Platform | 29 | 10 footage-hours of render/QC/orchestration · $2 per extra hour · model calls on the user's keys |

Expected gross margin 63–69%; worst case 41–46%. Annual discount only after three months of measured cost per job. Big swing worth considering: *"Your video is delivered, or the job is free"* for footage-led jobs — at these margins and ≥ 99.5% success it costs under 0.5% of revenue in a category with no published SLOs.

## Infrastructure shape (confirm every price)

One server object per project holding the edit document and ops log (single writer; everything persisted) · workflows fanning out to CPU containers for ffmpeg, the headless compositor and analysis models · object storage for originals, proxies, renders, stems · **no GPUs on the platform** — segmentation, learned interpolation and stabilisation on an external GPU host behind one job interface, cached by (media hash, params) · proxies self-generated at ingest (1-s GOP, constant frame rate, 540p) · browser preview via WebCodecs with the audio clock as master · one compositor codebase in browser and container · chunked render at block boundaries, audio as one continuous pass.

*Rests on:* `labs/OPERATIONS.md`, `labs/EDIT-ENGINE.md`, `labs/STRATEGY.md`.
