/**
 * THE PODCAST ADAPTER. The one source with no permission problem at all.
 *
 * Spec 18 section 3.3: "RSS is public by design, so audio may be fetched and
 * transcribed (~$0.03/hr). About 6% of feeds ship a transcript." Both halves
 * are unusual in this pipeline — invariant 9 bites on every other platform,
 * and here the publisher has put a feed out specifically so software can read
 * it.
 *
 * AND WHEN A FEED SHIPS A TRANSCRIPT IT IS THE BEST FIND SCOUT CAN MAKE.
 * `<podcast:transcript type="text/vtt">` is a real transcript with real
 * timings, published by the people who made the audio, costing nothing to
 * read and needing no transcription and no mission. Two of the three feeds
 * tested had one. Those sources are `transcript: "native"` — the only
 * candidates in Scout that are.
 *
 * DISCOVERY IS SOMEBODY ELSE'S JOB, by evidence rather than by preference.
 * Apple's Search API would have given keyless free-text podcast search; it
 * answers datacentre IPs with a flat 403 from its own servers, which a Worker
 * will get too. So this adapter's query is a FEED URL, and finding feed URLs
 * is what the web-search adapter is for — which is also what spec 3.3 says
 * about YouTube, for the same structural reason.
 */

import type { AdapterName, Family, Quota, ScoutAdapter, SourceCandidate } from "./scout-adapters.ts";
import { attr, tags, text } from "./xml.ts";

/** No key, no cap, no units. A feed is a file somebody published. */
export const PODCAST_QUOTA: Quota = {
  daily: 0,
  scope: "none",
  perSearch: 0,
  perMetadata: 0,
  unit: "feed fetch",
};

/** A transcript we can actually read. VTT and SRT carry timings; HTML does not. */
export const READABLE_TRANSCRIPT = /^(text\/vtt|application\/x-subrip|text\/srt)$/i;

export interface Episode extends SourceCandidate {
  /** The published transcript, where there is one we can read. */
  transcriptUrl?: string;
  /**
   * The audio. Fetchable HERE and nowhere else in this codebase: the feed
   * exists to be read, which is not true of any other adapter's media.
   */
  audioUrl?: string;
}

/** `<itunes:duration>` is seconds, or `HH:MM:SS`, or `MM:SS`. */
export function durationSeconds(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

/**
 * The feed as episodes.
 *
 * Pure over a string so it can be tested against a feed off the wire rather
 * than a hand-written one — a hand-written fixture agrees with whatever the
 * reader happens to do.
 */
export function parseFeed(xml: string, feedUrl = ""): Episode[] {
  const show = text(xml, "title");
  const out: Episode[] = [];

  for (const item of tags(xml, "item")) {
    const e = item.inner;
    const title = text(e, "title");
    /* A GUID is the episode's own id; an enclosure URL is the fallback,
       because an item with neither cannot be referred to twice running. */
    const guid = text(e, "guid");
    const enclosure = tags(e, "enclosure")[0];
    const audioUrl = enclosure ? (attr(enclosure.raw, "url") ?? undefined) : undefined;
    const externalId = guid || audioUrl || "";
    if (!externalId || !title) continue;

    const transcript = tags(e, "podcast:transcript")
      .map((t) => ({ type: attr(t.raw, "type") ?? "", url: attr(t.raw, "url") ?? "" }))
      .find((t) => t.url && READABLE_TRANSCRIPT.test(t.type));

    const published = Date.parse(text(e, "pubDate"));
    const durationS = durationSeconds(text(e, "itunes:duration"));

    out.push({
      adapter: "podcast",
      externalId,
      /* The episode's own page where the feed gives one, the feed itself
         otherwise. Never the audio file — a link is something a person opens. */
      url: text(e, "link") || feedUrl || audioUrl || "",
      title,
      channel: text(xml, "itunes:author") || show || undefined,
      description: text(e, "description") || text(e, "itunes:summary") || undefined,
      publishedAt: Number.isFinite(published) ? published : undefined,
      durationS,
      kind: "podcast",
      /*
       * THE ONLY "native" IN SCOUT. A published VTT is a transcript we can
       * read today, for nothing. Without one the audio is fetchable and
       * transcribable at about three cents an hour, which is a cost decision
       * rather than a permission one — so `none` here means "not free", not
       * "not allowed", and the run decides.
       */
      transcript: transcript ? "native" : "none",
      ...(transcript ? { transcriptUrl: transcript.url } : {}),
      ...(audioUrl ? { audioUrl } : {}),
    });
  }

  return out;
}

export interface PodcastOptions {
  fetch?: typeof fetch;
}

/** A feed URL, which is the only query this adapter takes. */
export function feedUrlOf(query: string): string | null {
  const q = query.trim();
  if (!/^https?:\/\//i.test(q)) return null;
  try {
    return new URL(q).toString();
  } catch {
    return null;
  }
}

export function podcastAdapter(opts: PodcastOptions = {}): ScoutAdapter {
  const get = opts.fetch ?? fetch;
  const name: AdapterName = "podcast";

  return {
    name,
    quota: PODCAST_QUOTA,
    /*
     * NO `freeSearch`. One was here, returning true for everything, and it
     * could not change an outcome: `perSearch` is 0, so the ledger charges
     * nothing and the "already exhausted" branch only refuses calls that cost
     * something. A zero-cost adapter is free by its quota, and a second way
     * of saying so reads as a guarantee it is not providing.
     */

    async search(query: string, _family: Family): Promise<SourceCandidate[]> {
      const url = feedUrlOf(query);
      if (!url) {
        /*
         * Not a failure of the adapter. Apple's Search API would have given
         * keyless free-text podcast discovery and answers datacentre IPs with
         * a 403 from its own servers, so discovery belongs to web search and
         * this says so rather than returning nothing.
         */
        throw new Error(
          `podcast search takes a feed URL, not free text (${query}) — find feeds with the web-search adapter`,
        );
      }

      const res = await get(url);
      if (!res.ok) throw new Error(`feed ${url}: HTTP ${res.status}`);
      return parseFeed(await res.text(), url);
    },
  };
}
