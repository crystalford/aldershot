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

export interface Meter {
  label: string;
  used: number;
  cap: number;
  unit: string;
  note: string;
  color: string;
}

export interface CostLine {
  label: string;
  amount: number;
  color: string;
  note: string;
}

export interface SettingsData {
  name: string | null;
  plan: string;
  isOwner: boolean;
  meters: Meter[];
  /** Whether Stripe is configured. A button that cannot charge is not shown. */
  billingReady: boolean;
  /** Null for anyone but the owner — the panel is not rendered at all. */
  cost: {
    lines: CostLine[];
    total: number;
    finished: number;
    dayOfMonth: number;
  } | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function sectionLabel(text: string): string {
  return `<div style="margin-top:40px;font-size:${SIZE.body};font-weight:600;color:${C.ink45}">${text}</div>`;
}

function account(name: string | null): string {
  const initial = (name ?? "You").trim().charAt(0).toUpperCase() || "Y";
  return `${sectionLabel("Account")}
  <div style="margin-top:16px;padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface};display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <span style="width:38px;height:38px;border-radius:50%;background:#2A2A31;display:flex;align-items:center;justify-content:center;font-size:${SIZE.body};color:${C.ink70};flex:none">${esc(initial)}</span>
    <div style="flex:1 1 160px;min-width:min(160px,100%)">
      <div data-content style="font-size:${SIZE.body};font-weight:500">${esc(name ?? "You")}</div>
      <div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);margin-top:3px">Solo workspace · no one else has access</div>
    </div>
    <a href="/landing" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};flex:none;white-space:nowrap">Signed-out site</a>
    <span style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};flex:none;white-space:nowrap">Manage</span>
  </div>`;
}

function planBlock(plan: string, meters: Meter[], billingReady: boolean): string {
  const pro = plan !== "free";
  const name = pro ? "Studio — $29/mo" : "Free";
  const hint = pro
    ? "Overnight queue, 4K renders, and 1,200 processing minutes a month."
    : "300 processing minutes a month. Overnight queue and 4K renders are Studio-only.";
  const btn = pro ? "Manage plan" : "Upgrade to Studio";

  const meterRow = (m: Meter) => {
    const pct = m.cap ? Math.min(100, Math.round((m.used / m.cap) * 100)) : 0;
    const hot = pct > 85;
    return `<div>
      <div style="display:flex;align-items:baseline;gap:10px">
        <span data-content style="flex:1;font-size:${SIZE.secondary};color:${C.ink70}">${m.label}</span>
        <span data-content style="font-size:${SIZE.secondary};color:${hot ? ACCENT.red : "rgba(236,236,241,0.4)"};font-family:${FONT.mono};flex:none;white-space:nowrap">${m.used} / ${m.cap}${m.unit ? ` ${m.unit}` : ""}</span>
      </div>
      <div style="margin-top:16px;height:5px;border-radius:99px;background:${C.pill};overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${hot ? ACCENT.red : m.color};border-radius:99px"></div>
      </div>
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
    <span data-content style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;padding:2px 7px;border-radius:4px;background:${accentBg(ACCENT.gold)};color:${ACCENT.gold};white-space:nowrap">OWNER ONLY</span>
  </div>
  <div data-content style="margin-top:6px;font-size:${SIZE.secondary};color:rgba(236,236,241,0.4);line-height:1.55;max-width:620px">Every job writes what it burned — machine time, model tokens, storage, delivery. Real spend, not a plan allowance, so pricing gets set from numbers instead of guesses.</div>
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
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid ${C.hairline};display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <span data-content style="flex:1 1 220px;min-width:min(220px,100%);font-size:12px;color:rgba(236,236,241,0.4);line-height:1.5">Priced per source minute — the only unit that moves spend.</span>
      <a href="/api/usage/month" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${C.pill};color:rgba(236,236,241,0.8);flex:none;white-space:nowrap">Export the month</a>
    </div>
  </div>`;
}

export function renderSettings(d: SettingsData): string {
  return `<div style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">Settings</div>
<div data-content style="font-size:${SIZE.body};color:rgba(236,236,241,0.42);margin-top:6px">Defaults, storage, and the deleted pile. Nothing here changes work you've already made.</div>
${account(d.name)}
${planBlock(d.plan, d.meters, d.billingReady)}
${d.cost ? costPanel(d.cost) : ""}`;
}
