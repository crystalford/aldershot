/**
 * Metering. Every job consumer writes exactly one `usage_events` row when it
 * finishes — "a job that does not meter is a bug" (04-API-AND-JOBS.md).
 *
 * The row records what was actually burned AND the unit prices at that moment,
 * snapshotted rather than referenced, so that when prices change the history
 * stays true and last month's total does not silently move
 * (05-INFRA-AND-COSTS.md §Metering).
 *
 * Cost is then a query, never a running total anyone has to maintain.
 */

import { ulid } from "./id.ts";

/**
 * Unit prices, 2026-08. Everything is priced per source minute where possible,
 * because that is the only unit that moves spend here (05-INFRA §Metering).
 *
 * Workers AI is billed in Neurons at $0.011 per 1,000. The per-model neuron
 * rates below come from the catalog; see docs/decisions/models.md.
 */
export const PRICES = {
  usd_per_1k_neurons: 0.011,

  /** Whisper large-v3-turbo: 46.63 neurons per audio-minute. */
  neurons_per_audio_min_transcribe: 46.63,
  /** Deepgram Nova-3 (the diarization upgrade): 472.73 neurons per audio-minute. */
  neurons_per_audio_min_transcribe_diarized: 472.73,

  /** glm-5.3-flash: 13,636 in / 45,455 out, per million tokens. */
  neurons_per_m_tokens_in: 13_636,
  neurons_per_m_tokens_out: 45_455,

  /** bge-large-en-v1.5: 18,582 neurons per million input tokens. */
  neurons_per_m_tokens_embed: 18_582,

  /** R2, per GB-month stored and per GB delivered (R2 has no egress fee). */
  usd_per_gb_month_r2: 0.015,
  usd_per_gb_delivered: 0,

  /** Cloudflare Stream, per minute stored and per minute delivered. */
  usd_per_stream_min_stored: 0.005,
  usd_per_stream_min_delivered: 0.001,

  /**
   * Containers, per CPU-second. KEPT FOR HISTORY ONLY — every row written
   * before the three dimensions below was priced with it, and prices are
   * snapshotted per row so those rows must still recompute. New container work
   * is priced by the shape of the machine; see below.
   */
  usd_per_cpu_second: 0.000_02,

  /*
   * WHAT A CONTAINER ACTUALLY COSTS, IN THE THREE DIMENSIONS IT BILLS IN.
   *
   * A single per-CPU-second rate is not what Cloudflare charges. Memory and
   * disk are billed on the PROVISIONED size of the instance for every second
   * it is awake, whether the job touches them or not; only CPU is billed on
   * consumption. Pricing all of it as one flat CPU rate understated a
   * standard-4 by 5.6x, which is how a $23 line arrived unannounced.
   */
  usd_per_gib_second: 0.000_002_5,
  usd_per_vcpu_second: 0.000_02,
  usd_per_disk_gb_second: 0.000_000_07,
} as const;

/**
 * The machines, and which work runs on which.
 *
 * Kept as a job-type map rather than a column on usage_events: the mapping is
 * a fact about the deploy (see wrangler.jsonc), it is already true of every
 * historical row, and a migration to record what we can already derive would
 * be a schema change for nothing.
 */
export const INSTANCE = {
  "standard-4": { gib: 12, vcpu: 4, disk_gb: 20 },
  "standard-2": { gib: 6, vcpu: 1, disk_gb: 12 },
} as const;

export const RUNS_ON: Partial<Record<JobType, keyof typeof INSTANCE>> = {
  render: "standard-4",
  shorts: "standard-4",
  proxy: "standard-4",
};

export type Prices = typeof PRICES;

export type JobType =
  | "probe"
  | "frames"
  | "transcribe"
  | "embed"
  | "score"
  | "pass"
  | "render"
  | "shorts"
  | "proxy"
  | "tts"
  /* One Scout run. Its own type because its cost line is unlike every other
     one here: frontier calls and adapter quota rather than minutes of
     footage, and per-job cost is the number the business runs on. */
  | "scout";

export interface UsageInput {
  user_id: string;
  job_id?: string | null;
  job_type: JobType;
  source_minutes?: number;
  cpu_ms?: number;
  gpu_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  bytes_stored?: number;
  bytes_delivered?: number;
  stream_minutes_stored?: number;
  stream_minutes_delivered?: number;
  /*
   * What the work produced: "found" when it did something, "empty" when it ran
   * and produced nothing, "failed" when it died. Absent for job types where
   * the question is meaningless — a proxy either exists or the job failed.
   */
  outcome?: "found" | "empty" | "failed";
  /** Set when the diarization upgrade was used, which costs ~10x. */
  diarized?: boolean;
}

/**
 * Turns measured work into dollars using the prices passed in — never the
 * module constant directly, so a historical row can be recomputed against the
 * prices it was actually written with.
 */
export function computeCost(u: UsageInput, p: Prices): number {
  const neurons =
    (u.source_minutes ?? 0) *
      (u.diarized
        ? p.neurons_per_audio_min_transcribe_diarized
        : u.job_type === "transcribe"
          ? p.neurons_per_audio_min_transcribe
          : 0) +
    ((u.tokens_in ?? 0) / 1e6) * (u.job_type === "embed" ? p.neurons_per_m_tokens_embed : p.neurons_per_m_tokens_in) +
    ((u.tokens_out ?? 0) / 1e6) * p.neurons_per_m_tokens_out;

  const aiCost = (neurons / 1000) * p.usd_per_1k_neurons;

  /*
   * CONTAINER TIME, PRICED BY THE SHAPE OF THE MACHINE.
   *
   * `cpu_ms` is and always was WALL-CLOCK — every caller computes it as
   * Date.now() - t0 — which is the right measurement, because memory and disk
   * bill on the provisioned size for every second the instance is awake. It
   * was the RATE that was wrong: one flat per-CPU-second figure, blind to the
   * fact that a standard-4 reserves 12 GiB and 20 GB the whole time.
   *
   * vCPU is deliberately NOT charged here, and that is not laziness. It bills
   * on consumption, which a Worker cannot observe — and on the invoice that
   * prompted all of this, vCPU was $0.10 against $23.58 of memory, 0.4% of
   * container spend, because these instances are almost never CPU-saturated.
   * Inventing a utilisation factor would add error, not remove it. Memory plus
   * disk on wall-clock is not an estimate: it is the billing rule.
   *
   * Rows written before those rates existed carry prices that lack them, and
   * prices are snapshotted per row, so those fall back to what they were
   * actually priced with rather than being silently restated.
   */
  const seconds = (u.cpu_ms ?? 0) / 1000;
  const shape = RUNS_ON[u.job_type];
  const perSecond =
    shape && p.usd_per_gib_second != null
      ? INSTANCE[shape].gib * p.usd_per_gib_second +
        INSTANCE[shape].disk_gb * p.usd_per_disk_gb_second
      : p.usd_per_cpu_second;
  const cpuCost = seconds * perSecond;
  const storeCost = ((u.bytes_stored ?? 0) / 1e9) * p.usd_per_gb_month_r2;
  const deliverCost = ((u.bytes_delivered ?? 0) / 1e9) * p.usd_per_gb_delivered;
  const streamCost =
    (u.stream_minutes_stored ?? 0) * p.usd_per_stream_min_stored +
    (u.stream_minutes_delivered ?? 0) * p.usd_per_stream_min_delivered;

  return aiCost + cpuCost + storeCost + deliverCost + streamCost;
}

/**
 * Writes the row. Call once, on completion, from the consumer that did the
 * work — not from the route that queued it, or the numbers will count work
 * that never happened.
 */
export async function meter(db: D1Database, u: UsageInput): Promise<number> {
  const cost = computeCost(u, PRICES);
  await db
    .prepare(
      `INSERT INTO usage_events
         (id, user_id, job_id, job_type, source_minutes, cpu_ms, gpu_ms,
          tokens_in, tokens_out, bytes_stored, bytes_delivered,
          stream_minutes_stored, stream_minutes_delivered,
          unit_prices, cost_usd, outcome, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      ulid(),
      u.user_id,
      u.job_id ?? null,
      u.job_type,
      u.source_minutes ?? 0,
      u.cpu_ms ?? 0,
      u.gpu_ms ?? 0,
      u.tokens_in ?? 0,
      u.tokens_out ?? 0,
      u.bytes_stored ?? 0,
      u.bytes_delivered ?? 0,
      u.stream_minutes_stored ?? 0,
      u.stream_minutes_delivered ?? 0,
      JSON.stringify(PRICES),
      cost,
      u.outcome ?? null,
      Date.now(),
    )
    .run();
  return cost;
}

export interface MonthRollup {
  total: number;
  lines: { job_type: string; cost: number; count: number }[];
  source_minutes: number;
}

/** The cost panel's only source (05-INFRA §Metering, phase 8). */
export async function monthUsage(db: D1Database, userId: string, since: number): Promise<MonthRollup> {
  const { results } = await db
    .prepare(
      `SELECT job_type, SUM(cost_usd) AS cost, COUNT(*) AS count, SUM(source_minutes) AS mins
         FROM usage_events WHERE user_id = ? AND created_at >= ?
        GROUP BY job_type ORDER BY cost DESC`,
    )
    .bind(userId, since)
    .all<{ job_type: string; cost: number; count: number; mins: number }>();

  const lines = (results ?? []).map((r) => ({ job_type: r.job_type, cost: r.cost ?? 0, count: r.count ?? 0 }));
  return {
    total: lines.reduce((a, l) => a + l.cost, 0),
    lines,
    source_minutes: (results ?? []).reduce((a, r) => a + (r.mins ?? 0), 0),
  };
}
