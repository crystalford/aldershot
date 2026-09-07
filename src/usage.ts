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

  /** Containers, per CPU-second (ffmpeg probe/frames/render). */
  usd_per_cpu_second: 0.000_02,
} as const;

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
  | "tts";

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
  const cpuCost = ((u.cpu_ms ?? 0) / 1000) * p.usd_per_cpu_second;
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
          unit_prices, cost_usd, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
