/**
 * THE YOUTUBE ADAPTER, AND THE HALF OF IT THAT NEEDS NO KEY.
 *
 * Spec 18 section 3.3 says it plainly and it is easy to read past: "Discovery
 * goes through channel RSS (`feeds/videos.xml?channel_id=`, 0 units), WebSub
 * push, and the web-search adapter; `search.list` is spent only on what a
 * user typed."
 *
 * So most of this adapter is free, and free in two senses — no quota units
 * and NO API KEY. `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`
 * is a public Atom feed. It gives the last fifteen uploads with their ids,
 * titles, descriptions, publication dates, channel and view counts, which is
 * everything triage scores on except duration and chapters.
 *
 * That matters more than it sounds. A Data API key may not be obtainable, and
 * without this reading the spec gives the impression the whole adapter is
 * blocked on one. It is not: a run can find a channel through web search,
 * then follow its feed, and never touch the quota.
 *
 * WHAT A KEY WOULD ADD is `search.list` for free text — a hundred calls a day
 * per project — plus `videos.list` for duration and the thirty-day metadata
 * refresh the terms require. Those paths are declared here and refuse
 * honestly until there is a key, so the board says "no key" rather than
 * "found nothing".
 *
 * INVARIANT 9. The feed carries a `media:content` URL and a thumbnail. Both
 * are ignored: a SourceCandidate has an id, a link and metadata, and nowhere
 * a media byte could sit. Nothing here fetches either.
 */

import type { AdapterName, Family, Quota, ScoutAdapter, SourceCandidate } from "./scout-adapters.ts";
import { attr, tags, text } from "./xml.ts";

/** A channel id: "UC" and twenty-two more characters of base64url. */
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * YouTube's quota, as the spec states it.
 *
 * The unit is the `search.list` CALL rather than the API's own 100-unit cost,
 * because the cap that bites is "a hundred searches a day" and a ledger
 * counting 10,000 abstract units would need the conversion explained
 * everywhere it was read.
 */
export const YOUTUBE_QUOTA: Quota = {
  daily: 100,
  scope: "project",
  perSearch: 1,
  /* `videos.list` and `commentThreads.list` are 1 unit for up to 50 ids,
     which against a hundred-call budget is not worth counting. */
  perMetadata: 0,
  unit: "search.list",
};

export const FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=";

/** The one query shape that costs nothing: a channel's own feed. */
export function channelOf(query: string): string | null {
  const q = query.trim();
  const bare = q.replace(/^rss:/i, "").trim();
  return CHANNEL_ID.test(bare) ? bare : null;
}

/**
 * The channel feed, as candidates.
 *
 * Exported and pure over a string so it can be tested against a real captured
 * feed rather than a hand-written one. A hand-written fixture agrees with
 * whatever the reader happens to do; the feed from the wire does not.
 */
export function parseChannelFeed(xml: string): SourceCandidate[] {
  const feedChannel = text(xml, "title");
  const out: SourceCandidate[] = [];

  for (const entry of tags(xml, "entry")) {
    const e = entry.inner;
    const externalId = text(e, "yt:videoId");
    if (!externalId) continue;

    const link = tags(e, "link").map((t) => attr(t.raw, "href")).find(Boolean);
    const published = Date.parse(text(e, "published"));
    const views = tags(e, "media:statistics").map((t) => attr(t.raw, "views")).find(Boolean);

    /* The feed repeats the channel title as the entry's author. Both are
       read, because a feed truncated mid-document can have one and not the
       other, and a candidate with no channel loses its critic-channel signal
       in triage. */
    const author = tags(e, "author")[0]?.inner ?? "";

    out.push({
      adapter: "youtube",
      externalId,
      /* The watch link, built rather than trusted: the feed's own <link> is
         the one a person opens, and an entry without one is still a video. */
      url: link ?? `https://www.youtube.com/watch?v=${externalId}`,
      title: text(e, "media:title") || text(e, "title"),
      channel: text(author, "name") || feedChannel || undefined,
      description: text(e, "media:description") || undefined,
      publishedAt: Number.isFinite(published) ? published : undefined,
      views: views ? Number(views) : undefined,
      kind: "vod",
      /*
       * READABLE, NOT PRESENT. YouTube has captions on nearly everything and
       * `captions.download` requires owning the channel, so a perfectly
       * subtitled VOD is `none` here. The honest things to do with it are a
       * mission and its crowd signals.
       */
      transcript: "none",
    });
  }

  return out;
}

/** How long a stored YouTube metadata row may be trusted. Their terms, not ours. */
export const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface YouTubeOptions {
  /** Injected so the adapter can be driven without the network. */
  fetch?: typeof fetch;
  /** Present only when somebody has a Data API key. */
  apiKey?: string;
}

/**
 * The adapter.
 *
 * One adapter with two paths and one quota, which is the shape the spec
 * describes. The free path is what exists today; the paid path declares
 * itself and refuses with a sentence, so a board reading "no YouTube Data API
 * key" is telling the truth and a board reading "found nothing" would not be.
 */
export function youtubeAdapter(opts: YouTubeOptions = {}): ScoutAdapter {
  const get = opts.fetch ?? fetch;
  const name: AdapterName = "youtube";

  return {
    name,
    quota: YOUTUBE_QUOTA,

    freeSearch(query: string): boolean {
      return channelOf(query) !== null;
    },

    async search(query: string, _family: Family): Promise<SourceCandidate[]> {
      const channel = channelOf(query);
      if (!channel) {
        /* Not a refusal the quota ledger knows about: the budget is intact
           and there is simply no key. Recorded as a failed row with this
           sentence on it. */
        throw new Error(
          opts.apiKey
            ? `search.list is not implemented yet (query: ${query})`
            : "no YouTube Data API key, so free-text search is unavailable; channel feeds still work",
        );
      }

      const res = await get(FEED + encodeURIComponent(channel));
      if (!res.ok) {
        /* 404 is a channel that does not exist or has been removed, which is
           a fact about the channel rather than a failure of ours. */
        throw new Error(`channel feed ${channel}: HTTP ${res.status}`);
      }
      return parseChannelFeed(await res.text());
    },
  };
}
