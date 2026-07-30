# Aldershot

Cloudflare-native cinematic media engine. Decides *what* to make and *when*, then
produces it to an intentional, high-fidelity standard.

- **Vision & architecture:** [`docs/design/architecture.md`](docs/design/architecture.md)
- **Feasibility research:** [`docs/research/feasibility.md`](docs/research/feasibility.md)
- **Content briefs (live waves):** [`docs/content/wave-briefs.md`](docs/content/wave-briefs.md)

## Status: v0 — the Project Console

Upload a **batch of videos into one project**, transcribe them all, and edit as text:

- **Projects** — create a project, drag-drop multiple videos (base take + commentary…).
- **Transcribe** — audio is extracted in-browser and sent to Whisper for word-level timing.
- **Edit as text** — click words to cut them; **▶ Play edit** previews the multi-clip cut,
  hopping across videos with the source swapping live.
- **✨ Auto-arrange** — an LLM reads every transcript and proposes a long-form cut: a
  **cold open** of the punchiest hooks, then the best takes in narrative order. Edit it by hand.
- **🎬 Find shorts** — Opus-Clip-style: self-contained 15–60s moments, ranked, each ready to
  **Produce** as an MP4.
- **⬇ Export** — the arranged cut and every short render **in the browser** (ffmpeg.wasm) —
  no server render needed to ship.

Rendering is client-side by design, so **deploy needs no Docker**. The server ffmpeg
container (`container/`) is parked for a future big-file "pro render" path.

### API surface
`POST /api/projects` · `GET /api/projects[/:id]` · `POST /api/projects/:id/videos`
· `POST /api/videos/:id/transcribe` · `PUT /api/videos/:id/transcript`
· `POST /api/projects/:id/arrange` · `POST /api/projects/:id/shorts`
· `PUT /api/projects/:id/timeline` · `GET /api/media/*` (range-aware playback).

## Go live (needs your Cloudflare account)

```bash
npx wrangler login            # interactive — authenticates to your account
./scripts/setup.sh            # installs, creates R2 + D1, wires the db id, migrates, deploys
```

`setup.sh` prints your live URL: `https://aldershot.<your-subdomain>.workers.dev`.

Prefer to do it by hand? The equivalent steps:

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create aldershot-media
npx wrangler d1 create aldershot            # paste the returned id into wrangler.jsonc (replace "TODO")
npx wrangler d1 migrations apply aldershot --remote
npm run deploy                              # -> workers.dev URL
```

> Headless/CI deploy: set `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) instead of
> `wrangler login`. Local `wrangler dev` needs credentials too, because the Workers AI
> binding runs against the live account.

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
