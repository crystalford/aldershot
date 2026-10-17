# 17 · Storage, transcripts, and Neolog

16 October 2026. What "reading" stores, where footage can live, and how Aldershot connects to the founder's Neolog archive. Read with `03-DATA-MODEL.md` and `06-FOOTAGE-SYSTEM.md`.

## The principle

**The system needs the read, not the video.** The read is the word table (every word with a time and a speaker), the moments built from it (topic spans and utterances), the labels, the summaries and the index. It's a few megabytes per hour of footage, and it's what makes everything searchable and quotable. The video can stay where it already lives. Aldershot keeps small proxies (540p, 1 s keyframes) for editing, and reads the original only to render.

"Instant" has two parts:
- **Access**: instant once an account or bucket is connected. Nothing to upload.
- **Understanding**: as long as the read takes. Transcription runs faster than real time, but it's still minutes per hour. **If a transcript already exists, importing it is close to instant.** That covers your own YouTube captions, a subtitle file next to the video, a podcast transcript, or Neolog's word table.

## Every video is transcribed and searchable

- **On first read:** words with timings and speakers; moments at two sizes; labels; a **summary per source**; a **summary per thread**; one **summary for the whole archive**. Every sentence of every summary carries moment ids.
- **Searching:**
  - by exact words (keyword index over transcripts, on-screen text, labels and speaker names);
  - by meaning (embeddings over utterances);
  - both run independently and are fused by rank (`06`).
- **Reading broadly across many videos:**
  - Do *not* load every transcript into a model. Models find meaning (as opposed to exact words) much less reliably past about 32K tokens, roughly 2–3 hours of speech (`labs/SCOUT.md`).
  - The archive summary is small enough to send with every request, so the model always knows what's in the archive.
  - Search fetches the detail.
  - A small model scans the transcripts in short chunks for wide questions ("every time I…").
  - Quotes are string-matched against the stored words before they're shown. That's how a question across hundreds of hours gets an answer with receipts.

## In the product (built in `Aldershot One v4.dc.html`)

- **Footage → What's in your archive**: the archive summary, one paragraph.
- **Footage → search**: by meaning or exact words, across every transcript. Results are matching lines with the match highlighted, each marked *in this cut*, *left out*, *a moment*, or *transcript*.
- **Footage → Videos → a transcript**:
  - the source summary, then every line with its time and speaker;
  - moments are marked: inside a project, *in · go to it* or *out · keep it*; with no project, click to attach;
  - each speaker's name can be fixed once and the fix carries across every video;
  - a line that isn't a moment yet becomes one in the full build: split at the sentence, timed to the word.
- **Read status on every video**: *read · words + screen*. In the full build also *reading* (with progress), *not read*, and the read depth.
- **Ask your footage, in the conversation**: "where do I talk about money", "every time I mention Mum", "did I ever say…". The answer gives a count and up to three receipts (source, time, the line), with *Show them in Footage*. It works with or without a project.

The prototype's sample has three transcripts (`footage.js` → `TRANSCRIPTS`, `SUMMARIES`, `ARCHIVE_SUMMARY`, `READS`, `searchLines`). Meaning search there expands terms through a small synonym table as a stand-in for embeddings.

## Where footage can live, best first

1. **Your own bucket** (Cloudflare R2, S3, Backblaze, Wasabi). Read in place. Same Cloudflare account: a direct R2 binding, no keys, no egress. Another account: a read-only S3-compatible key. Aldershot never writes to it.
2. **Google Drive and Dropbox as watch folders.** OAuth plus change notifications, so a new file is read automatically. Large files are slow to fetch from both, so keep proxies.
3. **Your own YouTube and Vimeo** (read-only). Existing captions make the read close to instant.
4. **The desktop companion for local drives and a NAS.** It can transcribe on the user's machine and upload only the read and proxies. Originals never leave the disk. This is the private option.
5. Later: Frame.io, OneDrive, Box. iCloud has no usable API.

The footage-hour meter still applies to the first read, whether it's transcribed here or imported. With your own bucket, Aldershot stores only the read and proxies.

## Neolog — the founder's archive (read from `crystalford/neolog@main`, 16 Oct 2026)

**What's there:**
- R2 bucket `neolog-videos` (binding `VIDEOS`), plus D1 database `neolog`, both on Cloudflare.
- `vlogs` table, one row per video: `r2_key` (original), `transcoded_r2_key`, `thumbnail_r2_key`, `duration_seconds`, `recorded_at` (with `recorded_at_source`), `transcript_text`, `transcript_provider` (`workers_ai_whisper` or `manual`), `pipeline_status`, `is_podcast`, `deleted_at`.
- `transcript_words` table: `vlog_id`, `word`, `start_time`, `end_time`, `word_index`, `speaker`. **This is a word table already.**
- A workflow that scans for hallucinated transcript text, and a re-transcribe path in settings.

**How Aldershot imports it:**

| Neolog | Aldershot |
|---|---|
| `vlogs` row (not deleted, `pipeline_status = complete`) | `source` (`provenance: yours`, `read_state: read`, platform `neolog`) |
| `r2_key` | original (read in place, render only) |
| `transcoded_r2_key` | the proxy, if close to spec; otherwise make our own at import |
| `thumbnail_r2_key` | the source frame |
| `recorded_at` | the source date. Dated footage is what makes **Story** work ("the day on screen at each change") |
| `transcript_words` | the `word` table, word for word (`word_index` → `idx`) |
| `speaker` | `speaker` labels to confirm once and enrol |
| `is_podcast` | the source kind (audio) |

**What Aldershot still computes on import (cheap):**
- moments at two sizes;
- labels;
- the three summary layers;
- the embeddings and keyword index;
- OCR and shot boundaries, if the depth setting asks for them.

**Two caveats:**
- **Timing precision.** Neolog's word timings come from Whisper, roughly 110 ms. That's fine for search and quoting. Anything that has to hit a frame needs forced alignment (about 20 ms), run once per source over the existing words. No re-transcription.
- **Write access.** Bind both read-only by convention: Aldershot never writes to `neolog-videos` or the `neolog` database. If the two apps run on different Cloudflare accounts, use a read-only R2 key and an export of the two tables instead of a direct D1 binding.

**Build order:**
1. A read-only importer: list vlogs, map rows, copy words, mark sources read.
2. Proxies for any vlog without a usable transcoded file.
3. Moments, labels, summaries and the index.
4. Forced alignment, lazily, the first time a source is used in a cut.
5. A watch: new Neolog vlogs import automatically, using the `pipeline_status` change or an hourly sweep.
