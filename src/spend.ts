/**
 * THE MONTHLY SPEND CAP.
 *
 * `10-OPERATIONS-AND-PRICING.md`: "A monthly spend cap per account; NOTHING
 * RUNS PAST IT without the user raising it."
 *
 * So it is a gate in front of work, not a line in a report. Metering already
 * existed and was entirely retrospective: every job wrote what it cost and
 * nothing ever read those rows back to decide anything. An account could run
 * up any bill at all, and the first anybody would know is the invoice.
 *
 * WHAT A CAP CAN AND CANNOT DO, said plainly because the difference matters
 * and is easy to oversell. A job's cost is known when it finishes, not when
 * it starts — a transcription's price is the length of the footage, a
 * render's is the container seconds it burns. So this stops the NEXT job
 * after the cap is crossed; it cannot stop the one that crosses it. The
 * honest claim is "you will not run far past it", and the overshoot is one
 * job. Pretending otherwise would mean inventing an estimate per job type
 * and refusing on a guess, which gets somebody refused for a job that would
 * have been free.
 *
 * NO CAP SET IS NOT NO CAP. An account that has never been near the setting
 * gets DEFAULT_CAP_USD, because a cap that only protects the people who went
 * looking for it protects nobody. Raising it is a deliberate act and the
 * refusal says so.
 */

/**
 * What an account may spend in a month before work stops, in US dollars.
 *
 * Set above every plan's monthly price in doc 10 — Studio is $249 — so the
 * cap is a runaway brake and not a second pricing tier. Somebody on Studio
 * using what they pay for never meets it; somebody whose Scout run has gone
 * into a loop meets it the same day.
 */
export const DEFAULT_CAP_USD = 400;

/** A cap of zero is a real choice: stop everything. Null means "never set". */
export const capOrDefault = (capUsd: number | null | undefined): number =>
  capUsd === null || capUsd === undefined || !Number.isFinite(capUsd) ? DEFAULT_CAP_USD : Math.max(0, capUsd);

/** The first instant of the UTC month `now` falls in. */
export function monthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface CapVerdict {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  /** A sentence, with the numbers, that tells somebody what to do next. */
  says: string;
}

const money = (n: number): string => `$${n.toFixed(2)}`;

/**
 * May this account start another job?
 *
 * The comparison is `spent >= cap`, not `>`. At exactly the cap the money is
 * gone, and letting one more job through because the sum landed on the round
 * number is the kind of off-by-one that is only ever noticed in an invoice.
 */
export function capVerdict(o: { spentUsd: number; capUsd: number | null | undefined }): CapVerdict {
  const capUsd = capOrDefault(o.capUsd);
  const spentUsd = Number.isFinite(o.spentUsd) ? Math.max(0, o.spentUsd) : 0;

  if (spentUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd,
      capUsd,
      says:
        capUsd === 0
          ? "Your spend cap is set to nothing, so no jobs will run. Raise it in Settings when you want to start again."
          : `This month has cost ${money(spentUsd)} and your cap is ${money(capUsd)}. Nothing else will run until you raise it in Settings.`,
    };
  }

  return {
    allowed: true,
    spentUsd,
    capUsd,
    says: `${money(spentUsd)} of ${money(capUsd)} this month.`,
  };
}

/**
 * How close to the cap is close enough to say something?
 *
 * Eight tenths, and it is a warning rather than a refusal: the point of a cap
 * is that nobody is surprised by it, and somebody who finds out at the moment
 * work stops has been surprised by it.
 */
export const WARN_AT = 0.8;

export const nearingCap = (v: CapVerdict): boolean =>
  v.allowed && v.capUsd > 0 && v.spentUsd / v.capUsd >= WARN_AT;

/** What the account has spent since the start of this month. */
export async function spentThisMonth(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(`SELECT SUM(cost_usd) AS spent FROM usage_events WHERE user_id=? AND created_at>=?`)
    .bind(userId, monthStart(now))
    .first<{ spent: number | null }>();
  return row?.spent ?? 0;
}

/** The account's cap, or the default where none was ever set. */
export async function capFor(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT spend_cap_usd AS cap FROM v2_users WHERE id=?`)
    .bind(userId)
    .first<{ cap: number | null }>();
  return capOrDefault(row?.cap);
}

/**
 * The gate itself.
 *
 * Reads two numbers and decides. A failure to read them is NOT a refusal:
 * a database hiccup should not stop somebody working, and the cap's job is
 * to catch a runaway over hours rather than to be the last word on any one
 * job. It is logged instead, where the alternative — everybody locked out by
 * a transient — is a worse failure than the one being prevented.
 */
export async function underCap(db: D1Database, userId: string, now = Date.now()): Promise<CapVerdict> {
  try {
    const [spentUsd, capUsd] = await Promise.all([spentThisMonth(db, userId, now), capFor(db, userId)]);
    return capVerdict({ spentUsd, capUsd });
  } catch (err) {
    console.log(`[spend] could not read the cap for ${userId}: ${err instanceof Error ? err.message : err}`);
    return { allowed: true, spentUsd: 0, capUsd: DEFAULT_CAP_USD, says: "The spend cap could not be checked." };
  }
}
