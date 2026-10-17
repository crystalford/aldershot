# 04 — API and jobs

## Principles

1. **Every long operation is a job row** the UI can poll and show honest progress for, with a human stage label ("reading it for meaning", "burning captions").
2. **The edit is data, never a file.** Beats + struck words are the edit. Render is a pure function of them, so it can always be re-run.
3. **Nothing blocks on the LLM.** Transcribe → score → pass are separate jobs; the UI is usable after transcribe.

## HTTP surface (Workers, `/api`)

```
POST   /api/sources                 { origin, filename|url } -> { source, upload_url }   # R2 multipart
GET    /api/sources                 -> [source]
GET    /api/sources/:id             -> { source, segments, clips }
POST   /api/sources/:id/retry       # re-run a failed transcribe, keeps the user's brief

POST   /api/intent                  { text } -> { kind, confidence, explain }
POST   /api/projects                { brief, source_id?, kind? } -> { project, jobs[] }
GET    /api/projects                -> [project]  # includes pct, next_action, composition
GET    /api/projects/:id            -> { project, beats, passes, renders }
PATCH  /api/projects/:id            { title?, archived? }
POST   /api/projects/:id/branch     -> { project }              # "shorter version"

PUT    /api/projects/:id/beats      { beats:[...] }             # whole-array write, idempotent
POST   /api/projects/:id/beats      { at_idx, kind, clip_id?, text? } -> { beat }
DELETE /api/projects/:id/beats/:bid                              # -> trash, undoable
POST   /api/projects/:id/passes     { instruction } -> { job }   # an extra LLM pass
POST   /api/projects/:id/queue      { instruction } -> { job }   # overnight queue

POST   /api/beats/:bid/record       -> { upload_url }            # user's take
POST   /api/beats/:bid/tts          { voice_id } -> { job }      # ElevenLabs, user key

POST   /api/clips/:id/keep          { kept }                     # undoable
GET    /api/clips?thread=&q=&mode=meaning|exact
POST   /api/ask                     { q } -> { answer, clips[] }  # library Q&A
GET    /api/threads                 -> [thread]

POST   /api/shorts                  { source_id|project_id, aspect, caption_style, count, len } -> { job }
POST   /api/shorts/ask              { source_id, q } -> { clips[] }   # transcript search, not scoring
POST   /api/renders                 { project_id, format, aspect } -> { job }
GET    /api/jobs?ids=               -> [job]                     # UI polls this
GET    /api/usage/month             -> { total, per_video, projection, lines[] }   # owner only
```

## Job pipeline (Cloudflare Queues, one consumer per type)

```
upload ──▶ probe (ffprobe: duration, dims, poster)
       ──▶ frames      : one JPEG every 5s to R2 (thumbnails are never generated art)
       ──▶ transcribe  : Whisper large-v3 in a Container, word timestamps + diarization
       ──▶ embed       : one vector per segment window -> Vectorize
       ──▶ score       : LLM pass #1 over the transcript, using the user's brief
       ──▶ thread      : assign clips to threads, create new threads when nothing fits
(user) ──▶ pass        : LLM pass #N, an extra instruction against existing clips/beats
(user) ──▶ render      : ffmpeg concat of beats -> R2 + Stream
(user) ──▶ shorts      : reframe to aspect + burn captions -> R2 + Stream
(user) ──▶ tts         : ElevenLabs with the user's key -> beat media
```

Every consumer writes a `usage_events` row on completion. No exceptions — a job that does not meter is a bug.

## The LLM calls

Model: **Claude Sonnet** for scoring/passes/intent (cheap, fast, good at transcript reasoning); **Claude Opus** only when the user asks for an essay outline. Transcription is Whisper, not an LLM.

### 1. Intent (`readIntent`)
The prototype does this with regexes and it works well enough to ship as a **fast path**; fall back to a one-line LLM call when no pattern matches.

```
essay      /essay|documentary|argument about|video about/
shorts     /shorts?|tiktok|reels?|vertical|9:16/
tighten    /tighten|tidy|clean ?up|polish|remove the ums?|dead air/
compose    /cut|supercut|trim|montage|assemble|version|down to/
extract    /clips?|grab|pull|isolate|find|get me|get the/
react      /react|reaction|respond to|commentary/
```

### 2. Score pass
Input: the full transcript with timecodes, plus the user's sentence. Output strict JSON:

```json
{"clips":[{"start_ms":0,"end_ms":0,"quote":"","why":"","score":0,"heat":0}]}
```

`why` must be a short human reason shown verbatim in the UI ("Awkward closer — good button"). `heat` 0–2 drives the density bar. Chunk long transcripts at ~12k tokens with 1-minute overlap and merge.

### 3. Extra pass
Input: existing clips/beats + the new instruction. Output: which clips to add, drop, or reorder, plus a one-sentence `result` for the Passes log ("reaction blocks drafted", "no matches — try different words"). **A pass that finds nothing must say so honestly** — never silently succeed.

### 4. Reaction placement
Input: transcript + "react to X". Output beats alternating `clip` and `react`, where each `react` beat carries a drafted script line the user can read aloud or ignore.

### 5. Essay outline
Input: a topic plus the user's threads and clips. Output acts, each with a claim, the clips that support it, and the voiceover lines needed between them. Beats with no matching clip are marked `generated` or `stock` for the user to fill.

## Failure rules

- Transcribe fails → the source shows a retry that **keeps the user's brief**; do not make them retype.
- LLM returns invalid JSON → one repair retry, then fail the job with a plain-language error.
- Render fails → project keeps its beats, the render row records `error`, UI offers Retry.
- Any job over its per-plan minute cap → refuse **before** spending, with the cap stated.
