/**
 * THE YOUTUBE ADAPTER, and the half of it that needs no key.
 *
 * Spec 18 section 3.3, read carefully: "Discovery goes through channel RSS
 * (feeds/videos.xml?channel_id=, 0 units) ... search.list is spent only on
 * what a user typed." Most of this adapter is free in both senses — no quota
 * units and no API key.
 *
 * The fixture is a real feed, pulled off the wire. A hand-written one agrees
 * with whatever the reader happens to do; the thing on the wire does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaLedger, runSearches, type AdapterName, type Quota, type QuotaStore } from "../src/scout-adapters.ts";
import {
  CHANNEL_ID,
  FEED,
  REFRESH_AFTER_MS,
  YOUTUBE_QUOTA,
  channelOf,
  parseChannelFeed,
  youtubeAdapter,
} from "../src/scout-youtube.ts";

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/youtube-channel-feed.xml"),
  "utf8",
);

function memoryStore(): QuotaStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async spent(a, d) {
      return rows.get(a + d) ?? 0;
    },
    async add(a, d, u) {
      rows.set(a + d, (rows.get(a + d) ?? 0) + u);
    },
  };
}

const ok = (body: string) => ({ ok: true, status: 200, async text() { return body; } }) as unknown as Response;

/* ── Which queries are free ─────────────────────────────────────────────── */

test("a channel id is a free query; anything else is not", () => {
  /*
   * THE WHOLE COST ARGUMENT. A channel feed is 0 units and no key; free text
   * is a search.list call out of a hundred a day. Treating them the same
   * either charges for the free path or gives the expensive one away.
   */
  assert.equal(channelOf("UCBa659QWEk1AI4Tg--mrJ2A"), "UCBa659QWEk1AI4Tg--mrJ2A");
  assert.equal(channelOf("rss:UCBa659QWEk1AI4Tg--mrJ2A"), "UCBa659QWEk1AI4Tg--mrJ2A");
  assert.equal(channelOf("  UCBa659QWEk1AI4Tg--mrJ2A  "), "UCBa659QWEk1AI4Tg--mrJ2A");

  assert.equal(channelOf("he bans a viewer live"), null);
  assert.equal(channelOf(""), null);
  /* Nearly a channel id is not one: too short, too long, wrong prefix. */
  assert.equal(channelOf("UCBa659QWEk1AI4Tg--mrJ2"), null);
  assert.equal(channelOf("UCBa659QWEk1AI4Tg--mrJ2AA"), null);
  assert.equal(channelOf("XXBa659QWEk1AI4Tg--mrJ2A"), null);
  /* And the pattern allows base64url's own two characters, which real ids use. */
  assert.ok(CHANNEL_ID.test("UCBa659QWEk1AI4Tg--mrJ2A"));
  assert.ok(CHANNEL_ID.test("UC_aaaaaaaaaaaaaaaaaaaaa"));
});

test("the quota is a hundred search.list calls a day, per project", () => {
  /*
   * The unit is the CALL, not the API's own 100-unit cost. The cap that bites
   * is "a hundred searches a day", and a ledger counting 10,000 abstract
   * units would need the conversion explained everywhere it was read.
   */
  assert.deepEqual(YOUTUBE_QUOTA, {
    daily: 100,
    scope: "project",
    perSearch: 1,
    perMetadata: 0,
    unit: "search.list",
  });
});

/* ── The real feed ──────────────────────────────────────────────────────── */

test("ACCEPTANCE: the real feed gives everything triage scores on but duration", () => {
  /*
   * Pulled off the wire. Fifteen entries, each with an id, a title, a
   * description, a date, a channel and a view count — which is five of
   * triage's six components. Duration and chapters are not in the feed, and
   * triage's unknown-duration case returns neither-good-nor-bad for exactly
   * this.
   */
  const got = parseChannelFeed(FIXTURE);
  assert.equal(got.length, 15);

  const [first] = got;
  assert.equal(first.adapter, "youtube");
  assert.match(first.externalId, /^[\w-]{11}$/);
  assert.equal(first.url, `https://www.youtube.com/watch?v=${first.externalId}`);
  assert.ok(first.title.length > 5, first.title);
  assert.ok((first.description ?? "").length > 20);
  assert.ok(first.channel && first.channel.length > 2);
  assert.ok(Number.isFinite(first.publishedAt));
  assert.ok((first.views ?? 0) > 1000, `views ${first.views}`);
  assert.equal(first.kind, "vod");
  assert.equal(first.durationS, undefined);

  /* Every entry, not just the first — a reader that works on entry one and
     drops a field on entry nine is the normal way this goes wrong. */
  for (const c of got) {
    assert.ok(c.externalId, "an entry with no id");
    assert.ok(c.title, `${c.externalId} has no title`);
    assert.ok(c.channel, `${c.externalId} has no channel`);
    assert.ok(Number.isFinite(c.publishedAt), `${c.externalId} has no date`);
    assert.ok(Number.isFinite(c.views), `${c.externalId} has no views`);
  }
  /* Fifteen distinct videos, not the same one fifteen times. */
  assert.equal(new Set(got.map((c) => c.externalId)).size, 15);
});

test("ACCEPTANCE: a perfectly subtitled VOD is transcript: none", () => {
  /*
   * YouTube has captions on nearly everything, and captions.download
   * requires owning the channel. `transcript` is what is READABLE, not what
   * exists — marking these "native" would send the scan pass after
   * transcripts it cannot have, and every beat would come back a gap with a
   * bill attached.
   */
  for (const c of parseChannelFeed(FIXTURE)) assert.equal(c.transcript, "none");
});

test("nothing in a candidate is a media URL", () => {
  /*
   * Invariant 9. The feed carries a media:content URL and a thumbnail, and
   * both are ignored — a SourceCandidate has an id, a link and metadata, and
   * nowhere a media byte could sit.
   */
  for (const c of parseChannelFeed(FIXTURE)) {
    const json = JSON.stringify(c);
    assert.ok(!/googlevideo/.test(json), c.externalId);
    assert.ok(!/ytimg/.test(json), c.externalId);
    assert.ok(!/\/v\/[\w-]{11}\?version=/.test(json), `${c.externalId} carries the embed URL`);
    assert.match(c.url, /^https:\/\/www\.youtube\.com\/watch\?v=/);
  }
});

test("an entry with no video id is not a candidate", () => {
  /* The feed's own header has a <title> and no <yt:videoId>, and a reader
     that took every <entry>-shaped thing would return the channel as a video. */
  const xml = `<feed><title>A channel</title>
    <entry><title>no id here</title></entry>
    <entry><yt:videoId>abc12345678</yt:videoId><title>real</title></entry>
  </feed>`;
  const got = parseChannelFeed(xml);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "real");
});

test("a feed truncated mid-entry keeps the entries before the break", () => {
  /* A short read on a 36KB document. Nine real videos are worth more than an
     exception. */
  const cut = FIXTURE.slice(0, FIXTURE.indexOf("<entry>") + 4000);
  const got = parseChannelFeed(cut);
  assert.ok(got.length >= 1, `${got.length} entries survived`);
  for (const c of got) assert.ok(c.externalId && c.title);
});

test("the channel falls back to the feed's own title", () => {
  /* An entry whose <author> is missing still belongs to a channel, and a
     candidate with no channel loses its critic-channel signal in triage. */
  const xml = `<feed><title>Tom Scott</title>
    <entry><yt:videoId>abc12345678</yt:videoId><title>x</title></entry>
  </feed>`;
  assert.equal(parseChannelFeed(xml)[0].channel, "Tom Scott");
});

test("a title's entities are decoded, because the verifier compares words", () => {
  const xml = `<feed><entry><yt:videoId>abc12345678</yt:videoId>
    <media:title>Why robots still can&#39;t pick strawberries &amp; peas</media:title>
  </entry></feed>`;
  assert.equal(parseChannelFeed(xml)[0].title, "Why robots still can't pick strawberries & peas");
});

/* ── The adapter ────────────────────────────────────────────────────────── */

test("a channel feed costs nothing, even with the day's budget gone", async () => {
  /*
   * The point of the free path: one exhausted endpoint must not take the
   * zero-cost discovery path down with it, or a run with budget left stops
   * looking.
   */
  const store = memoryStore();
  const ledger = new QuotaLedger(store);
  const day = new Date().toISOString().slice(0, 10);
  store.rows.set("youtube" + day, 100);

  const asked: string[] = [];
  const adapters = new Map<AdapterName, ReturnType<typeof youtubeAdapter>>([
    [
      "youtube",
      youtubeAdapter({
        fetch: (async (url: string) => {
          asked.push(String(url));
          return ok(FIXTURE);
        }) as unknown as typeof fetch,
      }),
    ],
  ]);

  const out = await runSearches(
    [
      { adapter: "youtube", beatId: "B1", family: "direct", query: "he bans a viewer" },
      { adapter: "youtube", beatId: "B1", family: "seed", query: "rss:UCBa659QWEk1AI4Tg--mrJ2A" },
    ],
    adapters as never,
    ledger,
  );

  assert.equal(out.rows[0].outcome, "quota_exhausted");
  assert.equal(out.rows[1].outcome, "ok");
  assert.equal(out.rows[1].quotaUnits, 0);
  assert.equal(out.rows[1].resultsN, 15);
  assert.equal(await ledger.spentToday("youtube"), 100);
  /* And the URL is the documented one, with the id encoded. */
  assert.deepEqual(asked, [FEED + "UCBa659QWEk1AI4Tg--mrJ2A"]);
});

test("ACCEPTANCE: with no key, free text refuses with a sentence rather than nothing", async () => {
  /*
   * A board reading "no YouTube Data API key" is telling the truth. One
   * reading "found nothing" is not, and it is the beat's gap that carries the
   * lie — "we looked and there is nothing" instead of "we could not look".
   */
  const ledger = new QuotaLedger(memoryStore());
  const adapters = new Map([["youtube", youtubeAdapter({ fetch: (async () => ok(FIXTURE)) as never })]]);
  const out = await runSearches(
    [{ adapter: "youtube", beatId: "B1", family: "direct", query: "he bans a viewer" }],
    adapters as never,
    ledger,
  );

  assert.equal(out.rows[0].outcome, "failed");
  assert.match(out.rows[0].failReason!, /no YouTube Data API key/);
  assert.match(out.rows[0].failReason!, /channel feeds still work/);
  assert.equal(out.candidates.length, 0);
  /* The refusal still cost its unit, because the ledger reserved before the
     call and the call is what failed — the accounting does not get to be
     cleverer than the world. */
  assert.equal(out.rows[0].quotaUnits, 1);
});

test("a key present but search.list unbuilt says so differently", async () => {
  /* Two different problems: nobody has a key, and nobody has written the
     call. A single message for both sends somebody looking for a key they
     already have. */
  const a = youtubeAdapter({ apiKey: "a-key", fetch: (async () => ok(FIXTURE)) as never });
  await assert.rejects(() => a.search("he bans a viewer", "direct"), /search\.list is not implemented/);
});

test("a channel that does not exist is a fact about the channel", async () => {
  const a = youtubeAdapter({
    fetch: (async () => ({ ok: false, status: 404, async text() { return ""; } })) as never,
  });
  await assert.rejects(() => a.search("UCBa659QWEk1AI4Tg--mrJ2A", "seed"), /HTTP 404/);
});

test("the thirty-day refresh is written down, because the terms require it", () => {
  /* YouTube's terms: stored metadata is refreshed every thirty days. A row
     older than that is a claim about a video that may no longer exist. */
  assert.equal(REFRESH_AFTER_MS, 30 * 24 * 60 * 60 * 1000);
});
