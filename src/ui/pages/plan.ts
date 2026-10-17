/**
 * THE PLAN, on screen.
 *
 * One Take draws this as a state of the room's centre column. It is a page of
 * its own here, which is a departure and is written down as one: the centre
 * column's other states are the four tabs, and folding a sixth state into
 * them before the first five are settled would make the hardest surface in
 * the product harder to change. It moves when the centre column has states
 * rather than tabs.
 *
 * Everything else is the prototype's: the claim card, the beats with their
 * role, Keep and Cut on each — the one stop — and then what was found, with
 * thin beats marked rather than padded.
 */

import { ACCENT, C, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";
import { ROLE_NAME, type Role } from "../../plan.ts";

export interface PlanData {
  id: string;
  topic: string;
  claim: string;
  state: "beats" | "found" | "cut";
  projectId: string | null;
  beats: Array<{
    id: string;
    role: Role;
    name: string;
    need: string;
    kept: boolean;
    found: number;
    /** Why it is empty, when the reason is not "your library has nothing". */
    gap: string | null;
  }>;
}

const ROLE_ACCENT: Record<Role, keyof typeof ACCENT> = {
  subject: "green",
  counter: "gold",
  outside: "cyan",
};

function beatRow(b: PlanData["beats"][number], state: PlanData["state"]): string {
  const accent = ACCENT[ROLE_ACCENT[b.role]];
  /*
   * Thin is a fact about the FOUND state. Before anything has been searched
   * every beat has nothing, and saying so would call the plan hopeless before
   * it has looked — which is why the whole found line is held back below,
   * and why THIS condition does not repeat the check. It did, and the
   * duplicate was dead: breaking it changed no output at all, which is how it
   * was found.
   */
  const thin = b.kept && b.found < 2;
  return `<div style="display:flex;gap:12px;align-items:baseline;padding:11px 13px;border-radius:${RADIUS.card};background:${C.surface};opacity:${b.kept ? "1" : ".5"}">
    <span data-content style="flex:none;font-size:10px;font-weight:600;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:${accentBg(accent)};color:${accent};white-space:nowrap">${esc(ROLE_NAME[b.role])}</span>
    <span style="flex:1 1 220px;min-width:min(200px,100%)">
      <span data-content style="display:block;font-size:${SIZE.body};${b.kept ? "" : "text-decoration:line-through;text-decoration-color:rgba(236,236,241,0.3)"}">${esc(b.name)}</span>
      <span data-content style="display:block;margin-top:2px;font-size:${SIZE.secondary};color:${C.ink45};line-height:1.5">${esc(b.need)}</span>
      ${
        b.gap
          ? `<span data-content style="display:block;margin-top:4px;font-size:${SIZE.meta};color:${ACCENT.cyan};font-family:${FONT.mono}">${esc(b.gap)}</span>`
          : state === "beats"
            ? ""
            : `<span data-content style="display:block;margin-top:4px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${thin ? ACCENT.red : C.ink45}">${b.found} moment${b.found === 1 ? "" : "s"}${thin ? " · thin" : ""}</span>`
      }
    </span>
    <!-- data-BEAT, not data-plan. The container carries data-plan, so a
         button carrying it too made closest("[data-plan]") return the button
         itself and the beat id was sent as the plan id. -->
    <button class="beat-keep" type="button" data-beat="${esc(b.id)}" data-kept="${b.kept ? 1 : 0}"
      style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:5px 10px;border-radius:${RADIUS.button};background:${b.kept ? accentBg(ACCENT.green) : C.pill};color:${b.kept ? ACCENT.green : C.ink70};border:none;cursor:pointer;font-family:inherit">${b.kept ? "Keep" : "Cut"}</button>
  </div>`;
}

export function renderPlan(d: PlanData): string {
  const kept = d.beats.filter((b) => b.kept).length;
  const found = d.beats.reduce((n, b) => n + b.found, 0);

  return `<div data-plan="${esc(d.id)}" style="max-width:min(720px,100%)">
    <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">${esc(d.topic)}</div>

    ${
      d.claim
        ? `<div style="margin-top:16px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.raised};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
             <div data-content style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">THE CLAIM</div>
             <div data-content style="margin-top:7px;font-size:${SIZE.body};line-height:1.6">${esc(d.claim)}</div>
           </div>`
        : ""
    }

    <div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">${d.beats.map((b) => beatRow(b, d.state)).join("")}</div>

    <div style="margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${kept} of ${d.beats.length} beats${d.state === "beats" ? "" : ` · ${found} moment${found === 1 ? "" : "s"}`}</span>
      ${
        /*
         * ONE BUTTON AT A TIME, and it is the step the plan is actually on.
         * Showing both would offer to cut a plan that has found nothing, and
         * a control that cannot act is the thing the conventions check exists
         * to stop.
         */
        d.projectId
          ? `<a href="/p/${esc(d.projectId)}/cut" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;text-decoration:none">Open the cut</a>`
          : d.state === "beats"
            ? `<button class="plan-find" type="button" data-plan="${esc(d.id)}" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Find the footage</button>`
            : `<button class="plan-cut" type="button" data-plan="${esc(d.id)}" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Cut it</button>`
      }
    </div>
  </div>`;
}
