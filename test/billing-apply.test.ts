/**
 * THE FUNCTION THAT GRANTS AND REMOVES THE PLAN.
 *
 * test/billing.test.ts has eight tests and every one is about whether a
 * webhook's signature can be believed — which is the right thing to be
 * paranoid about and is NOT the thing that decides what somebody has paid
 * for. `applyEvent` is what moves a row between free and studio, and it had
 * no test at all.
 *
 * docs/LAUNCH.md names the property to verify: "the plan is granted by the
 * webhook, not by the redirect". That is one of these. The rest are the ways
 * a billing integration goes wrong quietly — an event for somebody else's
 * customer, a replay, an arrival out of order, and the owner's own account
 * being locked out of the product by a stray test event.
 *
 * Driven against real SQLite through the same fake D1 the rest of the
 * destructive code uses, because what matters is the ROW afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeD1 } from "./helpers/fake-d1.ts";
import { applyEvent } from "../src/billing.ts";

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../migrations/schema.sql"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function db(rows: Array<{ id: string; email: string; plan?: string; owner?: boolean; customer?: string }>) {
  const d = new DatabaseSync(":memory:");
  const ddl = SCHEMA.split(";").find((s) => /create table if not exists v2_users\s*\(/i.test(s));
  assert.ok(ddl, "migrations/schema.sql has no v2_users — run `npm run schema`");
  d.exec(ddl + ";");
  /* stripe_customer_id is added by the ALTER list rather than the CREATE, so
     the test adds it the same way the product does. */
  d.exec("ALTER TABLE v2_users ADD COLUMN stripe_customer_id TEXT");
  d.exec("ALTER TABLE v2_users ADD COLUMN billing_event_at INTEGER");
  const ins = d.prepare(
    "INSERT INTO v2_users (id, email, plan, is_owner, stripe_customer_id, created_at) VALUES (?,?,?,?,?,1)",
  );
  for (const r of rows) ins.run(r.id, r.email, r.plan ?? "free", r.owner ? 1 : 0, r.customer ?? null);
  return d;
}

const planOf = (d: DatabaseSync, id: string) =>
  (d.prepare("SELECT plan FROM v2_users WHERE id=?").get(id) as { plan: string } | undefined)?.plan;

const customerOf = (d: DatabaseSync, id: string) =>
  (d.prepare("SELECT stripe_customer_id AS c FROM v2_users WHERE id=?").get(id) as { c: string | null } | undefined)?.c;

const event = (type: string, object: Record<string, unknown>) => ({ type, data: { object } });

/* ── Granting ───────────────────────────────────────────────────────────── */

test("a completed checkout moves the account to studio, and remembers the customer", async () => {
  const raw = db([{ id: "u1", email: "a@b.c" }]);
  const env = { DB: fakeD1(raw) } as never;

  const said = await applyEvent(env, event("checkout.session.completed", { client_reference_id: "u1", customer: "cus_1" }));
  assert.equal(planOf(raw, "u1"), "studio");
  assert.equal(customerOf(raw, "u1"), "cus_1", "so later events with no metadata still find them");
  assert.match(said, /u1 → studio/);
});

test("the account is found by metadata when there is no client_reference_id", async () => {
  const raw = db([{ id: "u1", email: "a@b.c" }]);
  const env = { DB: fakeD1(raw) } as never;
  await applyEvent(env, event("checkout.session.completed", { metadata: { user_id: "u1" }, customer: "cus_1" }));
  assert.equal(planOf(raw, "u1"), "studio");
});

test("and by the customer id, which is all a subscription event carries", async () => {
  const raw = db([{ id: "u1", email: "a@b.c", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  await applyEvent(env, event("customer.subscription.created", { customer: "cus_1", status: "active" }));
  assert.equal(planOf(raw, "u1"), "studio");
});

test("every status Stripe calls entitled grants the plan", async () => {
  /* active, trialing and past_due. past_due is deliberate: a card that failed
     this morning is not a reason to take somebody's work away mid-edit —
     Stripe will cancel it if it stays unpaid, and THAT is the event that
     downgrades. */
  for (const status of ["active", "trialing", "past_due"]) {
    const raw = db([{ id: "u1", email: "a@b.c", customer: "cus_1" }]);
    const env = { DB: fakeD1(raw) } as never;
    await applyEvent(env, event("customer.subscription.updated", { customer: "cus_1", status }));
    assert.equal(planOf(raw, "u1"), "studio", `${status} is entitled`);
  }
});

/* ── Removing ───────────────────────────────────────────────────────────── */

test("a deleted subscription takes the plan away", async () => {
  const raw = db([{ id: "u1", email: "a@b.c", plan: "studio", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  await applyEvent(env, event("customer.subscription.deleted", { customer: "cus_1" }));
  assert.equal(planOf(raw, "u1"), "free");
});

test("a status Stripe does not call entitled takes it away too", async () => {
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
    const raw = db([{ id: "u1", email: "a@b.c", plan: "studio", customer: "cus_1" }]);
    const env = { DB: fakeD1(raw) } as never;
    await applyEvent(env, event("customer.subscription.updated", { customer: "cus_1", status }));
    assert.equal(planOf(raw, "u1"), "free", `${status} is not entitled`);
  }
});

/* ── The ways it goes wrong quietly ─────────────────────────────────────── */

test("an event for a customer we do not have changes nothing and creates nobody", async () => {
  const raw = db([{ id: "u1", email: "a@b.c" }]);
  const env = { DB: fakeD1(raw) } as never;
  const said = await applyEvent(env, event("checkout.session.completed", { customer: "cus_somebody_else" }));
  assert.match(said, /no account/);
  assert.equal(planOf(raw, "u1"), "free");
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM v2_users").get() as { n: number }).n, 1, "no row invented");
});

test("an event type we do not handle is ignored rather than guessed at", async () => {
  const raw = db([{ id: "u1", email: "a@b.c", plan: "studio", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  const said = await applyEvent(env, event("invoice.payment_failed", { customer: "cus_1" }));
  assert.match(said, /ignored/);
  assert.equal(planOf(raw, "u1"), "studio", "a payment failure is not a cancellation");
});

test("replaying the same event changes nothing the second time", async () => {
  /* Stripe retries, and a retry after a 200 that was slow to arrive is
     normal. Applying the grant twice must land in the same place. */
  const raw = db([{ id: "u1", email: "a@b.c" }]);
  const env = { DB: fakeD1(raw) } as never;
  const e = event("checkout.session.completed", { client_reference_id: "u1", customer: "cus_1" });
  await applyEvent(env, e);
  await applyEvent(env, e);
  assert.equal(planOf(raw, "u1"), "studio");
  assert.equal(customerOf(raw, "u1"), "cus_1");
});

test("THE OWNER IS NEVER MOVED BY A STRIPE EVENT, in either direction", async () => {
  /*
   * Their plan is granted by who they are. A stray test event — and test
   * events are exactly what an owner generates while setting billing up —
   * must not lock them out of their own product.
   */
  const raw = db([{ id: "owner", email: "owner@x.y", plan: "studio", owner: true, customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;

  for (const e of [
    event("customer.subscription.deleted", { customer: "cus_1" }),
    event("customer.subscription.updated", { customer: "cus_1", status: "canceled" }),
    event("checkout.session.completed", { customer: "cus_1" }),
  ]) {
    const said = await applyEvent(env, e);
    assert.match(said, /owner/);
    assert.equal(planOf(raw, "owner"), "studio", `${e.type} left the owner alone`);
  }
});

test("the plan is granted by the webhook, not by anything the browser does", () => {
  /*
   * docs/LAUNCH.md names this as the thing to verify. It is a property of the
   * SOURCE, so it is asserted there: the only place in src/ that writes
   * v2_users.plan from a billing path is applyEvent, which runs behind
   * verifyWebhook. If a redirect handler ever starts writing the plan, this
   * goes red.
   */
  const dir = dirname(fileURLToPath(import.meta.url));
  const billing = readFileSync(join(dir, "..", "src", "billing.ts"), "utf8");
  const index = readFileSync(join(dir, "..", "src", "index.ts"), "utf8");

  assert.match(billing, /applyEvent[\s\S]*UPDATE v2_users SET plan=\?/, "applyEvent is what writes it");

  /* Nothing on a GET route writes the plan. The success URL is a GET. */
  const writesPlan = [...index.matchAll(/UPDATE v2_users SET plan\s*=/g)];
  assert.equal(writesPlan.length, 0, "no route in index.ts grants a plan directly");
});

/* ── Out of order, which Stripe says to expect ──────────────────────────── */

test("a late 'updated' arriving after a 'deleted' does not restore the plan", async () => {
  /*
   * Stripe does not guarantee delivery order, and says so. The sequence that
   * costs money is: the subscription is cancelled, Stripe sends `updated`
   * (active) and then `deleted`, and the two arrive the other way round. The
   * account ends on studio for ever, paying nothing.
   *
   * `created` on the event is the ordering Stripe DOES give, so the last one
   * applied is remembered and anything older than it is ignored.
   */
  const raw = db([{ id: "u1", email: "a@b.c", plan: "studio", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;

  await applyEvent(env, { ...event("customer.subscription.deleted", { customer: "cus_1" }), created: 2_000 });
  assert.equal(planOf(raw, "u1"), "free", "the cancellation lands");

  await applyEvent(env, {
    ...event("customer.subscription.updated", { customer: "cus_1", status: "active" }),
    created: 1_000,
  });
  assert.equal(planOf(raw, "u1"), "free", "and the older event does not undo it");
});

test("an event with no timestamp is still applied, rather than being dropped", async () => {
  /* Ordering is a refinement, not a gate. An event we cannot order is better
     applied than ignored — the alternative is a paid account that never gets
     its plan because a field was missing. */
  const raw = db([{ id: "u1", email: "a@b.c", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  await applyEvent(env, event("customer.subscription.updated", { customer: "cus_1", status: "active" }));
  assert.equal(planOf(raw, "u1"), "studio");
});

test("the same event delivered twice lands in the same place", async () => {
  const raw = db([{ id: "u1", email: "a@b.c", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  const e = { ...event("customer.subscription.updated", { customer: "cus_1", status: "active" }), created: 5_000 };
  await applyEvent(env, e);
  await applyEvent(env, e);
  assert.equal(planOf(raw, "u1"), "studio", "a retry lands in the same place");
});

test("TWO EVENTS IN THE SAME SECOND BOTH APPLY, which is why the test is `<`", async () => {
  /*
   * Stripe's `created` is in SECONDS, and cancelling a subscription commonly
   * produces `updated` and `deleted` inside the same one. A guard written
   * `<=` instead of `<` drops the second of any such pair — so the
   * cancellation would be the one thrown away and the account would stay on
   * studio, which is the exact failure the guard was added to prevent.
   *
   * The retry test above cannot catch that: it applies the SAME event twice,
   * and the plan is already where it should be after the first. This is the
   * assertion that pins the comparison, found by breaking `<` to `<=` and
   * watching every test stay green.
   */
  const raw = db([{ id: "u1", email: "a@b.c", plan: "studio", customer: "cus_1" }]);
  const env = { DB: fakeD1(raw) } as never;
  const t = 9_000;

  await applyEvent(env, { ...event("customer.subscription.updated", { customer: "cus_1", status: "active" }), created: t });
  assert.equal(planOf(raw, "u1"), "studio");

  await applyEvent(env, { ...event("customer.subscription.deleted", { customer: "cus_1" }), created: t });
  assert.equal(planOf(raw, "u1"), "free", "the cancellation in the same second still lands");
});
