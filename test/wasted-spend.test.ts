/**
 * WHAT THE MONTH SPENT AND GOT NOTHING FOR.
 *
 * Decision 38 is "charge for what drives cost; absorb the failed attempts",
 * so every failure is on the business rather than the customer. Nothing
 * counted them. `usage_events.outcome` was written by five call sites —
 * begin, queue's judge, render-job, and now proxy — and read by none:
 * `monthUsage`, commented as "the cost panel's only source", grouped by
 * `job_type` alone. In the development database 9,702 of 9,703 rows have no
 * outcome at all, and the one question a cost panel exists to answer could
 * not be answered from them.
 *
 * The failure to guard against is a rollup that silently stops separating
 * them, or a total that moves because of this — the headline figure has to
 * stay every dollar spent, because that is what the bill will say.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fakeD1, schema } from "./helpers/fake-d1.ts";
import { monthUsage } from "../src/usage.ts";
import { renderSettings, type SettingsData } from "../src/ui/pages/settings.ts";

const USER = "u1";
const SINCE = 1_000;

function bench() {
  const sqlite = new DatabaseSync(":memory:");
  schema(sqlite);
  let n = 0;
  const row = (job_type: string, cost: number, outcome: string | null, at = SINCE + 1) => {
    n += 1;
    sqlite
      .prepare(
        `INSERT INTO usage_events (id,user_id,job_id,job_type,source_minutes,cpu_ms,gpu_ms,
           tokens_in,tokens_out,bytes_stored,bytes_delivered,stream_minutes_stored,
           stream_minutes_delivered,unit_prices,cost_usd,outcome,created_at)
         VALUES (?,?,NULL,?,0,0,0,0,0,0,0,0,0,'{}',?,?,?)`,
      )
      .run(`u-${n}`, USER, job_type, cost, outcome, at);
  };
  return { DB: fakeD1(sqlite) as unknown as D1Database, row };
}

test("spend that bought nothing is counted on its own, and not deducted", async () => {
  const b = bench();
  b.row("transcribe", 1.0, "found");
  b.row("proxy", 0.25, "failed");
  b.row("proxy", 0.15, "failed");

  const roll = await monthUsage(b.DB, USER, SINCE);
  assert.equal(roll.wasted.count, 2);
  assert.ok(Math.abs(roll.wasted.cost - 0.4) < 1e-9);
  /* Every dollar spent, because that is what the bill says. */
  assert.ok(Math.abs(roll.total - 1.4) < 1e-9);
});

test("a pass that honestly found nothing is not waste", async () => {
  /* "empty" means it ran and there was nothing there — an answer, and one
     worth paying for. Only "failed" is money for nothing. */
  const b = bench();
  b.row("pass", 0.5, "empty");
  b.row("pass", 0.5, null);
  const roll = await monthUsage(b.DB, USER, SINCE);
  assert.equal(roll.wasted.count, 0);
  assert.equal(roll.wasted.cost, 0);
  assert.ok(Math.abs(roll.total - 1.0) < 1e-9);
});

test("the per-type breakdown still sums every outcome of a type together", async () => {
  /*
   * The panel's existing lines are per job type. Grouping by outcome as well
   * splits each type across rows, and summing them back is what keeps the
   * breakdown and the headline the figures they already were.
   */
  const b = bench();
  b.row("proxy", 0.10, "found");
  b.row("proxy", 0.20, "failed");
  b.row("transcribe", 0.05, "found");

  const roll = await monthUsage(b.DB, USER, SINCE);
  const proxy = roll.lines.find((l) => l.job_type === "proxy");
  assert.ok(proxy, "proxy is missing from the breakdown");
  assert.equal(proxy.count, 2);
  assert.ok(Math.abs(proxy.cost - 0.3) < 1e-9);
  /* Sorted by cost, so the biggest line is first — unchanged behaviour. */
  assert.equal(roll.lines[0].job_type, "proxy");

  /*
   * AND THE SPLIT, ASSERTED HERE, which is what makes this test pin the
   * GROUP BY rather than merely the sum.
   *
   * Removing `, outcome` from the grouping left every test in this file
   * green when it was broken on purpose: the two failed rows elsewhere
   * collapse into one group whose outcome SQLite happens to pick as
   * "failed", so the totals came out right by luck. One found and one
   * failed row of the SAME type cannot survive that — the group's single
   * outcome is then either wrong or arbitrary, and both are caught.
   */
  assert.equal(roll.wasted.count, 1, "one of the two proxies failed, not both or neither");
  assert.ok(Math.abs(roll.wasted.cost - 0.2) < 1e-9);
});

test("rows from before the month are not in it", async () => {
  const b = bench();
  b.row("proxy", 9.99, "failed", SINCE - 1);
  const roll = await monthUsage(b.DB, USER, SINCE);
  assert.equal(roll.wasted.count, 0);
  assert.equal(roll.total, 0);
});

/* ── The line the owner reads ─────────────────────────────────────────── */

const settings = (wasted: { cost: number; count: number }): string =>
  renderSettings({
    name: "Someone",
    email: "someone@example.com",
    plan: "pro",
    isOwner: true,
    connections: [],
    meters: [],
    billingReady: true,
    trash: [],
    slo: null,
    cost: {
      lines: [{ label: "Transcribe + align", amount: 1.2, color: "#5EB8C9", note: "per source minute" }],
      total: 1.2,
      finished: 2,
      dayOfMonth: 9,
      cache: { rows: 0, hits: 0 },
      wasted,
    },
  } as unknown as SettingsData);

test("the panel says what bought nothing, and says nothing when nothing did", () => {
  const bad = settings({ cost: 0.42, count: 31 });
  assert.match(bad, /\$0\.42/);
  assert.match(bad, /of that bought nothing/);
  assert.match(bad, /31 attempts/);

  /*
   * Same rule as the cache line: it appears when it has a number. "$0.00
   * wasted" on a clean month reads as a warning rather than as the good news
   * it is.
   */
  const clean = settings({ cost: 0, count: 0 });
  assert.ok(!/bought nothing/.test(clean), "a clean month must not report waste");
});

test("one failure is not called attempts", () => {
  assert.match(settings({ cost: 0.01, count: 1 }), /1 attempt<\/span>/);
});

/**
 * What the gate's copy check can actually see, by its own rule.
 *
 * scripts/check-fidelity.cjs's scanCopy reads the text immediately following
 * an OPENING tag and skips any element carrying `data-content`. Mirrored here
 * rather than approximated, because the claim being pinned is "the gate can
 * see this wording" and an approximation of the extractor pins something else.
 */
function gateCanSee(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<([a-z]+)([^>]*)>([^<>]+)(?=<)/g)) {
    if (/\bdata-content\b/.test(m[2])) continue;
    const text = m[3].replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

test("the wording is checked, and only the figures are exempt", () => {
  /*
   * `data-content` exempts an element from the copy check. On the whole
   * sentence it would hide the wording from the gate — which is what the
   * cache line beside it does, and what this deliberately does not.
   *
   * THIS TEST DID NOT PIN THAT. Its first version asserted that no marked
   * element contained "bought nothing", so marking the OTHER half of the
   * sentence — "that failed. Absorbed rather than charged on…" — left it
   * green. CLAUDE.md: a break that does not fail the test means the test was
   * not pinning its claim, so fix the test.
   *
   * Both static runs are named, and they are checked against the extractor
   * the gate really uses — so hiding either one behind data-content, or
   * restructuring the markup so a run no longer follows an opening tag, goes
   * red here.
   */
  const html = settings({ cost: 0.42, count: 31 });
  const visible = gateCanSee(html);
  for (const words of [
    "of that bought nothing &mdash;",
    "that failed. Absorbed rather than charged on, which is what makes it worth watching.",
  ]) {
    assert.ok(
      visible.includes(words),
      `the gate cannot see ${JSON.stringify(words)} — it is hidden from the copy check`,
    );
  }

  const marked = [...html.matchAll(/<span data-content>([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.ok(marked.includes("$0.42"), "the figure should be marked as data");
  assert.ok(
    !marked.some((t) => t.includes("bought nothing")),
    "the wording must not be inside a data-content element",
  );
});
