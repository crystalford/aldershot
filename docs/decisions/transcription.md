# Transcription: measured, not assumed

Cloudflare's documentation would have led us to build something far more
complicated than necessary. These numbers come from running real audio through
the real Workers AI endpoint, not from the docs.

## What the docs say, and why it is misleading

Cloudflare's own [Whisper chunking tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/)
says to split audio into **~1 MB chunks** to "overcome memory and execution
time limitations". Taken at face value, a 90-minute video means 20+ calls, each
returning timestamps that restart at zero, so every one needs a running
byte→time offset applied — and byte-slicing compressed audio splits mid-frame
and mid-word. That is a lot of fragile machinery.

**None of it is necessary.** Measured, 2026-08:

| Audio | Size | Result | `duration` | Last segment ends | Neurons |
|---|---|---|---|---|---|
| 15 min | 3.6 MB | 30 segments | 900 s | 872.9 s | 699 |
| 45 min | 10.8 MB | 97 segments | 2,700 s | 2,684.2 s | 2,098 |
| 90 min | 21.6 MB | 194 segments | 5,400 s | 5,391.5 s | 4,197 |
| **180 min** | **43.2 MB** | **392 segments** | **10,800 s** | **10,797.8 s** | **8,393** |

A three-hour file transcribes **completely, in a single call**, with word-level
timestamps that are correct all the way to the end. `duration` matches the real
length and the final segment lands within seconds of it, so nothing is being
silently truncated — the thing that would have been easy to miss.

180 minutes is the top of the product's stated source range (01-PRODUCT.md), so
**no chunking is needed for any supported input.** Chunking, offset arithmetic,
and the correctness risk that comes with them are all removed from Phase 1.

## The undocumented part: `audio` must be a base64 string

The model's published input schema says `audio` accepts `array` or `binary`.
Both are rejected at runtime:

```
audio: [...new Uint8Array(buf)]   → 5006: Type mismatch of '/audio', 'string' not in 'array','binary'
audio: new Uint8Array(buf)        → 5006: Type mismatch of '/audio', 'string' not in 'object'
audio: btoa(...)                  → works
```

The error text is confusing (it reports the *expected* types oddly), but the
answer is unambiguous: **pass base64**. Note base64 inflates payloads by 4/3, so
43 MB of audio becomes ~58 MB in the request and still succeeds.

## Word-level timestamps are real

Confirmed on live output, not just in the schema:

```json
"segments": [{ "start": 0, "end": 5.16, "text": "…",
               "words": [ {"word": " Thank", "start": 0,    "end": 0.38},
                          {"word": " you.",  "start": 0.38, "end": 5.16} ] }]
```

This is what Script mode depends on — deleting a word deletes video — so it
being native and free is the difference between that feature being easy and
being a research project.

## Metering comes free and exact

Every response carries `usage.neurons`. Measured values match the catalog rate
of 46.63 neurons/audio-minute exactly (90 min → 4,196.72). So `usage_events`
records **what was actually billed**, not an estimate:

| Source | Neurons | Cost |
|---|---|---|
| 60 min | 2,798 | **$0.031** |
| 90 min | 4,197 | $0.046 |
| 180 min | 8,393 | $0.092 |

The design's cost model (05-INFRA-AND-COSTS.md) budgeted **$0.50** for
transcribing 60 minutes. The real figure is **$0.031 — about 16x cheaper.**
That is worth revisiting before pricing is set, since transcription was
budgeted as the second-largest line item per finished video.

## Whisper also accepts video directly

An MP4 with its video track intact transcribes fine — no audio extraction
needed for the *format* to be acceptable.

Extraction still matters for **size**: a 90-minute MP4 is gigabytes, versus
21 MB as 32 kbps mono MP3. So the pipeline still extracts audio first, but the
reason is bandwidth, not compatibility — and a small upload can skip the step
entirely and go straight to Whisper.

## What this means for the build

- **No chunking.** One call per source, up to at least 180 minutes.
- **No container for transcription.** The container is still needed for probe,
  frames, and extracting compact audio from a large upload — but not for
  Whisper itself, and not for timestamp stitching.
- **Small uploads skip extraction**, which makes the whole path testable
  without a container running.
- **Diarization remains the only reason to reach for Nova-3** (see
  `models.md`), and it stays an opt-in upgrade.

## The cost of not chunking: no intra-call progress

One tradeoff worth stating. Because a source is transcribed in a single atomic
call, there is no progress to report *during* it — the job sits at "reading it"
for however long the model takes, then jumps to done.

The design requires "honest staged progress and a human label. Never a spinner
with no stage." A stage label with no moving percentage satisfies that; a bar
animating on a timer would not, and would be worse than nothing because it
teaches the user the bar is fiction.

So: during transcription the UI shows the stage and no percentage. If real
sub-progress is ever wanted, chunking would buy it back — but at the cost of
the timestamp correctness this decision was made to protect. Not worth it.
