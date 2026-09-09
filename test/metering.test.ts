/**
 * "A job that does not meter is a bug" — src/usage.ts, quoting
 * 04-API-AND-JOBS.md. It is a rule the codebase states and nothing enforced,
 * and it was broken within hours of being quoted: arrangePass was written,
 * spent real tokens, and metered nothing at all.
 *
 * These read the source rather than run it, the same way
 * test/intent-dispatch.test.ts does — runScore needs env.AI, a queue and a
 * database, and the property worth protecting is structural: every path that
 * buys neurons writes a row saying so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const begin = () => readFileSync(join(import.meta.dirname, "..", "src", "begin.ts"), "utf8");

/** The body of one function, from its signature to the next top-level one. */
function body(src: string, signature: string): string {
  const i = src.indexOf(signature);
  assert.ok(i >= 0, `couldn't find ${signature}`);
  const rest = src.slice(i + signature.length);
  const end = rest.search(/\n(export )?(async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
}

test("a reorder pass meters what it spent", () => {
  /* It did not. It called the model, recorded the pass and finished the job
     without writing a usage row, so a whole class of instruction was free on
     the cost panel and invisible in the ledger. */
  const arrange = body(begin(), "async function arrangePass(");
  assert.match(arrange, /await meter\(/, "arrangePass buys tokens and must record them");
  assert.match(arrange, /job_type: "pass"/, "a reorder is a pass, like every other instruction");
  assert.match(arrange, /tokens_in: out\.tokensIn/, "it must meter what it actually spent");
});

test("a pass that dies after the model answered still records the spend", () => {
  /* meter() sat on the happy path and failJob touches only the jobs row, so
     tokens already bought vanished from the ledger whenever anything after the
     model call threw. The cost panel understated every failure. */
  const score = body(begin(), "export async function runScore(");
  const failure = score.slice(score.indexOf("} catch (err)"));
  assert.match(failure, /await meter\(/, "the catch must record what was already bought");
  assert.match(failure, /outcome: "failed"/, "and say that is what it was");
  assert.match(
    score,
    /const spent = \{ tokensIn: 0, tokensOut: 0 \}/,
    "the token count has to live outside the try or the catch cannot see it",
  );
});

test("the ledger says whether the money bought anything", () => {
  /* Deliberately not a discount. The neurons cost the same whether a pass
     found eight moments or none; zeroing the row would make the ledger
     understate real spend, which is a lie in the other direction. */
  const score = body(begin(), "export async function runScore(");
  assert.match(
    score,
    /outcome: result\.clips\.length \? "found" : "empty"/,
    "a scoring pass must say whether it found anything",
  );
});

test("nothing zeroes the tokens to avoid a charge", () => {
  const src = begin();
  assert.ok(
    !/tokens_in: 0,\s*tokens_out: 0/.test(src),
    "spend is recorded honestly; an outcome of 'empty' is how a fruitless pass is marked",
  );
});

/* ── what the ledger says a container costs ──────────────────────────── */

test("container time is priced by the shape of the machine, not one flat rate", async () => {
  /*
   * THE LEDGER AND THE INVOICE HAVE TO AGREE.
   *
   * cpu_ms is wall-clock — every caller computes Date.now() - t0 — and that is
   * the right measurement, because Cloudflare bills memory and disk on the
   * PROVISIONED size of the instance for every second it is awake. What was
   * wrong was the rate: one flat per-CPU-second figure, blind to a standard-4
   * reserving 12 GiB and 20 GB the whole time.
   */
  const { computeCost, PRICES } = await import("../src/usage.ts");

  const hour = { user_id: "u", cpu_ms: 3_600_000 } as const;
  const render = computeCost({ ...hour, job_type: "render" }, PRICES);

  /* 12 GiB + 20 GB of disk, awake for an hour, at Cloudflare's published
     rates. Not an approximation — it is the billing rule arithmetic. */
  const expected = 3600 * (12 * 0.0000025 + 20 * 0.00000007);
  assert.ok(Math.abs(render - expected) < 1e-9, `expected ${expected}, got ${render}`);

  /* Dearer than the flat rate it replaced, or nothing changed — by about
     1.57x, which is the honest figure. The 5.6x sometimes quoted assumes a
     CPU-saturated container, and the invoice says vCPU was 0.4% of container
     spend, so that is not the machine this product runs. */
  const flat = 3600 * PRICES.usd_per_cpu_second;
  assert.ok(render > flat * 1.5, "a standard-4 hour must cost more than the old flat rate");
  assert.ok(render < flat * 2, "and not so much more that vCPU has crept back in");
});

test("a row priced before those rates existed still recomputes as it was billed", async () => {
  /*
   * Prices are snapshotted per row precisely so history does not move when
   * they change (src/usage.ts). A row written last week carries a PRICES
   * object with no per-GiB rate in it, and must fall back to what it was
   * actually charged rather than being silently restated upward.
   */
  const { computeCost, PRICES } = await import("../src/usage.ts");
  const old = { ...PRICES } as Record<string, unknown>;
  delete old.usd_per_gib_second;
  delete old.usd_per_disk_gb_second;

  const then = computeCost({ user_id: "u", job_type: "render", cpu_ms: 3_600_000 }, old as never);
  assert.equal(then, 3600 * PRICES.usd_per_cpu_second, "history must not be rewritten");
});

test("a short and a failed export are not free", async () => {
  /*
   * A short is a full encode on a standard-4 with a fifteen-minute ceiling and
   * it recorded bytes_stored and nothing else — $0.00 of compute. A failed
   * export recorded nothing at all, so the expensive failures were the
   * invisible ones, which is exactly the wrong way round.
   *
   * Structural, like the rest of this file: what matters is that the call
   * sites pass container time, not what any particular encode cost.
   */
  const src = (f: string) => readFileSync(join(import.meta.dirname, "..", "src", f), "utf8");

  const short = src("short-render.ts");
  /* BOTH occurrences must carry the time, not just one. Written loosely first,
     this matched the failure path and happily passed while the success path —
     the one that runs every time a short is made — had lost its cpu_ms. */
  assert.equal((short.match(/job_type: "shorts"/g) ?? []).length, 2,
    "both the success and the failure path must meter");
  assert.equal((short.match(/job_type: "shorts",\s*\n\s*cpu_ms:/g) ?? []).length, 2,
    "and both must bill the container time they burned");

  const render = src("render-job.ts");
  assert.match(render, /outcome: "failed"/, "a failed export must bill the time it burned");

  /* And a dictation makes a real Whisper call; source_minutes: 0 multiplied
     the neuron rate by nothing and booked exactly $0.00. */
  assert.doesNotMatch(
    src("index.ts"),
    /job_type: "transcribe", source_minutes: 0/,
    "a real model call must not be metered as zero minutes",
  );
});
