/**
 * Settings — account, plan, and what the thing actually costs to run.
 *
 * "Every job writes what it burned — machine time, model tokens, storage,
 * delivery. Real spend, not a plan allowance, so pricing gets set from numbers
 * instead of guesses" (05-INFRA-AND-COSTS.md §Metering).
 *
 * The cost panel is OWNER ONLY and its numbers come from usage_events, which
 * every job writes a row to. Nothing on this surface is estimated: a category
 * with no events shows $0.00 rather than a plausible-looking figure.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";
import type { TrashRow } from "../../library-ops.ts";
import { PLANS } from "../../plans.ts";

export interface Meter {
  label: string;
  used: number;
  cap: number;
  unit: string;
  note: string;
  color: string;
  /** Metered but never blocked — the cap is not enforced, so it is not shown. */
  uncapped?: boolean;
}

export interface CostLine {
  label: string;
  amount: number;
  color: string;
  note: string;
}

export interface SettingsData {
  name: string | null;
  /** Which account this is. It was never shown anywhere. */
  email: string;
  plan: string;
  isOwner: boolean;
  /** Buckets this account has connected. Empty is the normal case. */
  connections?: Array<{ id: string; bucket: string; last_import_at: number | null }>;
  /**
   * WHETHER THIS PRODUCT IS WORKING. Owner-only, null for everyone else.
   *
   * Four readings and the pool rows behind one of them — see src/slo.ts for
   * why four and which four. Each carries a SENTENCE rather than only a
   * number, because the breaker's state is useless if nobody can see why: a
   * job that quietly finished on the free model is a job whose receipts are
   * tagged with a different model. Invariant 3 — the reason, not a score.
   */
  slo?: {
    canary: Reading;
    jobs: Reading;
    items: Reading;
    pools: Reading;
    poolRows: Array<{ pool: string; verdict: string; failures: number; lastSays: string | null }>;
  } | null;
  meters: Meter[];
  /** The monthly limit and what it has been charged this month. src/spend.ts. */
  limit: { usd: number; chargedUsd: number };
  /** Whether Stripe is configured. A button that cannot charge is not shown. */
  billingReady: boolean;
  /** What is in the bin, so the "deleted pile" the subtitle promises exists. */
  trash: TrashRow[];
  /** Null for anyone but the owner — the panel is not rendered at all. */
  cost: {
    lines: CostLine[];
    total: number;
    finished: number;
    dayOfMonth: number;
    /**
     * What the call cache has saved: answers kept, and times one was reused.
     *
     * Invariant 5 says footage is read and charged once, and a cached answer
     * is a call nobody paid for twice. A saving nobody can see is a saving
     * nobody believes, so the number goes beside the bill rather than in a
     * log — and it is a COUNT, not a dollar figure, because what a reused
     * answer would have cost depends on a token count we never spent.
     */
    cache: { rows: number; hits: number };
    /**
     * What the month paid for and got nothing from.
     *
     * Decision 38 is "charge for what drives cost; absorb the failed
     * attempts" — so every failure is on the business, and until
     * `monthUsage` read `usage_events.outcome` there was no way to see how
     * much it was absorbing. One number, beside the bill, in the same place
     * the cache saving is: a figure nobody can see is a figure nobody acts
     * on.
     */
    wasted: { cost: number; count: number };
  } | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function sectionLabel(text: string): string {
  return `<div style="margin-top:40px;font-size:${SIZE.body};font-weight:600;color:${C.ink45}">${text}</div>`;
}

function account(name: string | null, email: string): string {
  const initial = (name ?? email ?? "You").trim().charAt(0).toUpperCase() || "Y";
  /*
   * The EMAIL is shown, and the name can be set.
   *
   * Neither was true: this displayed a name the account might not have and
   * never said which account you were signed into. And the greeting on Home
   * reads "Good morning." with no name precisely because an address with no
   * separator yields no usable first name — with nowhere to type one, that
   * was permanent.
   */
  return `${sectionLabel("Account")}
  <div style="margin-top:16px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <span style="width:38px;height:38px;border-radius:50%;background:#2A2A31;display:flex;align-items:center;justify-content:center;font-size:${SIZE.body};color:${C.ink70};flex:none">${esc(initial)}</span>
    <div style="flex:1 1 160px;min-width:min(160px,100%)">
      <input id="acctName" value="${esc(name ?? "")}" placeholder="Your name" maxlength="60"
        style="width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;font-size:${SIZE.body};font-weight:500;color:${C.ink};padding:0;font-family:${FONT.ui}"/>
      <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px;font-family:${FONT.mono}">${esc(email)}</div>
    </div>
    <a href="/landing" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};flex:none;white-space:nowrap">Signed-out site</a>
    <!-- There was no way to sign out. Anywhere. A form post rather than a
         link, because signing out is a state change and a GET that ends your
         session can be triggered by anything that prefetches a URL. -->
    <form method="POST" action="/auth/signout" style="flex:none">
      <button type="submit" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};white-space:nowrap;border:none;cursor:pointer;font-family:${FONT.ui}">Sign out</button>
    </form>
  </div>
  <!-- Closing an account had to exist: you cannot sell a subscription to one
       nobody can close, and the right to erasure is not optional for anyone
       selling into the EU or UK. It asks for the address rather than a click,
       because unlike every other delete here it takes everything and there is
       no bin behind it. -->
  <div style="margin-top:8px;padding:14px 18px;border-radius:${RADIUS.card};background:${C.surface};display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1 1 240px;min-width:min(240px,100%)">
      <div style="font-size:${SIZE.secondary};color:${C.ink70}">Close this account</div>
      <div style="font-size:${SIZE.meta};color:${C.ink32};margin-top:3px;line-height:1.55">Removes every video, edit and export, and the storage they hold. There is no bin behind this one.</div>
    </div>
    <button id="closeAccount" data-danger data-email="${esc(email)}" style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:7px 13px;border-radius:${RADIUS.button};background:transparent;color:${ACCENT.red};border:none;cursor:pointer;font-family:${FONT.ui}">Close account</button>
  </div>`;
}

/*
 * WHAT THE PLAN BUYS, from PLANS rather than from memory.
 *
 * Both hints were written by hand and both were wrong. They named an
 * overnight queue, which nothing in the codebase ever queues to — no caller
 * sets a job's overnight flag and editor-intake.ts deliberately omits the
 * button because the queue is not provisioned. And they hardcoded 300 and
 * 1,200, so the page a paying account reads about its own limits could
 * disagree with the meter that enforces them.
 *
 * Found by the `claims` fidelity rule, which was written for the landing
 * page and reached this one the moment Settings was added to its list: the
 * landing page had been cleaned up and this surface was making the same
 * promise to people who had already paid.
 */
function planBlock(plan: string, meters: Meter[], billingReady: boolean): string {
  const pro = plan !== "free";
  const name = pro ? `Studio — $${PLANS.pro.price}/mo` : "Free";
  const hint = pro
    ? `4K renders, ${PLANS.pro.sourceMinutes.toLocaleString("en-GB")} processing minutes a month, and ${PLANS.pro.storageGb} GB of storage.`
    : `${PLANS.free.sourceMinutes} processing minutes a month. 4K renders are Studio-only.`;
  const btn = pro ? "Manage plan" : "Upgrade to Studio";

  const meterRow = (m: Meter) => {
    /*
     * An uncapped account is METERED, not unmeasured.
     *
     * The owner is never blocked, so showing "0 / 1200" against a limit that
     * will not be enforced is a number that means nothing. What it does mean
     * — what has actually been used — is the whole point: real consumption on
     * the account this product is built on is the only honest evidence of what
     * a plan should cost. So the figure stays and the ceiling goes, and the
     * bar with it, because there is nothing to be a fraction of.
     */
    const pct = m.cap && !m.uncapped ? Math.min(100, Math.round((m.used / m.cap) * 100)) : 0;
    const hot = !m.uncapped && pct > 85;
    return `<div>
      <div style="display:flex;align-items:baseline;gap:10px">
        <span data-content style="flex:1;font-size:${SIZE.secondary};color:${C.ink70}">${m.label}</span>
        <span data-content style="font-size:${SIZE.secondary};color:${hot ? ACCENT.red : "rgba(236,236,241,0.4)"};font-family:${FONT.mono};flex:none;white-space:nowrap">${
          m.uncapped ? `${m.used}${m.unit ? ` ${m.unit}` : ""} used` : `${m.used} / ${m.cap}${m.unit ? ` ${m.unit}` : ""}`
        }</span>
      </div>
      ${
        m.uncapped
          ? ""
          : `<div style="margin-top:16px;height:5px;border-radius:99px;background:${C.pill};overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${hot ? ACCENT.red : m.color};border-radius:99px"></div>
      </div>`
      }
      <div data-content style="font-size:${SIZE.meta};color:${C.ink32};margin-top:6px;line-height:1.5">${m.note}</div>
    </div>`;
  };

  return `${sectionLabel("Plan &amp; usage")}
  <div style="margin-top:16px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <div style="flex:1 1 200px;min-width:min(200px,100%)">
        <div data-content style="font-size:${SIZE.body};font-weight:500">${name}</div>
        <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px;line-height:1.5">${hint}</div>
      </div>
      ${
        /*
         * A real button, or nothing.
         *
         * This was a <span> — it looked exactly like the control it was
         * pretending to be and did nothing when pressed, which is the same
         * class of lie as a progress bar on a timer. With Stripe configured it
         * opens checkout (or the portal, for an existing subscriber). Without
         * it, no button at all: an unbuyable plan should not offer to sell.
         */
        billingReady
          ? `<button type="button" id="planAction" data-mode="${pro ? "portal" : "checkout"}" style="font-size:${SIZE.secondary};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${pro ? C.pill : ACCENT.gold};color:${pro ? C.ink : "#131316"};flex:none;white-space:nowrap;border:none;cursor:pointer;font-family:${FONT.ui}">${btn}</button>`
          : ""
      }
    </div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px">${meters.map(meterRow).join("")}</div>
  </div>`;
}

/**
 * What it costs to run. Owner only.
 *
 * The bars are scaled to the LARGEST line, not to the total — the question the
 * panel answers is "which of these is the expensive one", and a share-of-total
 * bar makes every line look small.
 */
function costPanel(cost: NonNullable<SettingsData["cost"]>): string {
  /*
   * The cache line, and it says nothing when there is nothing to say.
   *
   * "0 answers reused" on a new account reads as a feature that does not
   * work; the line appears when it has a number, which is the same rule as
   * a clean-up chip that shows no count when it has nothing to count.
   */
  const cacheNote = cost.cache.hits
    ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:10px;line-height:1.55">${cost.cache.hits} judgement${
        cost.cache.hits === 1 ? "" : "s"
      } came back from ${cost.cache.rows} kept answer${
        cost.cache.rows === 1 ? "" : "s"
      } instead of being asked again — re-cutting the same footage does not pay for the same reading twice.</div>`
    : "";
  /*
   * AND WHAT THE MONTH BOUGHT NOTHING WITH.
   *
   * Same rule as the cache line above: it appears when it has a number, and
   * says nothing when there is nothing to say — "$0.00 wasted" on a clean
   * month reads as a warning rather than as the good news it is.
   *
   * The number it reports is the one decision 38 commits the business to
   * eating. Nothing showed it before, and 9,702 of 9,703 rows in the
   * development database could not have answered the question if asked.
   */
  /*
   * THE NUMBERS ARE MARKED AND THE WORDS ARE NOT, which is why this is four
   * spans rather than one sentence.
   *
   * `data-content` exempts a whole element from the copy check. Putting it on
   * the sentence — which is what the cache line beside this does — would hide
   * the WORDING from every check in the gate, and the wording is copy. But
   * splitting it so the words come after a closing tag hides them too: the
   * extractor reads the text immediately following an OPENING tag, so a run
   * sitting between </span> and <span> is seen by nothing.
   *
   * So each static run gets its own span and each figure gets a marked one.
   * The two sentences below are signed off in check-fidelity.cjs with the
   * rest of this owner-only panel, which no design draws.
   */
  const wastedNote = cost.wasted.count
    ? `<div style="font-size:${SIZE.secondary};color:${ACCENT.red};margin-top:10px;line-height:1.55"><span data-content>${usd(
        cost.wasted.cost,
      )}</span><span> of that bought nothing &mdash; </span><span data-content>${
        cost.wasted.count
      } attempt${cost.wasted.count === 1 ? "" : "s"}</span><span> that failed. Absorbed rather than charged on, which is what makes it worth watching.</span></div>`
    : "";
  const max = Math.max(...cost.lines.map((l) => l.amount), 0.01);
  const perVideo = cost.finished ? cost.total / cost.finished : 0;
  const pace = cost.dayOfMonth ? (cost.total / cost.dayOfMonth) * 30 : 0;

  const heads = [
    { label: "This month", value: usd(cost.total), color: C.ink, note: `${cost.dayOfMonth} days in` },
    {
      label: "Per finished video",
      value: cost.finished ? usd(perVideo) : "—",
      color: C.ink,
      note: cost.finished ? `${cost.finished} rendered` : "nothing rendered yet",
    },
    { label: "At this pace", value: `$${pace.toFixed(0)}/mo`, color: ACCENT.gold, note: "before storage compounds" },
  ];

  const line = (l: CostLine) => `<div>
    <div style="display:flex;align-items:baseline;gap:10px">
      <span data-content style="flex:1;font-size:${SIZE.secondary};color:${C.ink70};min-width:0">${l.label}</span>
      <span data-content style="font-size:${SIZE.secondary};font-family:${FONT.mono};color:rgba(236,236,241,0.55);flex:none;white-space:nowrap">${usd(l.amount)}</span>
    </div>
    <div style="margin-top:5px;height:4px;border-radius:99px;background:${C.pill};overflow:hidden">
      <div style="height:100%;width:${Math.round((l.amount / max) * 100)}%;background:${l.color};border-radius:99px"></div>
    </div>
    <div data-content style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);margin-top:4px;line-height:1.45">${l.note}</div>
  </div>`;

  return `<div style="margin-top:40px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
    <span style="font-size:${SIZE.body};font-weight:600;color:${C.ink45};white-space:nowrap">What it costs to run</span>
    <span style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(ACCENT.gold)};color:${ACCENT.gold};white-space:nowrap">OWNER ONLY</span>
  </div>
  <div style="margin-top:6px;font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);line-height:1.55;max-width:620px">Every job writes what it burned — machine time, model tokens, storage, delivery. Real spend, not a plan allowance, so pricing gets set from numbers instead of guesses.</div>
  <div style="margin-top:16px;padding:18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      ${heads
        .map(
          (h) => `<div style="flex:1 1 150px;min-width:min(150px,100%)">
            <div data-content style="font-size:${SIZE.meta};color:${C.ink32};white-space:nowrap">${h.label}</div>
            <div data-content style="font-size:22px;font-weight:600;letter-spacing:-0.02em;margin-top:4px;font-family:${FONT.mono};color:${h.color}">${h.value}</div>
            <div data-content style="font-size:${SIZE.meta};color:${C.ink32};margin-top:4px;line-height:1.45">${h.note}</div>
          </div>`,
        )
        .join("")}
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid ${C.hairline};display:flex;flex-direction:column;gap:11px">
      ${cost.lines.map(line).join("")}
    </div>
    ${wastedNote}
    ${cacheNote}
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid ${C.hairline};display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <span style="flex:1 1 220px;min-width:min(220px,100%);font-size:12px;color:rgba(236,236,241,0.4);line-height:1.5">Priced per source minute — the only unit that moves spend.</span>
      <a href="/api/usage/month" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.8);flex:none;white-space:nowrap">Export the month</a>
    </div>
  </div>`;
}

export interface Reading {
  label: string;
  /** Null means nothing happened, which is not nothing going wrong. */
  value: number | null;
  of: number;
  says: string;
  attention: boolean;
}

/**
 * WHETHER THIS PRODUCT IS WORKING, in four lines and the pools behind one.
 *
 * Phase 8's SLO dashboard. The hard part is what is left out: a dashboard of
 * everything measurable is one nobody reads, and the thing somebody needs at
 * 2am is "is it broken, and which part" rather than a percentile.
 *
 * A READING WITH NO DATA IS NOT A GREEN ONE. "Nothing has run today" and
 * "everything ran" look alike as a number and are not, so the sentence
 * carries the difference and a null value renders as a dash rather than a
 * zero. The same discipline as a reachable "nothing backs this".
 *
 * Colour encodes exactly one thing: whether somebody should look. Not
 * severity and not a grade — `attention`, which each reading decides for
 * itself because the threshold differs. Any silent partial failure is a P1;
 * one failed job in a day is Tuesday.
 */
function sloPanel(d: NonNullable<SettingsData["slo"]>): string {
  const line = (r: Reading) => `<div style="display:flex;gap:12px;align-items:baseline;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface}">
    <span style="flex:none;width:9px;height:9px;border-radius:50%;background:${r.attention ? ACCENT.red : ACCENT.green}"></span>
    <div style="flex:1;min-width:0">
      <div style="font-size:${SIZE.body};font-weight:500">${esc(r.label)}</div>
      <div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:3px;line-height:1.5">${esc(r.says)}</div>
    </div>
    <span style="flex:none;font-size:${SIZE.body};font-variant-numeric:tabular-nums;font-family:${FONT.mono};color:${
      r.attention ? ACCENT.red : C.ink70
    }">${r.value === null ? "&mdash;" : `${r.value}/${r.of}`}</span>
  </div>`;

  /* The pools get their own rows under their reading, because "one is shut"
     is a summary and "which, and why" is what somebody acts on. */
  const pools = d.poolRows
    .map(
      (p) => `<div style="display:flex;gap:10px;align-items:baseline;padding:8px 14px 8px 36px;font-size:${SIZE.secondary}">
      <span style="flex:none;font-family:${FONT.mono};color:${p.verdict === "closed" ? C.ink45 : ACCENT.red}">${esc(p.pool)}</span>
      <span data-content style="flex:1;min-width:0;color:${C.ink32};line-height:1.5">${
        p.lastSays ? esc(p.lastSays) : "Answering normally."
      }</span>
    </div>`,
    )
    .join("");

  return `<div style="margin-top:48px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
    <span style="font-size:${SIZE.body};font-weight:600;color:${C.ink45};white-space:nowrap">Whether it is working</span>
    <span style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(ACCENT.gold)};color:${ACCENT.gold};white-space:nowrap">OWNER ONLY</span>
  </div>
  <div style="margin-top:6px;font-size:${SIZE.secondary};color:${C.ink45};line-height:1.55;max-width:640px">The last day, from rows the product already writes. A dash means nothing happened, which is not the same as nothing going wrong.</div>
  <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">
    ${line(d.canary)}${line(d.jobs)}${line(d.items)}${line(d.pools)}${pools}
  </div>`;
}

/**
 * The deleted pile.
 *
 * This page's own subtitle has always said "Defaults, storage, and the deleted
 * pile", and there was no deleted pile — the trash table sat in the schema
 * unwritten and unread. Now that things can be deleted, the promise has to be
 * kept, or deleting means losing.
 */
function trashBlock(rows: TrashRow[]): string {
  const when = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const row = (t: TrashRow) => `<div data-item-row style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
    <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.label)}</span>
    <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(t.entity === "source" ? "video" : "edit")} · ${esc(when(t.deleted_at))}</span>
    <button class="trash-restore" data-kind="${t.entity === "source" ? "sources" : "projects"}" data-id="${esc(t.entity_id)}" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui}">Put it back</button>
    <!-- The only control in this product that removes a byte from R2. It asks
         first, because unlike every other delete here this one cannot be
         undone — and it is only reachable for something already deleted, so
         it takes two decisions rather than one. -->
    <button class="trash-purge" data-kind="${t.entity === "source" ? "sources" : "projects"}" data-id="${esc(t.entity_id)}" data-label="${esc(t.label)}" style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:6px 12px;border-radius:${RADIUS.button};background:transparent;color:${C.ink45};border:none;cursor:pointer;font-family:${FONT.ui}">Delete for good</button>
  </div>`;

  return `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
    <div style="flex:1">${sectionLabel("Deleted")}</div>
    ${
      rows.length
        ? `<button id="empty-bin" style="flex:none;font-size:${SIZE.meta};font-weight:500;padding:6px 12px;border-radius:${RADIUS.button};background:transparent;color:${C.ink45};border:none;cursor:pointer;font-family:${FONT.ui}">Empty the bin</button>`
        : ""
    }
  </div>
  <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${
    rows.length
      ? rows.map(row).join("")
      : `<div style="padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Nothing deleted</div>`
  }</div>
  <div style="font-size:${SIZE.meta};color:${C.ink32};margin-top:10px;line-height:1.55">Deleting is reversible until you delete for good — that removes the video and every render made from it, and gives the storage back.</div>`;
}

/**
 * CONNECTED SERVICES — your own storage.
 *
 * "Point sources at a bucket you own" is on the landing page, in the pricing
 * table and in this page's own design, and nothing implemented it until now.
 *
 * READ-ONLY, AND SAID SO WHERE THE KEY IS TYPED. Somebody is handing over
 * access to their whole archive; the sentence that promises Aldershot never
 * writes to it belongs beside the box, not in a help page nobody opens.
 *
 * Nothing is copied: an import creates a row per video pointing at the object
 * where it already lives, and reading one is metered and happens the first
 * time you cut with it. That is why it is instant however large the archive
 * is, and why the copy says "brings them in without reading them".
 */
function connectionsBlock(list: SettingsData["connections"]): string {
  const rows = (list ?? [])
    .map(
      (c) => `<div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:11px 13px;border-radius:${RADIUS.card};background:${C.pill}">
        <span data-content style="flex:1 1 180px;min-width:0;font-size:${SIZE.secondary};font-weight:500">${esc(c.bucket)}</span>
        <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${
          c.last_import_at ? "imported" : "never imported"
        }</span>
        <button class="bucket-import" type="button" data-conn="${esc(c.id)}"
          style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 13px;border-radius:${RADIUS.button};background:${C.active};color:${C.ink};border:none;cursor:pointer;font-family:${FONT.ui}">Bring the footage in</button>
      </div>`,
    )
    .join("");

  return `${sectionLabel("Your own storage")}
  <div style="margin-top:16px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70};text-wrap:pretty;max-width:620px">Your videos stay where they are — Aldershot reads them in place and keeps only the read (transcripts, moments, the index) and small preview copies.</div>
    ${rows ? `<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">${rows}</div>` : ""}
    <form class="bucket-form" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input class="bucket-endpoint" placeholder="https://your-account.r2.cloudflarestorage.com" aria-label="Storage endpoint"
        style="flex:1 1 260px;min-width:min(240px,100%);font-size:${SIZE.secondary};font-family:${FONT.mono};padding:7px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none" />
      <input class="bucket-name" placeholder="neolog-videos" aria-label="Bucket name"
        style="flex:0 1 160px;min-width:min(140px,100%);font-size:${SIZE.secondary};font-family:${FONT.mono};padding:7px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none" />
      <input class="bucket-key" placeholder="Access key ID" aria-label="Access key ID"
        style="flex:0 1 180px;min-width:min(160px,100%);font-size:${SIZE.secondary};font-family:${FONT.mono};padding:7px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none" />
      <input class="bucket-secret" type="password" placeholder="Secret access key" aria-label="Secret access key"
        style="flex:0 1 200px;min-width:min(180px,100%);font-size:${SIZE.secondary};font-family:${FONT.mono};padding:7px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none" />
      <button type="submit" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:7px 14px;border-radius:${RADIUS.button};background:${C.ink};color:${C.canvas};border:none;cursor:pointer;font-family:${FONT.ui}">Connect</button>
    </form>
    <div style="margin-top:8px;font-size:${SIZE.meta};color:${C.ink32};text-wrap:pretty">Bucket name. On another account, add a read-only R2 access key in the next step. Nothing is written to your bucket.</div>
    <div style="margin-top:6px;font-size:${SIZE.meta};color:${C.ink32};text-wrap:pretty">Connecting brings the footage in without reading it &mdash; a video is read the first time you cut with it.</div>
  </div>`;
}

/**
 * YOUR MONTHLY LIMIT — the one money setting (doc 22, row 4).
 *
 * The canvas's card, design/canvas/Settings.dc.html: the figure large, what
 * is left beside it, five amounts and a box for any other, and one sentence
 * saying what it covers. A chip saves when pressed, like the canvas; there is
 * no Save button to forget.
 *
 * What it does not say, on purpose: the brake behind it. src/spend.ts keeps a
 * cap over all running costs that rises with this number, and it is not a
 * second setting (the owner's choice, 22 Nov). Its refusal points here.
 */
export const LIMIT_CHOICES = [0, 25, 50, 100, 250];

function limitBlock(lim: SettingsData["limit"]): string {
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const left = Math.max(0, lim.usd - lim.chargedUsd);
  const value = lim.usd ? money(lim.usd) : "Nothing";
  const sub = lim.usd
    ? `a month, for generated pictures and voices &middot; ${money(Math.round(left * 100) / 100)} left`
    : "Nothing will be generated. Drawings, archives and your own footage only.";
  const chip = (n: number) => {
    const on = n === lim.usd;
    return `<button type="button" class="limit-chip" data-usd="${n}" style="font-size:${SIZE.secondary};font-weight:600;padding:7px 13px;border-radius:${RADIUS.button};border:none;cursor:pointer;font-family:${FONT.ui};font-variant-numeric:tabular-nums;background:${on ? C.ink : C.pill};color:${on ? "#101013" : C.ink70}">${n ? `$${n}` : "None"}</button>`;
  };
  const custom = LIMIT_CHOICES.includes(lim.usd) ? "" : String(lim.usd);
  return `${sectionLabel("Your monthly limit")}
  <div class="limit-card" data-charged="${Math.round(lim.chargedUsd * 100) / 100}" style="margin-top:16px;padding:20px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap">
      <span class="limit-value" data-content style="font-size:34px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums">${value}</span>
      <span class="limit-sub" data-content style="font-size:${SIZE.secondary};color:${C.ink70}">${sub}</span>
    </div>
    <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      ${LIMIT_CHOICES.map(chip).join("")}
      <span style="display:inline-flex;align-items:center;gap:6px;margin-left:4px">
        <span style="font-size:${SIZE.meta};color:${C.ink45}">or</span>
        <span style="font-size:${SIZE.secondary};color:${C.ink45}">$</span>
        <input class="limit-usd" type="number" min="0" step="5" value="${custom}" aria-label="Monthly limit in dollars"
          style="width:84px;font-size:${SIZE.secondary};font-family:${FONT.mono};padding:6px 9px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink};border:none" />
      </span>
    </div>
    <div style="margin-top:14px;font-size:${SIZE.secondary};line-height:1.6;color:${C.ink70};max-width:620px">One limit, everywhere. It covers what is generated for you, pictures and voices; reading footage and editing are never counted against it. Nothing generates past it until you raise it.</div>
  </div>`;
}

export function renderSettings(d: SettingsData): string {
  return `<div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">Settings</div>
<div style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:6px">Defaults, storage, and the deleted pile. Nothing here changes work you've already made.</div>
${account(d.name, d.email)}
${planBlock(d.plan, d.meters, d.billingReady)}
${limitBlock(d.limit)}
${connectionsBlock(d.connections)}
${trashBlock(d.trash)}
${d.cost ? costPanel(d.cost) : ""}
${d.slo ? sloPanel(d.slo) : ""}`;
}
