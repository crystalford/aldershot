/**
 * THE PODCAST ADAPTER. The one source with no permission problem at all.
 *
 * Spec 3.3: "RSS is public by design, so audio may be fetched and
 * transcribed. About 6% of feeds ship a transcript." Both halves are unusual
 * in this pipeline — invariant 9 bites on every other platform, and here the
 * publisher put a feed out specifically so software could read it.
 *
 * The fixture is a real feed. Two of its three items ship a VTT transcript,
 * which is the best find Scout can make: real timings, published by the
 * people who made the audio, free to read and needing no mission.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaLedger, runSearches, type QuotaStore } from "../src/scout-adapters.ts";
import {
  PODCAST_QUOTA,
  READABLE_TRANSCRIPT,
  durationSeconds,
  feedUrlOf,
  parseFeed,
  podcastAdapter,
} from "../src/scout-podcast.ts";

const FEED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/podcast-feed.xml"), "utf8");
const FEED_URL = "https://feeds.megaphone.fm/darknetdiaries";

function memoryStore(): QuotaStore {
  const rows = new Map<string, number>();
  return {
    async spent(a, d) {
      return rows.get(a + d) ?? 0;
    },
    async add(a, d, u) {
      rows.set(a + d, (rows.get(a + d) ?? 0) + u);
    },
  };
}

const ok = (body: string) => ({ ok: true, status: 200, async text() { return body; } }) as unknown as Response;

/* ── The real feed ──────────────────────────────────────────────────────── */

test("ACCEPTANCE: a published VTT transcript is the only `native` in Scout", () => {
  /*
   * Every other adapter's candidates are `transcript: "none"` — YouTube has
   * captions and will not give them to us, Twitch has no API for chat or
   * captions at all. A podcast feed that ships a VTT is a transcript we can
   * read today, for nothing. Marking it `none` would send the run to
   * transcribe audio it already has the words for.
   */
  const got = parseFeed(FEED, FEED_URL);
  assert.equal(got.length, 3);

  const withTranscript = got.filter((e) => e.transcript === "native");
  assert.equal(withTranscript.length, 2);
  for (const e of withTranscript) {
    assert.match(e.transcriptUrl!, /^https:\/\/.*\.vtt$/);
  }
  /* And the third says none, which here means "not free" rather than "not
     allowed" — the audio is fetchable and the run decides. */
  const without = got.find((e) => e.transcript === "none")!;
  assert.equal(without.transcriptUrl, undefined);
  assert.ok(without.audioUrl, "but its audio is there to transcribe if the run wants it");
});

test("ACCEPTANCE: the real feed gives everything triage scores on, duration included", () => {
  /*
   * Better than the YouTube feed, which has no duration. itunes:duration is
   * in every well-formed feed, so durationFit scores these properly instead
   * of falling back to neither-good-nor-bad.
   */
  for (const e of parseFeed(FEED, FEED_URL)) {
    assert.equal(e.adapter, "podcast");
    assert.ok(e.externalId, "an item with no id");
    assert.ok(e.title.length > 5, e.title);
    assert.ok((e.description ?? "").length > 20, `${e.title} has no description`);
    assert.ok(e.channel, `${e.title} has no show`);
    assert.ok(Number.isFinite(e.publishedAt), `${e.title} has no date`);
    assert.ok((e.durationS ?? 0) > 60, `${e.title} is ${e.durationS}s`);
    assert.equal(e.kind, "podcast");
    assert.match(e.url, /^https?:\/\//);
  }
  /* Three distinct episodes, not one three times. */
  assert.equal(new Set(parseFeed(FEED, FEED_URL).map((e) => e.externalId)).size, 3);
});

test("the url a person opens is never the audio file", () => {
  /*
   * A link is something somebody clicks and reads. Handing out the enclosure
   * URL would make "open the source" start a download, and on the board it
   * would be a media URL where a citation goes.
   */
  for (const e of parseFeed(FEED, FEED_URL)) {
    assert.notEqual(e.url, e.audioUrl);
    assert.ok(!/\.mp3(\?|$)/.test(e.url), e.url);
  }
});

test("an HTML transcript is not a readable one", () => {
  /*
   * `<podcast:transcript type="text/html">` is a web page. It has the words
   * and no timings, and invariant 2 needs timings that derive from word ids —
   * so it is not a transcript for this purpose, and claiming it was would
   * send the scan pass somewhere with nothing to address.
   */
  assert.ok(READABLE_TRANSCRIPT.test("text/vtt"));
  assert.ok(READABLE_TRANSCRIPT.test("application/x-subrip"));
  assert.ok(!READABLE_TRANSCRIPT.test("text/html"));
  assert.ok(!READABLE_TRANSCRIPT.test("application/json"));

  const xml = `<rss><channel><title>A show</title><item>
    <title>An episode</title><guid>abc</guid>
    <podcast:transcript type="text/html" url="https://example.test/t"/>
  </item></channel></rss>`;
  const [e] = parseFeed(xml);
  assert.equal(e.transcript, "none");
  assert.equal(e.transcriptUrl, undefined);
});

test("a VTT is preferred when a feed offers several formats", () => {
  /* Feeds commonly ship html, srt and vtt side by side. Picking the first
     would pick the web page. */
  const xml = `<rss><channel><title>A show</title><item>
    <title>An episode</title><guid>abc</guid>
    <podcast:transcript type="text/html" url="https://example.test/t.html"/>
    <podcast:transcript type="text/vtt" url="https://example.test/t.vtt"/>
  </item></channel></rss>`;
  assert.equal(parseFeed(xml)[0].transcriptUrl, "https://example.test/t.vtt");
});

test("an item with no id or no title is not an episode", () => {
  /* Without an id nothing can refer to it twice running, and the enclosure
     URL is the fallback because it is the one thing every item has. */
  const xml = `<rss><channel><title>A show</title>
    <item><title>no id anywhere</title></item>
    <item><guid>g1</guid></item>
    <item><title>by enclosure</title><enclosure url="https://example.test/a.mp3"/></item>
    <item><title>proper</title><guid>g2</guid></item>
  </channel></rss>`;
  const got = parseFeed(xml);
  assert.deepEqual(got.map((e) => e.title), ["by enclosure", "proper"]);
  assert.equal(got[0].externalId, "https://example.test/a.mp3");
});

test("a CDATA description survives, which is why it is in CDATA", () => {
  const xml = `<rss><channel><title>A show</title><item>
    <title>An episode</title><guid>abc</guid>
    <description><![CDATA[<p>Read more at </description> no really</p>]]></description>
  </item></channel></rss>`;
  assert.match(parseFeed(xml)[0].description!, /no really/);
});

test("itunes:duration in each of its three shapes", () => {
  /* Seconds, MM:SS and HH:MM:SS are all in the wild, and a duration read
     wrong by sixty puts a two-hour episode in the short-interview band. */
  assert.equal(durationSeconds("3600"), 3600);
  assert.equal(durationSeconds("45:30"), 2730);
  assert.equal(durationSeconds("01:15:30"), 4530);
  assert.equal(durationSeconds(""), undefined);
  assert.equal(durationSeconds("about an hour"), undefined);
  /* And prose WITH a colon in it, which is the case that reaches the arithmetic
     — "about an hour" never gets past the split and proves nothing. */
  assert.equal(durationSeconds("45:ab"), undefined);
  assert.equal(durationSeconds("about:an hour"), undefined);
});

test("the show name falls back to the channel title", () => {
  /* Plenty of feeds have no itunes:author. A candidate with no channel loses
     its critic-channel signal in triage, and the show title is right there. */
  const xml = `<rss><channel><title>A Show Without An Author</title><item>
    <title>An episode</title><guid>abc</guid>
  </item></channel></rss>`;
  assert.equal(parseFeed(xml)[0].channel, "A Show Without An Author");
});

/* ── The adapter ────────────────────────────────────────────────────────── */

test("a feed fetch is free: no key, no cap, no units", () => {
  assert.deepEqual(PODCAST_QUOTA, {
    daily: 0,
    scope: "none",
    perSearch: 0,
    perMetadata: 0,
    unit: "feed fetch",
  });
});

test("a feed URL is a query; free text is not", () => {
  assert.equal(feedUrlOf("https://feeds.megaphone.fm/darknetdiaries"), FEED_URL);
  assert.equal(feedUrlOf("  http://example.test/rss  "), "http://example.test/rss");
  assert.equal(feedUrlOf("darknet diaries conti leak"), null);
  assert.equal(feedUrlOf(""), null);
  /* Not a scheme we fetch. */
  assert.equal(feedUrlOf("ftp://example.test/rss"), null);
  assert.equal(feedUrlOf("javascript:alert(1)"), null);
});

test("ACCEPTANCE: free text refuses with the sentence that says where to look", async () => {
  /*
   * Apple's Search API would have given keyless free-text podcast discovery
   * and answers datacentre IPs with a flat 403 from its own servers, which a
   * Worker will get too. So discovery belongs to web search, and the refusal
   * says so — otherwise the next person reads "podcast search is broken".
   */
  const ledger = new QuotaLedger(memoryStore());
  const adapters = new Map([["podcast", podcastAdapter({ fetch: (async () => ok(FEED)) as never })]]);
  const out = await runSearches(
    [{ adapter: "podcast", beatId: "B1", family: "direct", query: "darknet diaries conti" }],
    adapters as never,
    ledger,
  );
  assert.equal(out.rows[0].outcome, "failed");
  assert.match(out.rows[0].failReason!, /takes a feed URL, not free text/);
  assert.match(out.rows[0].failReason!, /web-search adapter/);
  assert.equal(out.rows[0].quotaUnits, 0, "and it cost nothing, because nothing here costs anything");
});

test("a feed URL goes through and costs nothing", async () => {
  const ledger = new QuotaLedger(memoryStore());
  const asked: string[] = [];
  const adapters = new Map([
    [
      "podcast",
      podcastAdapter({
        fetch: (async (u: string) => {
          asked.push(String(u));
          return ok(FEED);
        }) as never,
      }),
    ],
  ]);
  const out = await runSearches(
    [{ adapter: "podcast", beatId: "B1", family: "seed", query: FEED_URL }],
    adapters as never,
    ledger,
  );
  assert.equal(out.rows[0].outcome, "ok");
  assert.equal(out.rows[0].resultsN, 3);
  assert.equal(out.rows[0].quotaUnits, 0);
  assert.deepEqual(asked, [FEED_URL]);
  assert.equal(out.candidates.filter((c) => c.transcript === "native").length, 2);
});

test("a feed that is gone is a fact about the feed", async () => {
  const a = podcastAdapter({
    fetch: (async () => ({ ok: false, status: 410, async text() { return ""; } })) as never,
  });
  await assert.rejects(() => a.search(FEED_URL, "seed"), /HTTP 410/);
});

test("a feed of prose instead of XML is no episodes, not a throw", async () => {
  /* A feed URL that now serves a holding page. One dead feed must not cost
     the round. */
  const a = podcastAdapter({ fetch: (async () => ok("<html><body>This feed has moved.</body></html>")) as never });
  assert.deepEqual(await a.search(FEED_URL, "seed"), []);
});
