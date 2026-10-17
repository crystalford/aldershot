# Operations — fast, reliable, BYOK-ready, profitable

7 Oct 2026, from pass 10. Nothing here is built. This is the engine-room contract behind "it never silently loses an item" — and the pricing that keeps a quality-first product solvent.

## The one-line version

**No frontier API is error-free; the product can be.** Four things make that true: the same model reachable through more than one capacity pool; a durable state row per item (not per job); generation that assumes failure (overgenerate, gate, retry, degrade); and a UI that never says "done" until every item is accounted for. Price by what drives cost — footage-hours read and generated seconds — at about 3× cost, and bill generated seconds only when they land in the final cut.

## What the evidence settles

- **Frontier APIs fail in normal operation.** Claude API availability measured ~99.4–99.8% across monitors (one bad window in ~200); Anthropic's 529 "overloaded" is a documented load-shedding signal, and **retrying the same endpoint doesn't help a 529** — you need a different capacity pool. OpenAI ~99.96%. Gemini's weakness is latency (13 s to first token on Flash with thinking), not uptime — so it's an ingest model, never on the interactive path. No SLA exists for pay-as-you-go anywhere.
- **Endpoint availability ≠ model availability.** Health checks run a real tiny completion against each *model*, not a ping to the host.
- **Generative media fails double-digit**: 15.8% of video generations on one Replicate account; waits from 35 s to 273 s median, Veo up to 6 minutes at peak. Moderation billing differs — Runway charges a moderation rejection like a success, Veo doesn't — so prompts are pre-screened by an LLM before any provider that bills for moderation.
- **A directive takes ~16 s** (2.3 s to first token + ~14 s of output on Opus-class), before thinking. Not interactive → stream it as plain-language edit notes, keep work running ahead (`EDIT-ENGINE.md`'s speculation), acknowledge within 1 s. Nielsen's limits hold: 1 s for flow, 10 s for attention, percent-done past 10 s, and **"notify me" for anything measured in minutes**.
- **Retries multiply silently**: SDK (2) × gateway (5) × workflow step retries can reach 90 calls for one logical step. SDK retries off; the gateway does fast retries; the workflow does slow, jittered ones.
- **Queues delete on retry exhaustion unless a dead-letter queue exists** — that is exactly how "300 processed, 200 didn't" happens. Every consumer gets a DLQ; the DLQ consumer writes `failed_terminal` and alerts.

## The invariant that kills silent partial failure

One state row per **item** — footage file, segment, generated shot, render chunk — with `status` (`pending → running → succeeded | failed_retryable | failed_terminal | skipped_by_user`), `attempt`, `last_error_class`, `provider`, `cost_usd`, `idempotency_key`, `deadline_at`. The idempotency key is a **content address** — hash(input asset hashes + directive hash + model + params) — the same hash that keys the render cache, so every replay, hedge or duplicate delivery collapses into one stored result.

**A job is `complete` only when every item is terminal and `failed_terminal` is zero — or the user has explicitly accepted a degraded result.** A reconciler alarm re-enqueues anything past its deadline. Nothing can disappear.

**Error classes drive behaviour**: 429 → back off on the rate-limit headers, same provider · 529 / 5xx / timeout → **switch capacity pool, same model** (Anthropic → Bedrock → Vertex) · moderation → rewrite the prompt once, then an alternative model, then ask the user · 4xx validation → non-retryable, surfaced with a fix-it line. A circuit breaker per provider+model (open after 5 consecutive 5xx or >20% errors over 2 min; half-open probe every 30 s); a bulkhead per provider so a stalled video vendor can't starve direction or rendering. **Hedge only what isn't billed on failure**, after the p95 deadline, and cancel the loser.

**The degradation ladder for a generated shot**, every rung recorded on the item and shown to the user: preferred model → same-class model on another host → cheaper tier → stock or a still with motion → a clearly labelled placeholder with *Regenerate*.

## Routing without quality drift

- **Rule 1: fail over to the same model on another host before falling back to a different model.** Same weights, different capacity pool, no drift.
- **Rule 2: a different model must pass the eval** (50 directive tasks + 30 critic pairs) within a margin before it's enabled for a role; every output is tagged with the model that made it, and fallback-model output is critiqued more strictly. *(`STRATEGY.md`'s eval-driven router, applied to failover.)*
- **Cost levers**: prompt-cache the per-project archive (reads at ~5% of input price — a 200k archive read for $0.04 instead of $0.80); batch at 50% off for overnight re-indexing and evals; Fast mode (2×) only when the user is waiting; Bedrock Priority only if 529s persist. **Gemini Flash prices double on 1 Jan 2027** — a price-change clause in the plans.
- **Acceleration limits**: a sharp traffic increase triggers 429s regardless of tier — ramp launches gradually.

## SLOs for one person

| SLI | SLO |
|---|---|
| Job delivered without user-visible failure or manual rescue | ≥ 99.5% over 28 days — feature launches freeze on budget burn |
| Chat acknowledged | p99 < 1 s |
| Edit → preview, footage-led | p50 < 20 s · p95 < 60 s (only with caching and speculation) |
| 2 h of footage indexed | p95 < 15 min after upload completes |
| Generated shot delivered, any rung | p95 < 8 min |
| **Silent partial failures** | **0 — any occurrence is a P1** |

Why 99.5 and not 99.9: one Claude path measures ~99.5; two partly independent pools push uncorrelated failures well past 99.9, but vendor-wide incidents still hit both. Don't promise what you can't measure.

Minimum stack: per-call telemetry (job, item, provider, model, tokens, cost, TTFT, latency, error class) rolled up nightly — **per-job cost is the most important number in the business** · canaries every 5 min per model path, hourly 2-second generations per media route, feeding the breakers and a public status page · release gates (eval suite + a 10-job golden end-to-end run) · page only on SLO budget burn, any DLQ message, or per-job cost > 2× estimate · a one-paragraph note for any incident that burned >10% of budget. No competitor found publishes an SLO — a status page plus a stated SLO is already ahead of the category (verify before using in marketing).

## BYOK

- **Scope**: the user's key covers token-heavy *direction and reading*; rendering, QC, orchestration and the solver stay on Aldershot, paid by the platform fee. (Cursor keeps the parts it relies on for quality and margin on its own keys; Raycast lets BYOK bypass the subscription. Aldershot sits between.)
- **Security**: envelope encryption (per-user data key, AES-GCM, wrapped by a KEK in the secrets store; ciphertext only in the database; decrypted only inside the calling worker; never logged). Pass the user's key on the request. **Turn on "require provider credentials"** so a request missing a key can never fall through to Aldershot's bill.
- **Capacity check on save**: a probe call; read the provider's rate-limit headers; tell the user plainly — *"Your key supports about X tokens a minute; a 2-hour read needs about Y. Expect about Z minutes, or raise your tier."* Show last four characters only; rotation and revocation; recommend a project-scoped key with a spend limit at the provider.
- **Blame attribution**: *"Your Anthropic key hit its rate limit — retrying in 40 s"* is never *"Aldershot error"*; a 529 is *"the provider is overloaded"*, distinct from a rate limit (mislabelling 529 as rate-limiting is a known source of confusion).
- **Failover on BYOK** runs across the user's own providers; it falls to Aldershot credits only if they opted in, at top-up rates. **Estimated cost on your key: $X** before every run. Media BYOK (fal, Replicate, Google) optional, same pattern; pre-screen before any Runway call on a user's key.
- **Unverified**: whether provider terms permit a SaaS to call with a customer's key on their behalf. Check before launch.

## Cost per job at Oct 2026 list prices (quality-first)

| Job | Read / index | Direction + critic | Generated visuals | Render + storage | **COGS** |
|---|---|---|---|---|---|
| 10-min essay from 2 h footage | $1.1–2.1 (2027: $2.2–4.2) | $3–7 | $0–4 | $0.5–1 | **$5–14** |
| 60 s short from a 1 h podcast (first) | $0.6–1.1 | $1–2.5 | $0–1 | $0.1 | **$2–5** · each extra short ≈ $0.5–1.5 |
| React video from a 20-min source | $0.2–0.4 | $1.5–3 | $0 | $0.3–0.6 | **$2–4** |
| Generative-heavy 3-min (90 s generated × 3) | — | $2–5 | $30 (Kling Pro) – $108 (Veo Std) | $0.2 | **$33–115** |
| Generative-heavy 10-min (~2 min generated × 3) | $0–2 | $3–7 | $40–144 | $0.5–1 | **$45–155** |

Readings: the footage-led $5–15 holds. Generative-heavy $25–55 holds **only on Kling-class or Veo-Fast-class**; premium models roughly triple it → **premium is its own meter**. **Overgeneration is the real multiplier** — budget 2–4 attempts per usable shot. Transcription, render and storage are rounding errors; the money is tokens and generated seconds. *(Confirms `EDIT-ENGINE.md`.)*

## Pricing

**Meter what drives cost, at ~3× expected cost**: a **footage-hour** read and edited at **$12** (cost ~$4, worst ~$7); a **standard generated second** at **$1** (Kling 3.0 Pro / Veo Fast class; cost ~$0.34 at 3×); a **premium generated second** at **$3.50** (Veo Standard / Seedance 1080p; ~$1.20). **Bill only the seconds that land in the final cut** — failed and rejected attempts are absorbed by the markup. That is the answer to Runway-style "paid for failures" resentment, and it's what *Before you post*'s cue sheet already implies. Revisions within a project under a fair-use cap (~15 directives).

| Plan | $/mo | Included | Expected GM | Worst-case GM |
|---|---|---|---|---|
| Starter | 39 | 3 footage-hours · 1080p · generation by top-up | 69% | 46% |
| Creator | 99 | 7 footage-hours + 20 standard s · 4K | 65% | 43% |
| Studio | 249 | 18 footage-hours + 60 standard s · priority queue · Scout included | 63% | 41% |
| BYOK Platform | 29 | 10 footage-hours of render/QC/orchestration · $2 per extra hour · LLM on the user's keys | ~79% | ~60% |

Top-ups at the meter rates. Blended margin will beat "full use" — don't plan on it. Annual discount only after three months of measured cost per job. A hard monthly spend cap per account. USD, with a merchant of record for tax. Benchmarks: Descript sells *editor hours* ($16–65 for 10–40 media hours plus credits); Aldershot sells a *finished video* and should cost more per hour. AI-native SaaS gross margins run 55–70% (ICONIQ projects 53% in 2026, 59% in 2027); 60–70% is ambitious but defensible if generation is metered.

**Big swings**: *"Your video is delivered, or the job is free"* for footage-led jobs — at 3× markup and ≥99.5% success, refunds cost under 0.5% of revenue, in a category with no published SLOs · negotiate committed capacity early (Priority Tier is closed to new buyers; a direct relationship is the only route) · **the re-read-free archive**: footage paid for once, every extra short ≈ $0.5–1.5 — heavy users become profitable instead of painful · a generation marketplace routed per shot to the cheapest provider that passes the critic on that shot type, with live price and wait from our own telemetry · BYOK as the agency wedge ($29/seat for orchestration and quality; their keys absorb inference).

## What this changes in Aldershot

- **Progress reporting is per item, never a spinner**: "14 of 16 shots generated · 2 retrying on the backup provider", and *notify me* for anything measured in minutes. The product already shows job stage labels; this fixes the contract: **"done" means every item accounted for.**
- **Settings tells the truth about the meters**: processing minutes become *footage-hours*; generated seconds are a separate meter in standard and premium, billed only when they land in the cut; a monthly spend cap. *(Product updated.)*
- **BYOK in Settings** gains its contract: what the key covers, the capacity check on save, and that a failing key never falls back to Aldershot's bill without opt-in. *(Product updated.)*
- **Degraded results are labelled, never silent** — every rung of the ladder is visible on the block it affected, with *Regenerate*. Joins the editor's existing "generated segments" check.
- **Blame attribution** is a copy rule everywhere: the provider's overload, the user's key limit, and Aldershot's own failures are three different sentences.
- **For the handoff**: the item state machine and completion invariant, DLQs on every consumer, content-addressed idempotency, same-model multi-pool routing with eval-gated model fallback, SDK retries off, breakers and bulkheads, canaries per model, prompt-cached archives, the SLO table, the telemetry roll-up, envelope-encrypted BYOK with required credentials, metering by footage-hour and landed second. Build order: state machine → DLQs → routing → caching → per-item UI → telemetry → media adapters → evals → metering → BYOK → speculation → status page.

## Sources

- Anthropic error and rate-limit docs (429/500/529; acceleration limits; batch; prompt caching; Fast mode; Priority Tier status); OpenAI status page; Gemini pricing (Flash tiers, 2027 change; video token accounting; agentic mode); Veo, fal.ai, Replicate (`Cancel-After`, Sep 2026 failure-rate issue), Runway and Kling API docs and pricing.
- Monitors: universal.cloud, renezander.com, DevHelm, llmlatency.dev, OpenRouter live stats, Opper router benchmark (2026), SandBase generation-wait benchmark (Oct 2026), Tech Times Gemini latency probe (Oct 2026). Vendor-blog claims (TokenMix 529 baseline) flagged as rules of thumb.
- Cloudflare: Workflows (step limits, retries, streams), Queues (DLQ semantics, pricing), Durable Objects, AI Gateway (dynamic routing, BYOK precedence, require-credentials, unified billing), Containers and R2 pricing, Workers AI Whisper pricing; Atyantik on retry multiplication.
- Nielsen, "Response Times: The 3 Important Limits" (NN/G, 1993).
- Pricing benchmarks: Descript (Sep 2025 metering), Runway plans; ICONIQ "2026 State of AI: The Builder's Economy"; SaaSRise margins. Cursor and Raycast BYOK policies.
- Caveats as stated: several prices from aggregators; uptime figures from different monitors and windows; failure rates from small samples; competitor pricing for Opus Clip, Captions, Kapwing, CapCut, InVideo, HeyGen, Synthesia, Pictory not covered; provider ToS on customer keys unverified; margin math assumes ~3× overgeneration, ~30k thinking tokens per directive, 20 critic calls per job — re-run on the first 100 production jobs.
