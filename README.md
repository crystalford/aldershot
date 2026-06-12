# Aldershot

Cloudflare-native cinematic media engine. Decides *what* to make and *when*, then
produces it to an intentional, high-fidelity standard.

- **Vision & architecture:** [`docs/design/architecture.md`](docs/design/architecture.md)
- **Feasibility research:** [`docs/research/feasibility.md`](docs/research/feasibility.md)
- **Content briefs (live waves):** [`docs/content/wave-briefs.md`](docs/content/wave-briefs.md)

## Status: v0 — the Spine

Proving the **Cinematic Compiler** end-to-end on Cloudflare: an art-directed
`ShotSpec` → FLUX.2 still (lock the look, cheap) → Wan 2.7 I2V (add motion) → R2.
Plus Aura-2 voiceover. Assembly (ffmpeg in Containers), the console, the Radar
(Cron-driven trend engine), and publishing come in later phases.

## One-time setup (needs your Cloudflare account)

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create aldershot-media
npx wrangler d1 create aldershot   # paste the returned database_id into wrangler.jsonc
npm run dev                        # local dev
npm run deploy                     # ship to your account
```

## Try the spine

```bash
curl -X POST http://localhost:8787/shot -H 'content-type: application/json' -d '{
  "subject": "a lighthouse keeper on a cursed New England island",
  "blocking": "small in frame, back to camera, facing a churning sea",
  "lens": "85mm telephoto",
  "cameraAngle": "low angle, slightly canted",
  "movement": "slow push-in",
  "lighting": "low-key, hard amber key from a single lamp, deep shadows",
  "palette": "desaturated teal sea, sickly amber practicals",
  "texture": "70s 16mm grain, gentle halation",
  "mood": "dread curdling into awe",
  "intent": "the smallness of man against an old, patient evil",
  "motion": "fog drifts, the lamp flickers, a slow push-in",
  "durationSeconds": 5
}'
```

> Model IDs and billing (native `@cf/` vs partner pass-through) are documented in
> the feasibility doc. Partner video request shapes are marked `TODO` in
> `src/pipeline/compiler.ts` pending live-catalog confirmation.
