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
    /**
     * How many of them BACK it, which is what thin now means. Null when
     * nobody checked — the judge was not run, or its call failed — and then
     * the count of results is the only thing there is to go on.
     */
    backed: number | null;
    /** Why it is empty, when the reason is not "your library has nothing". */
    gap: string | null;
  }>;
}

const ROLE_ACCENT: Record<Role, keyof typeof ACCENT> = {
  subject: "green",
  counter: "gold",
  outside: "cyan",
};

/**
 * WHERE YOU ARE IN THE SEVEN STEPS, which is what makes the stop legible.
 *
 * The plan stops once, deliberately, before anything is searched or cut —
 * 11-BUILD-ORDER's acceptance says it stops exactly once and this is the
 * once. A page that simply shows a claim and some beats does not say that: it
 * looks like a page that has finished, and the one thing a person needs to
 * know is that it has NOT, and that nothing has been spent yet.
 *
 * The seven are the prototype's own, and so is the rule that the step you are
 * on is the lit one, everything before it is done, and everything after is
 * waiting. FIND becomes FOUND once the searching has happened, because they
 * are the same step before and after — the prototype does the same.
 *
 * SIZED carries no figure here. The prototype's reads "SIZED · moderate" from
 * a corpus assessment that does not exist in this build; the word on its own
 * is true (something was read) and the qualifier would be invented.
 */
function stepper(state: PlanData["state"]): string {
  const found = state !== "beats";
  const steps = ["BRIEF", "SIZED", "CLAIM", "BEATS", found ? "FOUND" : "FIND", "PLAN", "FIRST CUT"];
  /* Which one is lit. `beats` is the stop, so the flow is parked on BEATS
     until the beats are answered. */
  const at = state === "beats" ? 3 : state === "found" ? 4 : 6;

  return `<div style="margin-top:12px;display:flex;gap:4px;flex-wrap:wrap">${steps
    .map((name, i) => {
      const done = i < at;
      const here = i === at;
      return `<span style="flex:none;font-size:9.5px;font-weight:600;letter-spacing:.07em;padding:3px 7px;border-radius:3px;background:${
        here ? C.ink : done ? "rgba(236,236,241,0.1)" : "transparent"
      };color:${here ? "#131316" : done ? "rgba(236,236,241,0.7)" : "rgba(236,236,241,0.3)"}">${name}</span>`;
    })
    .join("")}</div>`;
}

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
  /*
   * THIN MEANS LITTLE THAT BACKS IT, not few results — src/plan.ts says
   * why. When nobody checked, the count is all there is, which is what this
   * did before the judge existed.
   */
  const thin = b.kept && (b.backed ?? b.found) < 2;
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
            : /*
               * "3 of 6 back it" rather than "6 moments", because they are
               * different facts and only one of them is about the argument.
               * The unchecked case keeps the old sentence: claiming a
               * coverage nobody measured would be worse than saying less.
               */
              `<span data-content style="display:block;margin-top:4px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${thin ? ACCENT.red : C.ink45}">${
                b.backed === null
                  ? `${b.found} moment${b.found === 1 ? "" : "s"}`
                  : `${b.backed} of ${b.found} back it`
              }${thin ? " · thin" : ""}</span>`
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
  /*
   * THE SUMMARY FOLLOWS THE ROWS. If thin is about what backs a beat then
   * the line a person reads first should be too — but only when every
   * searched beat was actually checked. A total mixing checked and
   * unchecked beats would be a coverage figure for a set nobody covered.
   */
  const searched = d.beats.filter((b) => b.kept && b.role !== "outside");
  const allChecked = searched.length > 0 && searched.every((b) => b.backed !== null);
  const backed = searched.reduce((n, b) => n + (b.backed ?? 0), 0);
  const total = allChecked
    ? `${backed} of ${found} back them`
    : `${found} moment${found === 1 ? "" : "s"}`;

  return `<div data-plan="${esc(d.id)}" style="max-width:min(720px,100%)">
    <div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">${esc(d.topic)}</div>
    ${stepper(d.state)}

    ${
      d.claim
        ? `<div style="margin-top:16px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.raised};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
             <div style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">THE CLAIM</div>
             <div data-content style="margin-top:7px;font-size:${SIZE.body};line-height:1.6">${esc(d.claim)}</div>
           </div>`
        : ""
    }

    <div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">${d.beats.map((b) => beatRow(b, d.state)).join("")}</div>

    <div style="margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${kept} of ${d.beats.length} beats${d.state === "beats" ? "" : ` · ${total}`}</span>
      ${
        /*
         * ONE BUTTON AT A TIME, and it is the step the plan is actually on.
         * Showing both would offer to cut a plan that has found nothing, and
         * a control that cannot act is the thing the conventions check exists
         * to stop.
         *
         * THE WORDS ARE THE PROTOTYPE'S. "Looks right — go find it" read
         * "Find the footage" until the crawl reached this page for the first
         * time on 28 Oct and asked the prototype for it. A label is not a
         * detail: the prototype's version is the user AGREEING to the beats,
         * which is what pressing it means, and "Find the footage" is an
         * instruction to the machine. "Cut it" beside it was already the
         * prototype's own word, which is how one paraphrase sat next to one
         * verbatim label for weeks with nothing able to tell them apart.
         */
        d.projectId
          ? `<a href="/p/${esc(d.projectId)}/cut" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;text-decoration:none">Open the cut</a>`
          : d.state === "beats"
            ? `<button class="plan-find" type="button" data-plan="${esc(d.id)}" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Looks right — go find it</button>`
            : `<button class="plan-cut" type="button" data-plan="${esc(d.id)}" style="font-size:${SIZE.body};font-weight:600;padding:9px 18px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Cut it</button>`
      }
    </div>
  </div>`;
}
