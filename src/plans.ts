/**
 * Per-plan caps, in SOURCE MINUTES.
 *
 * Minutes are the unit because minutes are what the cost is in
 * (05-INFRA-AND-COSTS.md §Metering). Never sell "unlimited" on a
 * variable-cost product.
 *
 * The cap is checked BEFORE work starts, and the refusal states the cap —
 * refusing after spending the money defeats the point (04-API-AND-JOBS.md
 * §Failure rules).
 */

export type Plan = "free" | "pro" | "studio";

export const PLANS: Record<Plan, { label: string; sourceMinutes: number; price: number }> = {
  // Enough to feel the claim, not enough to abuse.
  free: { label: "Free", sourceMinutes: 60, price: 0 },
  pro: { label: "Pro", sourceMinutes: 15 * 60, price: 39 },
  studio: { label: "Studio", sourceMinutes: 50 * 60, price: 119 },
};

export interface CapCheck {
  ok: boolean;
  used: number;
  cap: number;
  remaining: number;
  /** Plain-language refusal, stating the cap. Shown to the user verbatim. */
  message?: string;
}

function startOfMonth(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Would transcribing `minutes` more take this account over its cap this month?
 *
 * Counts only source minutes actually consumed by ingest, since that is what
 * the cap is denominated in — a render or an extra LLM pass over an already-
 * ingested video does not consume more source minutes.
 */
export async function checkCap(db: D1Database, userId: string, plan: Plan, minutes: number): Promise<CapCheck> {
  const cap = PLANS[plan].sourceMinutes;
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(source_minutes),0) AS used
         FROM usage_events
        WHERE user_id = ? AND created_at >= ? AND job_type = 'transcribe'`,
    )
    .bind(userId, startOfMonth())
    .first<{ used: number }>();

  const used = row?.used ?? 0;
  const remaining = Math.max(0, cap - used);
  if (used + minutes <= cap) return { ok: true, used, cap, remaining };

  const mins = (n: number) => `${Math.round(n)} minute${Math.round(n) === 1 ? "" : "s"}`;
  return {
    ok: false,
    used,
    cap,
    remaining,
    message:
      remaining > 0
        ? `That video is ${mins(minutes)}, and you have ${mins(remaining)} left this month on ${PLANS[plan].label}. Add minutes or upgrade to keep going.`
        : `You have used all ${mins(cap)} on ${PLANS[plan].label} this month. Add minutes or upgrade to keep going.`,
  };
}
