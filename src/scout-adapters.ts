/**
 * THE ADAPTER LAYER: where Scout touches other people's platforms.
 *
 * Six of them, each with different terms, different quotas and different
 * opinions about what may be stored. Spec 18 section 3.3. The layer exists so
 * the run above it does not know or care which platform a candidate came
 * from, and so the two rules that must never bend live in ONE place instead
 * of six.
 *
 * RULE ONE, INVARIANT 9: an adapter finds and links. Nothing here fetches
 * audiovisual content from a platform that forbids it, and the types make
 * that awkward to break by accident — a `SourceCandidate` has an id, a URL
 * and metadata, and no field a media byte could sit in. The deliberate
 * version is caught by the gate (`npm run check`, the `reachable` rule).
 *
 * RULE TWO, THE QUOTA: YouTube gives 100 `search.list` calls a day per
 * project. A run that spends them is not a run that failed — it is the next
 * twenty runs that fail, tomorrow, for someone who did nothing. So the budget
 * is accounted before the call, not after the error, and a call that would go
 * over does not happen.
 *
 * AND THE THING THAT GOES WRONG QUIETLY. Quota exhaustion looks exactly like
 * "found nothing": the search returns no rows, the beat stays thin, the board
 * says "sought 6 searches, found 2" and every word of it is a lie because
 * four of the six never left the building. Invariant 7 calls a silent partial
 * failure a P1. Every attempt writes a row, including the ones that did not
 * happen and why.
 */

import { ulid } from "./id.ts";

/** The four query families, plus the fifth that comes from snowballing. */
export const FAMILIES = ["direct", "vocab", "crowd", "counter", "seed"] as const;
export type Family = (typeof FAMILIES)[number];

/** Which platform. The names the spec's table uses. */
export const ADAPTERS = ["youtube", "twitch", "websearch", "podcast", "gdelt_tv", "user_captures"] as const;
export type AdapterName = (typeof ADAPTERS)[number];

/**
 * What a search hands back: enough to decide whether to look closer, and
 * nothing a video could hide in.
 *
 * `transcript` is what is READABLE, not what exists. YouTube has captions on
 * nearly everything and lets us download none of them without owning the
 * channel, so a VOD with perfect subtitles is `none` here and the honest
 * thing to do with it is a mission or its crowd signals.
 */
export interface SourceCandidate {
  adapter: AdapterName;
  /** The platform's own id. What we store instead of the video. */
  externalId: string;
  /** Where a person goes to watch it. */
  url: string;
  title: string;
  channel?: string;
  description?: string;
  /** Chapter titles, where the platform gives them. Vocabulary lives here. */
  chapters?: string[];
  publishedAt?: number;
  durationS?: number;
  views?: number;
  kind?: "vod" | "clip" | "compilation" | "interview" | "podcast" | "news" | "reupload";
  transcript?: "native" | "transcribed" | "none";
  /** An open licence, where the platform states one. The only route to auto. */
  licence?: string;
  /** When the platform's own copy goes away — Twitch VODs at 7, 14 or 60 days. */
  expiresAt?: number;
}

/* ── Quota ──────────────────────────────────────────────────────────────── */

/**
 * What an adapter costs, in its own units.
 *
 * `daily` is the cap; 0 means the adapter has none worth counting. `scope`
 * matters for the error message and for where the counter lives: YouTube's
 * cap is per API project, so one user's heavy afternoon is everybody's
 * problem, and saying "the daily YouTube budget" rather than "your quota" is
 * the difference between a true message and a confusing one.
 */
export interface Quota {
  daily: number;
  scope: "project" | "account" | "none";
  /** Cost of one search call. YouTube's `search.list` is the expensive one. */
  perSearch: number;
  /** Cost of one metadata call. `videos.list` is 1 unit for up to 50 ids. */
  perMetadata: number;
  /** What the units are called, for the message. */
  unit: string;
}

/** An adapter that found nothing because it was not allowed to look. */
export class QuotaExhausted extends Error {
  readonly adapter: AdapterName;
  readonly spent: number;
  readonly daily: number;
  constructor(adapter: AdapterName, spent: number, daily: number, unit: string) {
    super(`${adapter}: the daily ${unit} budget is spent (${spent} of ${daily})`);
    this.name = "QuotaExhausted";
    this.adapter = adapter;
    this.spent = spent;
    this.daily = daily;
  }
}

/**
 * Where the day's spend is kept. D1 in the product, a Map in the tests.
 *
 * Split out as an interface because the accounting is the part that has to be
 * right and the storage is the part that is boring, and the accounting cannot
 * be tested against a real daily budget — the test would have to wait until
 * tomorrow.
 */
export interface QuotaStore {
  spent(adapter: AdapterName, day: string): Promise<number>;
  add(adapter: AdapterName, day: string, units: number): Promise<void>;
}

/** The UTC day a spend counts against. YouTube's quota resets at midnight Pacific; */
/* this is a day boundary that both sides of a deploy agree on, which matters more. */
export function quotaDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * THE BUDGET IS CHECKED BEFORE THE CALL, NOT AFTER THE ERROR.
 *
 * Waiting for the platform's own 403 means the hundredth call is made and the
 * hundred-and-first is the one that fails — and by then the day is gone. It
 * also means every adapter has to recognise a different vendor's way of
 * saying no. Counting our own units costs a row and is the same in all six.
 *
 * `reserve` commits the units before the call rather than after it. A call
 * that was made and then crashed still cost its quota, and a ledger that only
 * counts successes is a ledger that overspends on a bad afternoon.
 */
export class QuotaLedger {
  private store: QuotaStore;
  private day: string;

  constructor(store: QuotaStore, now = Date.now()) {
    this.store = store;
    this.day = quotaDay(now);
  }

  /**
   * Takes `units` from the adapter's day, or throws QuotaExhausted.
   *
   * A free call — RSS discovery, GDELT, the user's own uploads — costs
   * nothing and is never refused. That is not an optimisation: the spec is
   * explicit that discovery goes through channel RSS at 0 units and
   * `search.list` is spent only on what a user typed, and a ledger that
   * charged for both would make the cheap path look expensive.
   */
  async reserve(adapter: AdapterName, quota: Quota, units: number): Promise<void> {
    if (units <= 0 || quota.daily <= 0) return;
    const spent = await this.store.spent(adapter, this.day);
    if (spent + units > quota.daily) {
      throw new QuotaExhausted(adapter, spent, quota.daily, quota.unit);
    }
    await this.store.add(adapter, this.day, units);
  }

  async spentToday(adapter: AdapterName): Promise<number> {
    return this.store.spent(adapter, this.day);
  }
}

/* ── The adapter ────────────────────────────────────────────────────────── */

/**
 * One platform. `search` finds candidates; `metadata` refreshes what we
 * already have ids for — the 30-day refresh YouTube's terms require.
 *
 * `freeSearch` is the adapter saying this particular query costs nothing: a
 * channel's RSS feed is 0 units and answers "what has he posted lately"
 * without touching the expensive endpoint.
 */
export interface ScoutAdapter {
  readonly name: AdapterName;
  readonly quota: Quota;
  search(query: string, family: Family): Promise<SourceCandidate[]>;
  metadata?(externalIds: string[]): Promise<SourceCandidate[]>;
  /** True when this query can be answered without spending quota. */
  freeSearch?(query: string, family: Family): boolean;
}

/* ── Running searches ───────────────────────────────────────────────────── */

export interface SearchRequest {
  adapter: AdapterName;
  beatId: string | null;
  family: Family;
  query: string;
  hyde?: string;
}

/**
 * One row per attempt, written whether or not the attempt happened.
 *
 * `outcome` is the field that stops the quiet failure. "ok" with results_n 0
 * means we looked and there was nothing — a result, and the board can say so.
 * "quota_exhausted" means we never looked, which is a completely different
 * sentence to put in front of a person.
 */
export interface SearchRow {
  id: string;
  beatId: string | null;
  family: Family;
  adapter: AdapterName;
  query: string;
  hyde: string | null;
  issuedAt: number;
  resultsN: number;
  quotaUnits: number;
  outcome: "ok" | "quota_exhausted" | "failed" | "skipped_duplicate";
  failReason: string | null;
}

export interface SearchOutcome {
  rows: SearchRow[];
  candidates: SourceCandidate[];
  /** Adapters that ran out mid-round. The run moves on; the board says so. */
  exhausted: AdapterName[];
}

/**
 * Runs a round of searches across adapters, in parallel, quota-aware.
 *
 * WHAT THIS REFUSES TO DO IS THE POINT. It does not retry an exhausted
 * adapter, it does not swallow a thrown adapter, it does not return a
 * candidate list without the rows that explain it, and it does not issue the
 * same query twice — a query already tried this run costs units and returns
 * the same page, and `queries_tried` is what the diligence log exports.
 *
 * Ordering: requests are issued in the order given and the rows come back in
 * that order, so a run is reproducible and a reader of the log sees what
 * happened in the sequence it happened. The ISSUING is parallel; the
 * accounting is not, because two calls reserving the last unit at the same
 * moment would both get it.
 */
export async function runSearches(
  requests: SearchRequest[],
  adapters: Map<AdapterName, ScoutAdapter>,
  ledger: QuotaLedger,
  opts: { alreadyTried?: Set<string>; now?: () => number } = {},
): Promise<SearchOutcome> {
  const now = opts.now ?? (() => Date.now());
  const tried = new Set(opts.alreadyTried ?? []);
  const exhausted = new Set<AdapterName>();

  /*
   * PARALLEL ACROSS ADAPTERS, SEQUENTIAL WITHIN ONE.
   *
   * Six YouTube searches issued together cannot be called off when the first
   * one comes back refused — they are already on the wire, and the quota is
   * already gone. In sequence, the first refusal stops the other five, which
   * is the whole point of handling the error. Different platforms share no
   * budget and no rate limit with each other, so those run together.
   *
   * Rows are built in REQUEST order and filled in place, so the diligence log
   * reads in the order a person asked for things rather than the order six
   * platforms happened to answer.
   */
  const rows: SearchRow[] = requests.map((req) => ({
    id: ulid(now()),
    beatId: req.beatId,
    family: req.family,
    adapter: req.adapter,
    query: req.query,
    hyde: req.hyde ?? null,
    issuedAt: now(),
    resultsN: 0,
    quotaUnits: 0,
    outcome: "ok",
    failReason: null,
  }));

  const found: SourceCandidate[][] = requests.map(() => []);
  const byAdapter = new Map<AdapterName, number[]>();

  requests.forEach((req, i) => {
    /* The duplicate pass is first and global: a query already tried costs
       units and returns the same page. The row is kept rather than dropped
       because queries_tried is what the diligence log exports — a query that
       was not re-run is still a query that was asked for. */
    const key = `${req.adapter}\u0000${req.query}`;
    if (tried.has(key)) {
      rows[i].outcome = "skipped_duplicate";
      rows[i].failReason = "this exact query was already run";
      return;
    }
    tried.add(key);

    if (!adapters.has(req.adapter)) {
      /* An adapter can be off — no key configured, a platform withdrawn. The
         round has five other searches in it, and losing them to an exception
         would turn a configuration gap into a lost run. */
      rows[i].outcome = "failed";
      rows[i].failReason = `no adapter named ${req.adapter}`;
      return;
    }

    const list = byAdapter.get(req.adapter);
    if (list) list.push(i);
    else byAdapter.set(req.adapter, [i]);
  });

  await Promise.all(
    [...byAdapter].map(async ([name, indices]) => {
      const adapter = adapters.get(name)!;
      for (const i of indices) {
        const req = requests[i];
        const row = rows[i];
        const free = adapter.freeSearch?.(req.query, req.family) === true;
        const units = free ? 0 : adapter.quota.perSearch;

        /* A free call is never refused: the spec is explicit that discovery
           goes through channel RSS at 0 units and search.list is spent only
           on what a user typed. */
        if (exhausted.has(name) && units > 0) {
          row.outcome = "quota_exhausted";
          row.failReason = `${name}: the daily ${adapter.quota.unit} budget was already spent this round`;
          continue;
        }

        try {
          await ledger.reserve(name, adapter.quota, units);
        } catch (e) {
          if (!(e instanceof QuotaExhausted)) throw e;
          exhausted.add(name);
          row.outcome = "quota_exhausted";
          row.failReason = e.message;
          continue;
        }

        /* Committed before the call, not after it. A call that was made and
           then crashed still cost its quota, and a ledger that counted only
           successes would overspend on a bad afternoon. */
        row.quotaUnits = units;

        try {
          const got = await adapter.search(req.query, req.family);
          found[i] = got;
          row.resultsN = got.length;
        } catch (e) {
          /* A platform can also say no at the call: our accounting can be
             behind another worker or another project on the same key. When it
             does, it is believed, and the rest of this adapter's round stops. */
          if (e instanceof QuotaExhausted) {
            exhausted.add(name);
            row.outcome = "quota_exhausted";
          } else {
            row.outcome = "failed";
          }
          row.failReason = e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );

  return { rows, candidates: found.flat(), exhausted: [...exhausted] };
}

/* ── The D1 store ───────────────────────────────────────────────────────── */

/**
 * The day's spend, in the product's own database.
 *
 * On `rate_limits`, which already holds exactly this shape — a key, a window
 * and a count — and is already on the request path. A second table for the
 * same idea would be a second thing to get wrong.
 */
export function d1QuotaStore(db: D1Database): QuotaStore {
  const k = (adapter: AdapterName) => `scout_quota:${adapter}`;
  /* The day IS the window, so the table's own (k, window_start) key does the
     bucketing and yesterday's row is simply never read again. */
  const windowStart = (day: string) => Date.parse(day + "T00:00:00Z");
  return {
    async spent(adapter, day) {
      const row = await db
        .prepare("SELECT hits FROM rate_limits WHERE k = ? AND window_start = ?")
        .bind(k(adapter), windowStart(day))
        .first<{ hits: number }>();
      return row?.hits ?? 0;
    },
    async add(adapter, day, units) {
      await db
        .prepare(
          "INSERT INTO rate_limits (k, window_start, hits) VALUES (?, ?, ?) " +
            "ON CONFLICT(k, window_start) DO UPDATE SET hits = hits + ?",
        )
        .bind(k(adapter), windowStart(day), units, units)
        .run();
    },
  };
}
