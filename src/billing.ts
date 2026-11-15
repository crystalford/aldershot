/**
 * Taking money.
 *
 * Plans and caps already existed and were already enforced — checkCap refuses
 * before work starts, and PLANS is the single source of both the numbers and
 * the price. What did not exist was any way for a customer to pay: Settings
 * showed "Upgrade to Studio" and the button did nothing at all.
 *
 * Stripe Checkout rather than card fields on our own page. Hosted checkout
 * keeps card numbers off this origin entirely — no PCI surface to reason
 * about, no card form to get subtly wrong — and it handles 3DS, wallets, tax
 * and receipts. The customer portal handles cancel, resume and card updates,
 * which is a whole surface we do not have to build or keep correct.
 *
 * The Stripe SDK is not used. It assumes Node, and this runs on Workers; the
 * three calls needed here are form-encoded POSTs to a REST API, which is less
 * code than the shim would be.
 *
 * WHAT MAKES A SUBSCRIPTION REAL IS THE WEBHOOK, NOT THE REDIRECT.
 * A customer returning to the success URL proves only that they reached a URL,
 * which anyone can do by typing it. The plan is written when Stripe tells us
 * out-of-band that money moved, and that message is verified by signature
 * before it is believed.
 */

import { safeEqual } from "./auth.ts";
import type { Plan } from "./plans.ts";
import type { User } from "./user.ts";

export interface BillingEnv {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  /** The recurring price the Studio plan is sold at. */
  STRIPE_PRICE_ID?: string;
  /** Signing secret for the webhook endpoint. Without it, nothing is believed. */
  STRIPE_WEBHOOK_SECRET?: string;
  APP_ORIGIN?: string;
}

/** Is billing switched on? Every surface asks before offering to charge. */
export function billingReady(env: BillingEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

const API = "https://api.stripe.com/v1";

/**
 * A form-encoded POST to Stripe.
 *
 * Nested keys use Stripe's bracket syntax ("subscription_data[metadata][x]"),
 * which is why the params are a flat map of already-shaped keys rather than an
 * object we would have to walk.
 */
async function stripe<T>(
  env: BillingEnv,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    /* Stripe's own message is far more use than a status code — "No such
       price" tells you exactly what is misconfigured. It is logged rather
       than shown, since it can name internal ids. */
    let detail = text.slice(0, 300);
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
    } catch {
      /* not JSON; the raw text is the best we have */
    }
    console.log(`[billing] stripe ${path} failed: ${res.status} ${detail}`);
    throw new Error(detail);
  }
  return JSON.parse(text) as T;
}

/** The customer for this account, created on first need and remembered. */
async function customerFor(env: BillingEnv, user: User): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const made = await stripe<{ id: string }>(env, "/customers", {
    email: user.email,
    "metadata[user_id]": user.id,
  });
  await env.DB
    .prepare(`UPDATE v2_users SET stripe_customer_id=? WHERE id=?`)
    .bind(made.id, user.id)
    .run();
  return made.id;
}

/**
 * Where to send someone who wants to subscribe.
 *
 * client_reference_id AND the customer's own metadata both carry the user id,
 * because the webhook has to map a payment back to an account and the two
 * events that matter carry different shapes. Belt and braces on the one join
 * that must never be wrong.
 */
export async function checkoutUrl(env: BillingEnv, user: User, origin: string): Promise<string> {
  const customer = await customerFor(env, user);
  const session = await stripe<{ url: string }>(env, "/checkout/sessions", {
    mode: "subscription",
    customer,
    "line_items[0][price]": env.STRIPE_PRICE_ID as string,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    "subscription_data[metadata][user_id]": user.id,
    /* Stripe collects and remits VAT/sales tax where it is owed. Getting this
       wrong is a liability rather than a bug, and it cannot be added
       retroactively to subscriptions already sold. */
    "automatic_tax[enabled]": "true",
    "customer_update[address]": "auto",
    allow_promotion_codes: "true",
    success_url: `${origin}/settings?paid=1`,
    cancel_url: `${origin}/settings`,
  });
  return session.url;
}

/** Where to send an existing subscriber to cancel or change their card. */
export async function portalUrl(env: BillingEnv, user: User, origin: string): Promise<string> {
  const customer = await customerFor(env, user);
  const session = await stripe<{ url: string }>(env, "/billing_portal/sessions", {
    customer,
    return_url: `${origin}/settings`,
  });
  return session.url;
}

/**
 * Verifies a webhook signature.
 *
 * The header is `t=<unix>,v1=<hex>,v1=<hex>…` — more than one v1 during a
 * secret rotation, so every one is checked rather than only the first. The
 * signed payload is the timestamp, a dot, and the RAW body: re-serialising
 * parsed JSON changes bytes and every signature then fails.
 *
 * The timestamp is checked too. Without it a valid old event can be replayed
 * for ever, which for a downgrade event means an account that cannot stay
 * upgraded.
 */
const TOLERANCE_S = 300;

export async function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!header) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") timestamp = v ?? "";
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return signatures.some((sig) => safeEqual(sig, expected));
}

/** Stripe subscription statuses that mean "this account has paid". */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
  /** Seconds since the epoch, from Stripe. The only ordering it gives. */
  created?: number;
}

/**
 * Applies a verified event.
 *
 * Only the plan column is touched, because the plan is the only thing the rest
 * of the product reads — checkCap and the Settings meters both key off it, so
 * a correct plan is a correct entitlement everywhere with nothing else to keep
 * in step.
 *
 * `past_due` still counts as entitled: a card that failed its renewal has not
 * cancelled, and Stripe retries for days. Cutting someone off mid-dunning is
 * how you turn a temporary card problem into a cancellation.
 */
export async function applyEvent(env: BillingEnv, event: StripeEvent): Promise<string> {
  const obj = event.data.object;

  const userId =
    (obj.client_reference_id as string | undefined) ??
    ((obj.metadata as Record<string, string> | undefined)?.user_id);

  const customerId = typeof obj.customer === "string" ? obj.customer : undefined;

  /* The account this event belongs to. Metadata is preferred because it is
     what we set; the customer id is the fallback for events that carry no
     metadata of their own. */
  const user = userId
    ? await env.DB.prepare(`SELECT * FROM v2_users WHERE id=?`).bind(userId).first<User>()
    : customerId
      ? await env.DB.prepare(`SELECT * FROM v2_users WHERE stripe_customer_id=?`).bind(customerId).first<User>()
      : null;

  if (!user) return `ignored ${event.type}: no account`;

  let plan: Plan | null = null;

  if (event.type === "checkout.session.completed") {
    plan = "studio";
    if (customerId && !user.stripe_customer_id) {
      await env.DB.prepare(`UPDATE v2_users SET stripe_customer_id=? WHERE id=?`).bind(customerId, user.id).run();
    }
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    plan = ENTITLED.has(String(obj.status)) ? "studio" : "free";
  } else if (event.type === "customer.subscription.deleted") {
    plan = "free";
  } else {
    return `ignored ${event.type}`;
  }

  /* The owner is never downgraded by a Stripe event. Their plan is granted by
     who they are, not by a subscription, and a stray test event must not lock
     them out of their own product. */
  if (user.is_owner) return `skipped ${event.type}: owner`;

  /*
   * OUT OF ORDER IS THE ONE THAT COSTS MONEY.
   *
   * Stripe does not guarantee delivery order. Cancel a subscription and it
   * sends `updated` (active) and then `deleted`; arriving the other way
   * round, the `updated` re-granted the plan and the account stayed on studio
   * for ever, paying nothing. Nothing here noticed, because each event is
   * correct on its own.
   *
   * `created` is the ordering Stripe does give. An event older than the last
   * one applied is ignored, and the comparison is strict: a retry of the same
   * event carries the same timestamp and must still land, because a retry
   * after a slow 200 is normal and the result is the same either way.
   *
   * AN EVENT WITH NO TIMESTAMP IS STILL APPLIED. Ordering is a refinement,
   * not a gate; the alternative is a paid account that never gets its plan
   * because a field was missing.
   */
  const at = typeof event.created === "number" ? event.created : null;
  const seen = (user as User & { billing_event_at?: number | null }).billing_event_at ?? null;
  if (at !== null && seen !== null && at < seen) {
    return `ignored ${event.type}: older than the last event applied`;
  }

  await env.DB.prepare(`UPDATE v2_users SET plan=?, billing_event_at=? WHERE id=?`)
    .bind(plan, at ?? seen, user.id)
    .run();
  return `${event.type}: ${user.id} → ${plan}`;
}
