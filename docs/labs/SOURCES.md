# Sources — the master integrations list, by tier

7 Oct 2026, from pass 12 (with the YouTube quota question folded in). Confidence is marked per row in the source pass: **confirmed** (official docs read that day), **likely** (reputable secondary), **unverified** (carried or general knowledge — check before building). Nothing here is built. These are *practical notes, not legal advice*; fair dealing / fair use judgments for a published video rest with the user.

## The one-line version

**Only three kinds of source let an end user legally download footage and reuse it in a published video:** licensed stock APIs (Epidemic Sound for music and SFX; Shutterstock and Storyblocks at enterprise prices), the free stock APIs that still issue keys (Pixabay; Pexels only if you already hold a key — new keys are paused), and public-domain archives (NASA, US House and Senate floor video, Internet Archive and Prelinger items checked one by one). **No major streaming or social platform is a dependable open Scout destination**; PeerTube is the only one built to serve files, and it is small and licensed per video. Everything else is link-and-embed, the user's own connected account, or the user's own capture.

## The tiers

1. **Full API, download allowed** — direct integrations, not Scout. Stock and licensed libraries.
2. **Official API, search and metadata only** — Scout finds, links and embeds. Quotas matter.
3. **Downloadable by design, no formal API** — Scout can fetch, but each connector is built by hand and filtered by licence.
4. **Owner-connected** — the user links their own account; Aldershot pulls their own content officially.
5. **User-side only** — platforms that block servers or forbid the route; the user captures their own lawful use with the Scout app or extension.

## What to build, in order

**v1 — confirmed rights, high value**
- **Pixabay API** (images + video): free; 100 requests/min per key; responses cached 24 h; no mass downloads; copy assets to R2 (hotlinking is temporary only). No attribution required.
- **Epidemic Sound Partner API** (55k+ tracks, 250k SFX): end users need no account; safelisted content is "licensed globally, forever". Pricing by agreement. **Apply now — partner onboarding has lead time.**
- **NASA Image & Video Library** (`images-api.nasa.gov`): images, video, audio, captions; generally not copyrighted; credit NASA, no endorsement, no insignia, identifiable people need permission for commercial use.
- **Internet Archive / Prelinger connector filtered to PD, CC0 and CC-BY items.** Do not assume everything is public domain — the per-item licence governs; most IA items are effectively non-commercial.
- **Podcast RSS enclosures + `<podcast:transcript>`**: open by design; publisher keeps copyright, so quote short excerpts with source.
- **GDELT TV 2.0 API**: keyless caption search over US TV news in 15-second blocks, clip links and thumbnails — Scout's TV-news transcript backbone, *link and quote only* (broadcasters own the footage). Live status in 2026 is likely, not tested — call the clipgallery endpoint before committing.
- **YouTube Data API in metadata-and-embed mode** (strategy below).
- **Twitch OAuth (tier 4)** for streamer users' own clips via Get Clips Download / Create Clip From VOD.
- **Pexels** only if a key is already held (200/hr, 20k/month; link back and credit the contributor).

**v2** — Unsplash (stills; 5,000 req/hr after approval; credit photographer + Unsplash) · Wikimedia Commons, Smithsonian Open Access, Library of Congress / NARA, Europeana — all CC0/PD-filtered · PeerTube connector filtered to CC licences · Freesound after a commercial licence (the free API is non-commercial only; use CC0/CC-BY, exclude NC) · US House/Senate floor video · Brave Search API for cross-web discovery · the Scout browser extension (tier 5).

**v3** — Shutterstock / Storyblocks / Getty / Adobe Stock premium tiers with pass-through pricing (Shutterstock's free test tier has zero videos; minimum commitments reportedly ~$40k and ~$24k a year) · Jamendo licensing (free API is non-commercial) · municipal meeting connectors (Granicus, Swagit) · the Scout desktop companion · licensed news (AP, Reuters, British Pathé).

## YouTube at SaaS scale — the real bottleneck

- **The quota model changed on 1 June 2026.** A default project gets **100 `search.list` calls a day in its own bucket** (1 unit each), 100 `videos.insert`, and **10,000 units a day for everything else**. `videos.list`, `channels.list`, `playlistItems.list`, `commentThreads.list` cost 1 unit; `videos.list` takes 50 ids per call. Every request, even an invalid one, costs at least 1; extra pages cost again. *(Confirmed, Quota Calculator 2026-09-15.)*
- **Quota is per project, not per user.** Users signing in with their own accounts adds nothing; OAuth only matters for reading *their own* channel (tier 4). Opening extra projects is the wrong path — more quota means passing the compliance audit.
- **Downloading and caching audiovisual content stays prohibited** ("without YouTube's prior written approval"); non-authorised data may be stored for **30 days** at most, so the library stores the id plus our own notes and quote and refreshes metadata every 30 days. `captions.download` no longer appears in the cost table and needs edit rights anyway — **no compliant server-side route to third-party captions exists.**
- **Strategy — keep `search.list` for user-triggered, de-duplicated queries only:**
  1. Never search for known ids or channels: parse the id from the URL (0 units) → `videos.list` in batches of 50 (1 unit).
  2. **Channel uploads via RSS** (`youtube.com/feeds/videos.xml?channel_id=…`, 0 units) plus `playlistItems.list` on the uploads playlist (1 unit per 50).
  3. **WebSub / PubSubHubbub push** (0 units): subscribe at Google's hub; notifications fire on upload and title/description changes; run the callback as a Worker.
  4. **Web search for open-ended discovery**: Brave Search API at $5 per 1,000 requests ($5 free monthly with attribution), Videos endpoint, 50 qps. 10,000 Scout discovery queries a day ≈ $50/day — against a hard ceiling of 100 on `search.list`. Check Brave's terms on storing results.
  5. Apply for the **quota audit** only after 30 days of real usage data. Approval odds are best for an app that displays and embeds with attribution, never downloads, honours the 30-day refresh, and has a public privacy policy and ToS. A link-and-embed Scout fits; **any server-side download fails the audit, and so would a Scout app marketed as a downloader.**
- Third-party transcript services (Filmot and the like) scrape; use for discovery links at most, never as a content source.

## Is any streaming platform an open Scout destination?

**No.** Twitch clip downloads need the broadcaster's or an editor's authorisation (no plans to add unauthenticated file URLs). **Kick's public API has no clips endpoint** (open feature request, Sep 2026). Rumble has no general public API; Floatplane and Nebula are paywalled; Odysee may be technically fetchable but creator copyright applies. **PeerTube** is the exception by design — its API returns download URLs, and each video carries `downloadEnabled` and a licence field — but the catalogue is small, spread across instances that can vanish, and licensed per video: a niche tier-3 connector, not a destination. **Scout's prime destinations are rights-clear archives (NASA, PD-marked IA/Prelinger, Wikimedia/Smithsonian CC0) plus transcript-searchable link sources (GDELT TV, podcasts, YouTube metadata). Copyrighted platform footage goes through tier 4 or tier 5, under the user's own responsibility.**

## Corrections to earlier passes

- **C-SPAN** is stricter than we had it: *no unlicensed commercial use of any programming, attributed or not* — the exception is House and Senate floor proceedings, which are public domain (excluding joint sessions, the State of the Union and Speaker elections). An API key confers no reuse rights.
- **Freesound and Jamendo** free APIs are non-commercial only; a SaaS needs a negotiated licence from each.
- **X** is pay-per-use for new developers since Feb 2026 ($0.005 per post read; its own docs disagree on the monthly cap, 2M vs 3M) and grants no media reuse.
- **Pexels** has paused new keys and limit increases.
- **Canadian legislative footage** (House of Commons ParlVU, CPAC) is non-commercial without written permission; Library and Archives Canada is free for non-commercial reuse, commercial per item.
- **Giphy / Tenor** API terms are display-oriented; embedding GIFs in rendered commercial video is not clearly permitted — avoid for output.

## One-line terms per platform

YouTube — search, display, embed only; refresh stored data every 30 days · Twitch — clip files only with broadcaster/editor authorisation · Kick — no clips API · PeerTube — download where enabled, reuse under the stated licence · Vimeo / Dailymotion — only the connected owner's own videos · TikTok / Instagram / Facebook — the user's own media only · X — paid per call, no reuse · Reddit — commercial use needs a contract · Bluesky / Mastodon — open protocols, posters keep copyright; quote and link · Pixabay — free commercial, cache 24 h, no mass downloads · Pexels — free commercial with attribution; new keys paused · Unsplash — free commercial; credit · Shutterstock API — assets usable only inside projects made in your app · Epidemic Sound — covers end users' published videos globally, in perpetuity once safelisted · Freesound / Jamendo — non-commercial until licensed · NASA — credit, no endorsement, no insignia · IA / Prelinger — per item; PD/CC0/CC-BY only · IA TV News / GDELT — research, quote and link · C-SPAN — no unlicensed commercial use; floor proceedings PD · House of Commons / CPAC — non-commercial without permission · LAC — free non-commercial · Podcasts — enclosures and transcripts fetchable by design; publishers keep copyright.

## What this changes in Aldershot

- **Stock is a direct integration, not Scout.** Pixabay, NASA and PD archives are the free visual-supply layer under `PICTURES.md`'s source order (own → documents → open world → generated); Epidemic Sound is the music bed. Every stored asset carries licence, source URL and attribution string next to its file. *The Scout screen's Sources tab now says which sources are open by design and which are missions.*
- **Scout's YouTube layer is discovery, never fetch**: RSS/WebSub and web search find, `videos.list` enriches, `search.list` is spent only on what a user typed. **The Scout app and extension are positioned as capture tools for the user's own lawful use — never as downloaders** — to protect both the store listing and the audit.
- **Transcript backbone**: GDELT TV and podcast transcripts are the only large, legitimately searchable transcript sources found — so Scout's "read" column is mostly news and podcasts; streamers are metadata, crowd signals and the user's own captures. *(Already how the labs screen behaves.)*
- **Settings → Connected services** grows the owner-connected tier: your YouTube, your Twitch (clips of your own channel), your Vimeo — each read-only and scoped to your own content.
- **For the handoff**: the tier table, the v1/v2/v3 connector list, the YouTube discovery strategy, the 30-day refresh rule, and "apply to Epidemic Sound this week".

## Sources

Official docs read in the pass (Oct 2026): Google YouTube Data API Quota Calculator (2026-09-15), Developer Policies (III.E.4 storage, download prohibition), push-notifications guide; Pixabay API docs; Pexels API page and help centre (Oct 5–7, 2026); Unsplash documentation; Shutterstock API pricing and contributor terms; Storyblocks developer docs; Epidemic Sound developers pages and partner release (May 5, 2026); Freesound and Jamendo API terms; NASA brand centre (2026-08-13) and image API docs; Internet Archive rights help and Prelinger FAQ (May 27, 2026); GDELT TV 2.0 docs; C-SPAN copyright and licensing (Oct 8, 2026); House of Commons important notices; CPAC terms; Library and Archives Canada terms; Twitch API reference and forum announcements; KickDevDocs issue #424 (Sep 27, 2026); PeerTube API docs; X API pricing and post-cap pages; Brave Search API announcement (Feb 12, 2026). Secondary: Plainly Videos (stock minimums), postzen.dev (quota revision history), PyPI C-SPAN client and Purdue guide.
