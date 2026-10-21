/**
 * LABELLING, ON A PHONE.
 *
 * Phase 0 asks for about two hundred human judgements before any retrieval
 * number means anything, and the person who has to make them does not have a
 * terminal. So it is a page: a claim, the moments retrieval found for it, and
 * three taps each.
 *
 * BIG TARGETS, ONE DECISION AT A TIME, NOTHING TO LEARN. Two hundred
 * judgements is an hour of somebody's evening, and the thing that makes an
 * hour of it unbearable is friction — a small button, a modal, a save step.
 * Every moment is one row with three buttons and no confirmation, because an
 * answer that can be changed by tapping another button needs none.
 *
 * It says how far along it is against the number that matters, so the work
 * has a visible end rather than being a well.
 */

import { ACCENT, C, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";
import {
  ENOUGH_DOUBLE_JUDGED,
  ENOUGH_LABELS,
  VERDICT_NAME,
  VERDICTS,
  scoreClaim,
  type Verdict,
} from "../../eval-set.ts";

export interface EvalData {
  /** The claim being judged, if one is open. */
  claim: { id: string; text: string } | null;
  /** The moments retrieval found for it, with any answer already given. */
  candidates: Array<{
    id: string;
    quote: string;
    sourceTitle: string;
    verdict: Verdict | null;
    /*
     * HOW MANY OTHER PEOPLE HAVE ANSWERED THIS ONE, and never what they
     * said. The count is useful — it is how you find the moments that still
     * need a second opinion — and the answer is the one thing that would
     * make the agreement figure meaningless, because nobody can unsee it.
     */
    alsoJudged: number;
  }>;
  /** Claims written so far, newest first. */
  claims: Array<{ id: string; text: string; judged: number }>;
  /** How many judgements exist in total. */
  labels: number;
  /** Who is answering right now. */
  labeller: string;
  /** Everyone who has answered anything in this set, in order of appearance. */
  labellers: string[];
  /** Moments more than one of them has judged — what agreement is computed of. */
  doubleJudged: number;
  /**
   * WHAT THE JUDGE HAS BEEN ASKED, as two counts and never as a verdict
   * beside a moment you are about to answer.
   *
   * The whole value of this set is that it was made by somebody deciding
   * for themselves. A machine's answer on the row would be an anchor, and
   * the agreement between a person and a judge they were shown is a
   * measurement of the judge's influence rather than of the judge.
   */
  machine: { judged: number; agreed: number } | null;
  /** True when the claim found nothing, which is itself a judgement. */
  foundNothing: boolean;
}

const VERDICT_ACCENT: Record<Verdict, keyof typeof ACCENT> = {
  backs: "green",
  related: "gold",
  unrelated: "red",
};

function candidate(c: EvalData["candidates"][number], claimId: string): string {
  return `<div style="padding:12px 13px;border-radius:${RADIUS.card};background:${C.surface};display:flex;flex-direction:column;gap:10px">
    <span data-content style="font-size:${SIZE.body};line-height:1.55;color:${C.ink70}">${esc(c.quote)}</span>
    <span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
      <span data-content style="flex:1;min-width:0;font-size:${SIZE.meta};color:${C.ink32};font-family:${FONT.mono}">${esc(c.sourceTitle)}</span>
      ${
        /* Only the COUNT. What they said is the one thing that would make
           the agreement figure meaningless, because nobody can unsee it. */
        c.alsoJudged
          ? `<span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${c.alsoJudged} other answer${c.alsoJudged === 1 ? "" : "s"}</span>`
          : ""
      }
    </span>
    <span style="display:flex;gap:7px;flex-wrap:wrap">${VERDICTS.map((v) => {
      const on = c.verdict === v;
      const accent = ACCENT[VERDICT_ACCENT[v]];
      /* 40px tall and full-width-ish on a phone: this is two hundred taps,
         and a target you have to aim at is what makes that unbearable. */
      /* The lit colours travel WITH the button, so the client does not hold a
         second copy of the palette that could drift from the tokens. */
      return `<button class="eval-say" type="button" data-claim="${esc(claimId)}" data-clip="${esc(c.id)}" data-verdict="${v}"
        data-on-bg="${accentBg(accent)}" data-on-fg="${accent}"
        style="flex:1 1 120px;min-height:40px;font-size:${SIZE.secondary};font-weight:600;padding:9px 12px;border-radius:${RADIUS.button};border:none;cursor:pointer;font-family:inherit;background:${on ? accentBg(accent) : C.pill};color:${on ? accent : C.ink70}">${esc(VERDICT_NAME[v])}</button>`;
    }).join("")}</span>
  </div>`;
}

/**
 * WHO IS ANSWERING, and how far off a second opinion is.
 *
 * Phase 0 asks for "two labellers, agreement recorded", and until this row
 * existed the second person's answers overwrote the first's — so the one
 * number the acceptance names could never be computed. A name, not an
 * account: a claim belongs to whoever wrote it, so two labellers is two
 * people taking turns at one keyboard, or the same person twice, blind,
 * weeks apart, which measures the same thing.
 *
 * The second count is the binding one. Four hundred judgements from one
 * person still cannot answer "do two people agree", so it is shown beside
 * the total rather than folded into it.
 */
function who(d: EvalData): string {
  const others = d.labellers.filter((n) => n !== d.labeller);
  return `<form method="GET" action="/eval" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input type="hidden" name="claim" value="${esc(d.claim?.text ?? "")}"/>
    <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45}">Answering as</span>
    <input type="text" name="by" value="${esc(d.labeller)}" autocomplete="off" maxlength="40"
      style="flex:0 1 160px;min-width:110px;padding:6px 10px;border-radius:${RADIUS.button};background:${C.surface};border:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);color:${C.ink};font-family:${FONT.mono};font-size:${SIZE.meta}"/>
    <button type="submit" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:inherit">Switch</button>
    <span data-content style="flex:1 1 160px;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${
      others.length
        ? `${d.doubleJudged} of ${ENOUGH_DOUBLE_JUDGED} judged twice · also ${esc(others.join(", "))}`
        : `${d.doubleJudged} of ${ENOUGH_DOUBLE_JUDGED} judged twice · nobody else yet`
    }</span>
  </form>
  ${machine(d)}`;
}

/**
 * ASK THE JUDGE, and what it came back with — two numbers, after the fact.
 *
 * It is here rather than beside each moment because this page is somebody
 * deciding for themselves: a verdict on the row would anchor the next
 * answer, and then the agreement between person and judge measures the
 * anchor. The summary is safe because it says how often they agreed
 * overall and never about which one.
 *
 * The press is for when the labelling is done, which is why it says what it
 * costs in plain terms — one model call per claim — rather than appearing
 * as a free button on a page somebody is halfway through.
 */
function machine(d: EvalData): string {
  const said = d.machine
    ? `${d.machine.agreed} of ${d.machine.judged} the same as a person`
    : "not asked yet";
  return `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <button id="ask-judge" type="button" ${d.labels ? "" : "disabled "}style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.pill};color:${d.labels ? C.ink70 : C.ink32};border:none;cursor:${d.labels ? "pointer" : "default"};font-family:inherit">Ask the judge</button>
    <span data-content style="flex:1 1 200px;min-width:0;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}">${esc(said)} · one model call per claim, and it never appears beside a moment you are answering</span>
  </div>
  <!--
    THE SET ITSELF, as a file.
    The runner (npm run eval:set) reads eval/set.jsonl, and the only way to
    produce one was to know the endpoint existed and curl it — so the route
    shipped with no caller and the fidelity check could not see that, because
    a comment mentioning the module satisfied it. Whoever is doing the
    labelling is the person who wants the file, so the link belongs where
    they already are.
  -->
  <div style="margin-top:8px">
    <a href="/api/eval/export" download="set.jsonl" style="font-size:${SIZE.meta};font-weight:600;color:${ACCENT.gold};text-decoration:none">Take the set away &nearr;</a>
    <span data-content style="font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink32}"> · every answer so far, as the file the runner reads</span>
  </div>`;
}

export function renderEval(d: EvalData): string {
  const pct = Math.min(100, Math.round((100 * d.labels) / ENOUGH_LABELS));

  const head = `<div data-content style="font-size:${SIZE.pageTitle};font-weight:600;letter-spacing:-0.022em">What backs what</div>
  <div data-content style="margin-top:7px;font-size:${SIZE.secondary};color:${C.ink45};line-height:1.6">Write a claim, then say whether each moment backs it. Nothing about how well search works means anything until this exists.</div>
  <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="flex:1 1 160px;min-width:min(140px,100%);height:4px;border-radius:2px;background:${C.pill};overflow:hidden;display:block"><span style="display:block;width:${pct}%;height:100%;background:${ACCENT.gold}"></span></span>
    <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${d.labels} of ${ENOUGH_LABELS}</span>
  </div>
  ${who(d)}

  <form method="GET" action="/eval" style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
    <input type="text" name="claim" value="${esc(d.claim?.text ?? "")}" autocomplete="off"
      placeholder="Something the footage might back"
      style="flex:1 1 240px;min-width:min(200px,100%);padding:11px 13px;border-radius:${RADIUS.card};background:${C.surface};border:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);color:${C.ink};font-family:inherit;font-size:${SIZE.body}"/>
    <button type="submit" style="flex:none;min-height:42px;font-size:${SIZE.body};font-weight:600;padding:10px 20px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;border:none;cursor:pointer;font-family:inherit">Find moments</button>
  </form>`;

  if (!d.claim) {
    return `${head}${claimList(d.claims)}`;
  }

  const body = d.foundNothing
    ? /*
       * A claim that finds nothing is a RESULT, not an empty screen — it is
       * the "nothing here backs this" case, and a set with none of them
       * cannot teach a threshold to say it.
       */
      `<div data-content style="margin-top:20px;padding:14px 16px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45};line-height:1.6">Nothing came back for that. Write it down anyway — a claim your footage does not back is worth as much to this as one it does.</div>`
    : `<div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">${d.candidates.map((c) => candidate(c, d.claim!.id)).join("")}</div>`;

  return `${head}
  <div data-claim="${esc(d.claim.id)}" style="margin-top:20px;padding:13px 15px;border-radius:${RADIUS.card};background:${C.raised};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
    <div data-content style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">THE CLAIM</div>
    <div data-content style="margin-top:6px;font-size:${SIZE.body};line-height:1.6">${esc(d.claim.text)}</div>
    ${
      /*
       * What this claim's answers add up to — PRECISION, and named as such.
       * Of the moments retrieval put in front of you, how many backed it.
       * Recall would need a set where every backing moment had been found,
       * and labelling what retrieval returned cannot establish that: the
       * moments it never surfaced were never judged. A precision figure
       * presented as recall is the kind of wrong that survives for months.
       */
      (() => {
        const judged = d.candidates.filter((c) => c.verdict);
        if (!judged.length) return "";
        const s = scoreClaim(judged.map((c) => ({ clipId: c.id, verdict: c.verdict! })));
        return `<div data-content style="margin-top:8px;font-size:${SIZE.meta};font-family:${FONT.mono};color:${C.ink45}">${s.backs} of ${s.judged} judged back it${s.related ? ` · ${s.related} near` : ""}</div>`;
      })()
    }
  </div>
  ${body}
  ${claimList(d.claims)}`;
}

function claimList(claims: EvalData["claims"]): string {
  if (!claims.length) return "";
  return `<div style="margin-top:28px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05)">
    <div data-content style="font-size:10.5px;font-weight:600;letter-spacing:.09em;color:${C.ink45}">CLAIMS SO FAR</div>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">${claims
      .map(
        (c) => `<a href="/eval?claim=${encodeURIComponent(c.text)}" style="display:flex;gap:10px;align-items:baseline;padding:9px 11px;border-radius:${RADIUS.card};background:${C.surface};text-decoration:none;color:inherit">
          <span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};color:${C.ink70};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.text)}</span>
          <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:${c.judged ? ACCENT.green : C.ink32}">${c.judged}</span>
        </a>`,
      )
      .join("")}</div>
  </div>`;
}
