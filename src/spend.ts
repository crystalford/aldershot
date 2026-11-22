/**
 * THE MONTHLY SPEND CAP, AND THE ONE LIMIT A PERSON SETS.
 *
 * Two numbers, one setting (doc 22, row 4; the owner's choice, 22 Nov). The
 * canvas has one limit in Settings, $50 by default, covering what is
 * generated for you — "reading footage and editing are never counted against
 * it". This file already had a cap over everything, $400 of running costs,
 * as a brake on runaway work. Both stay, and only the first is a setting:
 *
 *   - THE LIMIT is the person's: what they are charged for generated things
 *     this month, against a number they pick. It gates generation and
 *     nothing else. See LIMITED_JOBS.
 *   - THE BRAKE is the product's: what all their work has cost to run,
 *     against DEFAULT_CAP_USD plus what the limit allows to be spent on
 *     generating. It gates every dispatched job, as before. It is not a
 *     second setting, but it moves when the limit does — so a person stopped
 *     by it has something to do, which is the lesson setCap's history
 *     taught this file (below).
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
          : `This month's work has cost ${money(spentUsd)} to run, and ${money(capUsd)} is as far as your monthly limit lets it go. Nothing else will run until you raise it in Settings.`,
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

/**
 * The account's brake: the default, plus what its limit lets generation cost
 * to run. A limit raised for a heavy month of generating must not walk the
 * person straight into the brake on that same work.
 *
 * `spend_cap_usd` is no longer read. It was settable for a while; a stored
 * zero there would now be a stop nobody could lift, which is the exact
 * failure setCap was written to end.
 */
export const brakeFor = (limitUsd: number): number => DEFAULT_CAP_USD + Math.max(0, limitUsd) / CHARGE_MULTIPLE;

export async function capFor(db: D1Database, userId: string): Promise<number> {
  return brakeFor(await limitFor(db, userId));
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

/* ── The limit ─────────────────────────────────────────────────────────── */

/**
 * What a month of generated pictures and voices may be charged, before
 * anything is set. The canvas's figure: enough for a film's worth of moving
 * stills and a few clips at doc 10's prices, low enough that nobody finds a
 * surprise on a card.
 */
export const DEFAULT_LIMIT_USD = 50;

/** The most a limit can be set to. A typo is not a policy. */
export const MAX_LIMIT_USD = 10_000;

/**
 * What a person is charged, as a multiple of what the job cost to run.
 * Decision 38: generated work is metered at about three times its cost,
 * which is what pays for the drafts that are thrown away for free.
 */
export const CHARGE_MULTIPLE = 3;

/**
 * THE JOBS THE LIMIT COUNTS, and only these. Today that is a generated voice
 * (text to speech), the one thing this product generates; generated pictures
 * join when generation lands (doc 22, row 8). Reading footage, Scout, the
 * render — the things "editing is free" covers — never count, which is the
 * canvas's promise in so many words.
 */
export const LIMITED_JOBS = ["tts"] as const;

export const limitOrDefault = (usd: number | null | undefined): number =>
  usd === null || usd === undefined || !Number.isFinite(usd) ? DEFAULT_LIMIT_USD : Math.max(0, usd);

/** What the limited jobs have been charged this month. */
export async function chargedThisMonth(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  const marks = LIMITED_JOBS.map(() => "?").join(",");
  const row = await db
    .prepare(`SELECT SUM(cost_usd) AS spent FROM usage_events WHERE user_id=? AND created_at>=? AND job_type IN (${marks})`)
    .bind(userId, monthStart(now), ...LIMITED_JOBS)
    .first<{ spent: number | null }>();
  return (row?.spent ?? 0) * CHARGE_MULTIPLE;
}

export async function limitFor(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT gen_limit_usd AS lim FROM v2_users WHERE id=?`)
    .bind(userId)
    .first<{ lim: number | null }>();
  return limitOrDefault(row?.lim);
}

/**
 * May this account generate something more this month?
 *
 * `>=`, for capVerdict's reason. And a limit of zero is a real setting with
 * its own sentence: "nothing generated" is a fine way to make a film.
 */
export function limitVerdict(o: { chargedUsd: number; limitUsd: number | null | undefined }): CapVerdict {
  const capUsd = limitOrDefault(o.limitUsd);
  const spentUsd = Number.isFinite(o.chargedUsd) ? Math.max(0, o.chargedUsd) : 0;
  if (spentUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd,
      capUsd,
      says:
        capUsd === 0
          ? "Your monthly limit is set to nothing, so nothing will be generated. Raise it in Settings when you want some."
          : `Generated pictures and voices have come to ${money(spentUsd)} this month, which is your limit. Nothing more will be generated until you raise it in Settings.`,
    };
  }
  return { allowed: true, spentUsd, capUsd, says: `${money(spentUsd)} of your ${money(capUsd)} limit this month.` };
}

/** The gate in front of generation. Failing to read is not a refusal, as with underCap. */
export async function underLimit(db: D1Database, userId: string, now = Date.now()): Promise<CapVerdict> {
  try {
    const [chargedUsd, limitUsd] = await Promise.all([chargedThisMonth(db, userId, now), limitFor(db, userId)]);
    return limitVerdict({ chargedUsd, limitUsd });
  } catch (err) {
    console.log(`[spend] could not read the limit for ${userId}: ${err instanceof Error ? err.message : err}`);
    return { allowed: true, spentUsd: 0, capUsd: DEFAULT_LIMIT_USD, says: "The monthly limit could not be checked." };
  }
}

/**
 * SETTING IT, which both refusals tell people to do.
 *
 * This file's history is the reason the brake moves with the limit: there
 * was once a setCap, written because the cap's refusal said "raise it in
 * Settings" and `spend_cap_usd` was read by capFor and written by nothing —
 * every account sat at the default, work stopped there, and the message
 * named a control that did not exist. The limit is now that control for
 * both numbers. Clamped rather than trusted; zero allowed and meant.
 */
export async function setLimit(db: D1Database, userId: string, usd: number): Promise<number> {
  const clamped = Number.isFinite(usd) ? Math.min(MAX_LIMIT_USD, Math.max(0, Math.round(usd))) : DEFAULT_LIMIT_USD;
  await db.prepare(`UPDATE v2_users SET gen_limit_usd = ? WHERE id = ?`).bind(clamped, userId).run();
  return clamped;
}
