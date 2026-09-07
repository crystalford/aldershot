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

/*
 * THE HANDOFF CONTRADICTS ITSELF HERE, so this is written down rather than
 * quietly picked.
 *
 *   05-INFRA-AND-COSTS.md §Pricing shape:  Free 60 source minutes,
 *                                          Pro $39 (15h), Studio $119 (50h)
 *   Landing.dc.html and the Settings panel in Aldershot.dc.html:
 *                                          Free $0 / 300 minutes / 25 GB,
 *                                          Studio $29 / 1,200 minutes / 100 GB
 *
 * Two tiers or three, different prices, different caps. The prototype wins —
 * that is the standing rule when prose and prototype disagree, and it is also
 * the number a customer would have read on the pricing page before paying.
 *
 * `pro` is kept as an alias of studio rather than deleted: the column is a
 * free-text TEXT and any row already carrying "pro" must keep working.
 */
export type Plan = "free" | "pro" | "studio";

export const PLANS: Record<Plan, { label: string; sourceMinutes: number; storageGb: number; price: number }> = {
  // Enough to feel the claim, not enough to abuse.
  free: { label: "Free", sourceMinutes: 300, storageGb: 25, price: 0 },
  pro: { label: "Studio", sourceMinutes: 1200, storageGb: 100, price: 29 },
  studio: { label: "Studio", sourceMinutes: 1200, storageGb: 100, price: 29 },
};

export interface CapCheck {
  ok: boolean;
  used: number;
  cap: number;
  remaining: number;
  /** The owner's account is metered but never blocked — see checkCap. */
  unlimited?: boolean;
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

  /*
   * THE OWNER IS METERED, NEVER BLOCKED.
   *
   * upsertUser puts the owner on Studio with the comment "so caps never block
   * their own testing" — but Studio's cap is a number like any other, and a
   * 2,674-minute upload duly hit it. Being unable to use your own product is
   * not a plan tier.
   *
   * Read here rather than passed in: there are two call sites today and the
   * one that matters is deep inside ingest, so a flag threaded through
   * arguments is a flag the third call site forgets. Usage is unaffected —
   * meter() writes usage_events regardless of this function, which is the
   * whole point: the owner's real consumption is what says what a plan should
   * cost.
   */
  const owner = await db
    .prepare(`SELECT is_owner FROM v2_users WHERE id=?`)
    .bind(userId)
    .first<{ is_owner: number }>();

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
  if (owner?.is_owner) return { ok: true, used, cap, remaining, unlimited: true };
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
