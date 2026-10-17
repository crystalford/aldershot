# 05 — Infrastructure and cost

## Stack (all Cloudflare)

| Piece | Service | Why |
|---|---|---|
| App + API | **Workers** | one origin, edge routing |
| DB | **D1** | relational, cheap, fits the model in `03` |
| Originals, frames, renders | **R2** | no egress fees; originals kept forever |
| Preview playback | **Stream** | HLS + poster without building a player pipeline |
| ffmpeg / Whisper | **Containers** | long CPU work Workers cannot do |
| Job fan-out | **Queues** | one consumer per job type, retries built in |
| Meaning search | **Vectorize** | clip embeddings, thread clustering |
| Live job state | **Durable Objects** | one DO per source, pushes progress to the UI |
| Metrics | **Workers Analytics Engine** | high-cardinality per-user counting |
| Auth | **Access** or plain email link | single-user first, so keep it simple |

**Storage split that matters:** originals live in R2 (cheap, no egress); only *finished* pieces and previews go to Stream (billed per minute stored *and* delivered). Putting every original in Stream is the single easiest way to make this product unprofitable.

## Permanence, not deletion

The user has ruled out auto-deletion. Three mechanisms make that affordable:

1. **Cold tier.** Sources untouched for 90 days move to R2 Infrequent Access. Transcript, clips, frames, and renders stay hot — those are what the product reads. A cold original is only needed to re-render.
2. **Proxy-first.** Keep a 720p proxy hot for editing and previews; the original is only pulled for a final render. Cuts hot bytes by ~70%.
3. **Bring your own bucket.** Studio plan lets the user attach their own R2 or S3 credentials; originals land there, Aldershot keeps only transcripts, frames, and edits. Their archive, their bill, permanent by construction.

Never delete. Degrade to cold, or hand ownership to the user.

## Metering

Every job consumer, on completion, writes one `usage_events` row with what it actually burned and the unit prices at that moment. Cost is then a query, and history stays true when prices change.

```ts
await meter(env, {
  user_id, job_id, job_type: 'transcribe',
  source_minutes: durationS / 60,
  cpu_ms: containerCpuMs,
  bytes_stored: outBytes,
  unit_prices: PRICES,           // snapshot, not a reference
});
```

Also emit the same numbers to Analytics Engine for cheap dashboards, and reconcile monthly against Cloudflare's GraphQL Analytics API so your figures match the real invoice.

**Price everything per source minute.** It is the only unit that moves spend here. The number pricing gets set from is **cost per finished video**.

## The cost model (order of magnitude, 2026 prices — verify before pricing)

Per **60 source minutes**, ending in one finished cut plus 3 shorts:

| Stage | Driver | ≈ cost |
|---|---|---|
| Transcribe | Whisper on a container, ~0.15× realtime | \$0.50 |
| Frames + probe | ffmpeg, one JPEG / 5s | \$0.05 |
| Score pass | ~120k tokens in / 20k out, Sonnet | \$0.70 |
| Extra passes | 2–4 more, smaller | \$0.40 |
| Render | ffmpeg concat, ~0.3× realtime | \$0.35 |
| Shorts | reframe + burn captions, 3 × | \$0.30 |
| Storage | ~3 GB hot (original + proxy + frames) | \$0.05 / mo, forever |
| Delivery | previews, mostly the user's own | \$0.10 |

≈ **\$2.40 per finished video**, plus roughly **\$5–6 per TB per month that never goes away**.

A heavy user (40 source hours/month) is therefore ≈ **\$95–110 of variable cost** plus accruing storage — which is why the owner cost panel exists before pricing is set, and why per-plan minute caps ship in phase 1.

## Pricing shape this implies

- **Free** — 60 source minutes/month, 720p, watermark-free, hard cap. Enough to feel the claim, not enough to abuse.
- **Pro \$39/mo** — 15 source hours, 4K, ElevenLabs via own key.
- **Studio \$119/mo** — 50 source hours, bring-your-own-bucket, priority queue.
- Overage sold in minute packs, priced at ~3× cost.

The caps are in source minutes because that is the unit the cost is in. Never sell "unlimited" on a variable-cost product.

## Publishing

No YouTube API in phase 1 — the OAuth review is its own project. Export to file, plus one webhook and optional **Buffer / Publer** handoff so scheduling is someone else's problem.
