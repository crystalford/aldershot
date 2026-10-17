/**
 * THE ADAPTER LAYER: quotas, and the failure that looks like success.
 *
 * Quota exhaustion is indistinguishable from "found nothing" unless somebody
 * made it distinguishable: the search returns no rows, the beat stays thin,
 * and the board says "sought 6 searches, found 2" while four of the six never
 * left the building. Invariant 7 calls a silent partial failure a P1, and
 * this is the shape it takes here.
 *
 * The other half is the bill. YouTube gives 100 search.list calls a day per
 * project. Spending them is not this run failing — it is tomorrow's twenty
 * runs failing, for someone who did nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QuotaExhausted,
  QuotaLedger,
  quotaDay,
  runSearches,
  type AdapterName,
  type Family,
  type Quota,
  type QuotaStore,
  type ScoutAdapter,
  type SourceCandidate,
} from "../src/scout-adapters.ts";

/** The day's spend, in a Map. A real daily budget cannot be tested before tomorrow. */
function memoryStore(): QuotaStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    async spent(adapter, day) {
      return rows.get(adapter + day) ?? 0;
    },
    async add(adapter, day, units) {
      rows.set(adapter + day, (rows.get(adapter + day) ?? 0) + units);
    },
  };
}

const YT_QUOTA: Quota = { daily: 100, scope: "project", perSearch: 1, perMetadata: 0, unit: "search.list" };
const FREE_QUOTA: Quota = { daily: 0, scope: "none", perSearch: 0, perMetadata: 0, unit: "call" };

function fakeAdapter(
  name: AdapterName,
  quota: Quota,
  opts: { results?: number; throws?: Error; free?: (q: string) => boolean } = {},
): ScoutAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    quota,
    calls,
    async search(query: string, _family: Family): Promise<SourceCandidate[]> {
      calls.push(query);
      if (opts.throws) throw opts.throws;
      return Array.from({ length: opts.results ?? 2 }, (_, i) => ({
        adapter: name,
        externalId: `${query}-${i}`,
        url: `https://example.test/${name}/${i}`,
        title: `${query} result ${i}`,
      }));
    },
    freeSearch: opts.free ? (q: string) => opts.free!(q) : undefined,
  };
}

const req = (adapter: AdapterName, query: string, family: Family = "direct", beatId: string | null = "B1") => ({
  adapter,
  beatId,
  family,
  query,
});

/* ── The ledger ─────────────────────────────────────────────────────────── */

test("the budget is checked before the call, not after the error", async () => {
  /*
   * Waiting for the platform's own 403 means the hundredth call is made and
   * the hundred-and-first is the one that fails — and by then the day is
   * gone. The ledger refuses the call that would go over.
   */
  const store = memoryStore();
  const ledger = new QuotaLedger(store);
  const quota: Quota = { ...YT_QUOTA, daily: 3 };

  await ledger.reserve("youtube", quota, 2);
  assert.equal(await ledger.spentToday("youtube"), 2);

  await assert.rejects(() => ledger.reserve("youtube", quota, 2), QuotaExhausted);
  /* And the refused call did not cost anything. */
  assert.equal(await ledger.spentToday("youtube"), 2);

  /* One unit still fits. The cap is a cap, not a cliff one short of it. */
  await ledger.reserve("youtube", quota, 1);
  assert.equal(await ledger.spentToday("youtube"), 3);
});

test("units are committed before the call, not after it", async () => {
  /*
   * A call that was made and then crashed still spent its quota. A ledger
   * that only counted successes would overspend on a bad afternoon, which is
   * the afternoon it matters.
   */
  const store = memoryStore();
  const ledger = new QuotaLedger(store);
  const adapters = new Map([["youtube", fakeAdapter("youtube", YT_QUOTA, { throws: new Error("502 from upstream") })]]);
  const out = await runSearches([req("youtube", "he bans a viewer")], adapters as never, ledger);

  assert.equal(out.rows[0].outcome, "failed");
  assert.match(out.rows[0].failReason!, /502/);
  assert.equal(out.rows[0].quotaUnits, 1);
  assert.equal(await ledger.spentToday("youtube"), 1);
});

test("a free call is never refused and never charged", async () => {
  /*
   * The spec is explicit: discovery goes through channel RSS at 0 units and
   * search.list is spent only on what a user typed. A ledger that charged
   * for both would make the cheap path look expensive and the expensive path
   * get used instead.
   */
  const store = memoryStore();
  const ledger = new QuotaLedger(store);
  store.rows.set("youtube" + quotaDay(), 100);

  const yt = fakeAdapter("youtube", YT_QUOTA, { free: (q) => q.startsWith("rss:") });
  const adapters = new Map([["youtube", yt]]);

  /*
   * THE PAID SEARCH GOES FIRST ON PURPOSE. Once it is refused the adapter is
   * marked out for the round, and the free call that follows has to go
   * through anyway — otherwise one exhausted endpoint takes the zero-cost
   * discovery path down with it, and a run with budget left stops looking.
   * An earlier version of this test ran the free call first, where nothing
   * was marked out yet and the rule was never exercised.
   */
  const out = await runSearches(
    [req("youtube", "he bans a viewer"), req("youtube", "rss:UC123"), req("youtube", "explains the rules")],
    adapters as never,
    ledger,
  );

  assert.equal(out.rows[0].outcome, "quota_exhausted");
  assert.equal(out.rows[1].outcome, "ok");
  assert.equal(out.rows[1].quotaUnits, 0);
  assert.equal(out.rows[2].outcome, "quota_exhausted");
  assert.deepEqual(yt.calls, ["rss:UC123"]);
  /* And it cost nothing: the hundred that were already spent are still a hundred. */
  assert.equal(await ledger.spentToday("youtube"), 100);
});

test("an adapter with no daily cap is never refused", async () => {
  /* GDELT is keyless and the user's own uploads are theirs. A cap of zero
     means "not counted", not "nothing allowed". */
  const ledger = new QuotaLedger(memoryStore());
  await ledger.reserve("gdelt_tv", FREE_QUOTA, 5);
  assert.equal(await ledger.spentToday("gdelt_tv"), 0);
});

test("the day boundary is a day, and yesterday's spend is not today's", async () => {
  const store = memoryStore();
  const monday = Date.parse("2026-10-12T23:59:00Z");
  const tuesday = Date.parse("2026-10-13T00:01:00Z");
  const quota: Quota = { ...YT_QUOTA, daily: 1 };

  await new QuotaLedger(store, monday).reserve("youtube", quota, 1);
  await assert.rejects(() => new QuotaLedger(store, monday).reserve("youtube", quota, 1), QuotaExhausted);
  /* A new day, a new hundred. */
  await new QuotaLedger(store, tuesday).reserve("youtube", quota, 1);
  assert.equal(quotaDay(monday), "2026-10-12");
  assert.equal(quotaDay(tuesday), "2026-10-13");
});

/* ── The row that stops the quiet failure ───────────────────────────────── */

test("ACCEPTANCE: a dropped quota_exhausted is recorded, never silent", async () => {
  /*
   * The spec's own v0 acceptance test. Six searches asked for, two adapters,
   * one of them out of budget after the first call. The candidate list is
   * short and the ROWS are what say why — without them the board reports
   * diligence that did not happen.
   */
  const store = memoryStore();
  const ledger = new QuotaLedger(store);
  const yt = fakeAdapter("youtube", { ...YT_QUOTA, daily: 1 }, { results: 3 });
  const brave = fakeAdapter("websearch", { daily: 0, scope: "none", perSearch: 0, perMetadata: 0, unit: "request" });
  const adapters = new Map<AdapterName, ScoutAdapter>([
    ["youtube", yt],
    ["websearch", brave],
  ]);

  const out = await runSearches(
    [
      req("youtube", "bans a viewer live"),
      req("youtube", "reads the donation out"),
      req("youtube", "the ban compilation", "crowd"),
      req("websearch", "reddit incident list", "crowd"),
      req("websearch", "chat rules apology", "counter"),
      req("youtube", "explains his chat rules", "counter"),
    ],
    adapters,
    ledger,
  );

  /* Every attempt has a row, in the order it was asked for. */
  assert.equal(out.rows.length, 6);
  assert.deepEqual(
    out.rows.map((r) => r.outcome),
    ["ok", "quota_exhausted", "quota_exhausted", "ok", "ok", "quota_exhausted"],
  );

  /* The three that never happened say so, each with a reason a person can read. */
  for (const r of out.rows.filter((r) => r.outcome === "quota_exhausted")) {
    assert.match(r.failReason!, /search\.list/);
    assert.equal(r.resultsN, 0);
    assert.equal(r.quotaUnits, 0);
  }

  /* And YouTube was asked exactly once — the cap held. */
  assert.deepEqual(yt.calls, ["bans a viewer live"]);
  assert.equal(brave.calls.length, 2);
  assert.deepEqual(out.exhausted, ["youtube"]);
  assert.equal(out.candidates.length, 3 + 2 + 2);
  /* The rows account for every candidate. A list with no rows behind it is a
     claim about diligence with no receipt. */
  assert.equal(
    out.rows.reduce((n, r) => n + r.resultsN, 0),
    out.candidates.length,
  );
});

test("an exhausted adapter is not asked again, and each attempt still gets a row", async () => {
  /* One refusal per adapter per round, recorded once per attempt: the
     diligence log has to show six asks, not one ask and five silences. */
  const store = memoryStore();
  store.rows.set("youtube" + quotaDay(), 100);
  const ledger = new QuotaLedger(store);
  const yt = fakeAdapter("youtube", YT_QUOTA);
  const adapters = new Map([["youtube", yt]]);
  const out = await runSearches(
    [req("youtube", "a"), req("youtube", "b"), req("youtube", "c")],
    adapters as never,
    ledger,
  );
  assert.equal(yt.calls.length, 0);
  assert.equal(out.rows.length, 3);
  for (const r of out.rows) assert.equal(r.outcome, "quota_exhausted");
  /* The first says the budget is spent; the second and third say it was
     already spent this round, rather than each pretending to have tried. */
  assert.match(out.rows[0].failReason!, /budget is spent \(100 of 100\)/);
  assert.match(out.rows[1].failReason!, /already spent this round/);
});

test("the same query is not run twice, and the skip says why", async () => {
  /*
   * A repeated query costs units and returns the same page. The row is kept
   * rather than dropped because queries_tried is what the diligence log
   * exports — a query that was not re-run is not a query that was not asked.
   */
  const ledger = new QuotaLedger(memoryStore());
  const yt = fakeAdapter("youtube", YT_QUOTA);
  const adapters = new Map([["youtube", yt]]);
  const out = await runSearches(
    [req("youtube", "bans a viewer"), req("youtube", "bans a viewer")],
    adapters as never,
    ledger,
  );
  assert.deepEqual(yt.calls, ["bans a viewer"]);
  assert.equal(out.rows[1].outcome, "skipped_duplicate");
  assert.equal(out.rows[1].quotaUnits, 0);
  assert.equal(await ledger.spentToday("youtube"), 1);
});

test("a query tried in an earlier round is skipped in this one", async () => {
  /* Rounds snowball, and the fifth round's seed queries overlap the first
     round's. Four rounds of the same query is four times the bill. */
  const ledger = new QuotaLedger(memoryStore());
  const yt = fakeAdapter("youtube", YT_QUOTA);
  const adapters = new Map([["youtube", yt]]);
  const out = await runSearches([req("youtube", "bans a viewer")], adapters as never, ledger, {
    alreadyTried: new Set(["youtube\u0000bans a viewer"]),
  });
  assert.equal(yt.calls.length, 0);
  assert.equal(out.rows[0].outcome, "skipped_duplicate");
});

test("the same query against a different adapter is not a duplicate", async () => {
  /* "the ban compilation" on YouTube and on the open web are different
     questions with different answers. */
  const ledger = new QuotaLedger(memoryStore());
  const yt = fakeAdapter("youtube", YT_QUOTA);
  const brave = fakeAdapter("websearch", FREE_QUOTA);
  const adapters = new Map<AdapterName, ScoutAdapter>([
    ["youtube", yt],
    ["websearch", brave],
  ]);
  const out = await runSearches(
    [req("youtube", "the ban compilation"), req("websearch", "the ban compilation")],
    adapters,
    ledger,
  );
  assert.deepEqual(out.rows.map((r) => r.outcome), ["ok", "ok"]);
  assert.equal(yt.calls.length, 1);
  assert.equal(brave.calls.length, 1);
});

test("a missing adapter is a failed row, not a thrown run", async () => {
  /*
   * An adapter can be off — no key configured, a platform withdrawn. The
   * round has five other searches in it and losing them to an exception
   * would turn a configuration gap into a lost run.
   */
  const ledger = new QuotaLedger(memoryStore());
  const brave = fakeAdapter("websearch", FREE_QUOTA);
  const out = await runSearches(
    [req("twitch", "clips by views"), req("websearch", "reddit incident list")],
    new Map([["websearch", brave]]) as never,
    ledger,
  );
  assert.equal(out.rows[0].outcome, "failed");
  assert.match(out.rows[0].failReason!, /no adapter named twitch/);
  assert.equal(out.rows[1].outcome, "ok");
  assert.equal(out.candidates.length, 2);
});

test("an adapter that throws QuotaExhausted at the call is believed", async () => {
  /*
   * Our own accounting can be behind — another worker, another project on the
   * same API key. When the platform says no, the adapter is out for the round
   * whatever the ledger thought.
   */
  const ledger = new QuotaLedger(memoryStore());
  const yt = fakeAdapter("youtube", YT_QUOTA, {
    throws: new QuotaExhausted("youtube", 100, 100, "search.list"),
  });
  const adapters = new Map([["youtube", yt]]);
  const out = await runSearches([req("youtube", "a"), req("youtube", "b")], adapters as never, ledger);
  assert.equal(out.rows[0].outcome, "quota_exhausted");
  assert.deepEqual(out.exhausted, ["youtube"]);
  /* The second was never attempted, because the first already said no. */
  assert.equal(yt.calls.length, 1);
  assert.equal(out.rows[1].outcome, "quota_exhausted");
});

test("every row carries a beat and a family, or the diligence log is unreadable", async () => {
  /* "Sought 6 searches, found 2" is per beat. A row with no beat is a search
     that happened for nobody. */
  const ledger = new QuotaLedger(memoryStore());
  const brave = fakeAdapter("websearch", FREE_QUOTA);
  const out = await runSearches(
    [req("websearch", "x", "counter", "C1"), req("websearch", "y", "crowd", "B2")],
    new Map([["websearch", brave]]) as never,
    ledger,
  );
  assert.deepEqual(out.rows.map((r) => [r.beatId, r.family]), [["C1", "counter"], ["B2", "crowd"]]);
  for (const r of out.rows) assert.ok(r.id && r.issuedAt > 0);
});

/* ── Invariant 9, at the type level ─────────────────────────────────────── */

test("a candidate has nowhere to put a video", () => {
  /*
   * Invariant 9 is enforced by the gate for the deliberate case. This is the
   * accidental one: there is no media field on a SourceCandidate, so an
   * adapter that fetched a file would have nowhere to hand it on to. The
   * assertion is on the keys an adapter actually fills.
   */
  const c: SourceCandidate = {
    adapter: "youtube",
    externalId: "abc123",
    url: "https://www.youtube.com/watch?v=abc123",
    title: "A stream",
    transcript: "none",
  };
  const forbidden = ["media", "bytes", "body", "buffer", "r2Key", "file", "stream", "download", "mp4"];
  for (const k of forbidden) assert.ok(!(k in c), `a candidate must not carry ${k}`);
  /* And "transcript: none" is what readable means, not what exists —
     YouTube has captions on nearly everything and lets us download none. */
  assert.equal(c.transcript, "none");
});

/* ── Parallel across adapters, sequential within one ────────────────────── */

test("one platform's refusal stops its own round and nobody else's", async () => {
  /*
   * THIS IS WHY THE CALLS ARE NOT ALL ISSUED TOGETHER. Six YouTube searches
   * sent at once cannot be called off when the first comes back refused —
   * they are already on the wire and the quota is already gone. In sequence
   * the first refusal stops the other five, which is the entire value of
   * handling the error. Platforms share no budget with each other, so they
   * still run together.
   */
  const ledger = new QuotaLedger(memoryStore());
  const order: string[] = [];
  const slow = (name: AdapterName, quota: Quota, throws?: Error): ScoutAdapter => ({
    name,
    quota,
    async search(query: string) {
      order.push(name + ":" + query);
      await new Promise((r) => setTimeout(r, 5));
      if (throws) throw throws;
      return [{ adapter: name, externalId: query, url: "https://example.test/" + query, title: query }];
    },
  });

  const adapters = new Map<AdapterName, ScoutAdapter>([
    ["youtube", slow("youtube", YT_QUOTA, new QuotaExhausted("youtube", 100, 100, "search.list"))],
    ["websearch", slow("websearch", FREE_QUOTA)],
  ]);

  const out = await runSearches(
    [
      req("youtube", "yt1"),
      req("websearch", "web1"),
      req("youtube", "yt2"),
      req("websearch", "web2"),
      req("youtube", "yt3"),
    ],
    adapters,
    ledger,
  );

  /* YouTube was asked once and then stopped; the open web ran both of its. */
  assert.deepEqual(order.filter((o) => o.startsWith("youtube")), ["youtube:yt1"]);
  assert.deepEqual(order.filter((o) => o.startsWith("websearch")), ["websearch:web1", "websearch:web2"]);

  /* They overlapped: web1 went out before yt1 came back. Sequential within
     an adapter must not become sequential across them — six platforms one
     after another is six times the wall clock for no reason. */
  assert.deepEqual(order.slice(0, 2).sort(), ["websearch:web1", "youtube:yt1"]);

  /* And the rows are still in the order they were asked for, not the order
     two platforms happened to answer. */
  assert.deepEqual(
    out.rows.map((r) => r.query),
    ["yt1", "web1", "yt2", "web2", "yt3"],
  );
  assert.deepEqual(
    out.rows.map((r) => r.outcome),
    ["quota_exhausted", "ok", "quota_exhausted", "ok", "quota_exhausted"],
  );
});

/* ── The store that actually runs ───────────────────────────────────────── */

test("the D1 quota store counts a day, against the real table", async () => {
  /*
   * THE SQL IS THE PART NOTHING ELSE CHECKS. This store was written against
   * a column called `key`; the table's column is `k`, the typechecker has no
   * opinion about either, and the first time it would have mattered is a
   * production run spending unbounded YouTube quota because every read came
   * back zero.
   *
   * So the DDL is taken from migrations/schema.sql — which the fidelity gate
   * guarantees matches the schema that runs — rather than retyped here,
   * where it could be retyped wrong in the same direction as the bug.
   */
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { fakeD1 } = await import("./helpers/fake-d1.ts");
  const { d1QuotaStore } = await import("../src/scout-adapters.ts");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, "../migrations/schema.sql"), "utf8");
  const ddl = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .find((s) => /create table if not exists rate_limits/i.test(s));
  assert.ok(ddl, "migrations/schema.sql has no rate_limits table — run `npm run schema`");

  const db = new DatabaseSync(":memory:");
  db.exec(ddl + ";");
  const store = d1QuotaStore(fakeD1(db) as never);

  const monday = Date.parse("2026-10-12T09:00:00Z");
  const ledger = new QuotaLedger(store, monday);

  assert.equal(await ledger.spentToday("youtube"), 0);
  await ledger.reserve("youtube", YT_QUOTA, 1);
  await ledger.reserve("youtube", YT_QUOTA, 1);
  assert.equal(await ledger.spentToday("youtube"), 2);

  /* Another adapter is another budget. */
  await ledger.reserve("twitch", { ...YT_QUOTA, unit: "helix call" }, 5);
  assert.equal(await ledger.spentToday("twitch"), 5);
  assert.equal(await ledger.spentToday("youtube"), 2);

  /* And tomorrow starts at nothing without anybody clearing anything. */
  const tuesday = new QuotaLedger(store, Date.parse("2026-10-13T09:00:00Z"));
  assert.equal(await tuesday.spentToday("youtube"), 0);

  /* The cap holds through the real table, which is the whole claim. */
  const tight: Quota = { ...YT_QUOTA, daily: 3 };
  await ledger.reserve("youtube", tight, 1);
  await assert.rejects(() => ledger.reserve("youtube", tight, 1), QuotaExhausted);
  assert.equal(await ledger.spentToday("youtube"), 3);
});
