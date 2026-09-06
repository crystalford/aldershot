/**
 * Build — the arranged piece as blocks.
 *
 * "Clips, your voice, reactions, generated visuals. `+` seams between blocks
 * insert a reaction, a voice line, or a clip from another video. Beats needing
 * your voice show Record and Generate it" (01-PRODUCT.md §Editor).
 *
 * Still no timeline: a beat is a block with text on it, and reordering is
 * moving a block. The seam is how anything gets in between.
 *
 * Layout is a two-column grid with the preview player sticky in column 2 —
 * transcribed from the prototype, not inferred. An earlier version of this
 * file stacked the beats full width with a 92px thumbnail glued to each
 * block's left edge; the prototype has no thumbnail in the block at all, and
 * the frame the user is looking at lives in the sticky player instead. That is
 * the whole point of the column: the picture stays put while you read down.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { iconArrowDown, iconArrowUp, iconPause, iconPlay } from "../icons.ts";
import { esc } from "../shell.ts";
import { hms, tc } from "./footage.ts";

export type BeatKind = "clip" | "vo" | "react" | "generated" | "stock";

export interface BuildBeat {
  id: string;
  idx: number;
  kind: BeatKind;
  act: string | null;
  text: string | null;
  dur_ms: number | null;
  media_r2_key: string | null;
  /** From the beat's clip, when it has one. */
  clip_id: string | null;
  quote: string | null;
  sourceFilename: string | null;
  start_ms: number | null;
  frame_r2_key: string | null;
}

export interface BuildData {
  projectId: string;
  /** The source video, so the preview can actually play. */
  sourceKey?: string | null;
  beats: BuildBeat[];
  /** Acts only exist on essays; a cut has none and the bar is hidden. */
  hasActs: boolean;
  /** The current playhead beat, for the sticky preview. */
  playIdx: number;
}

/**
 * The tag/meta/action matrix, transcribed from the prototype's beat
 * derivation. Each row is (kind + what the beat already has) → the chip, the
 * grey line under the text, and the button. The accent is never decorative:
 * green means a clip is attached, gold means it wants your voice, violet means
 * it will be generated, cyan means it comes from another source, red means
 * recording (02-DESIGN-SYSTEM.md §Colour).
 */
interface Tag {
  tag: string;
  accent: string;
  meta?: string;
  action?: string;
  /** White button = the primary thing to do on this beat. */
  primary?: boolean;
  action2?: string;
}

/*
 * Two formatters, deliberately: a POSITION in the source is padded
 * ("kino_372.mp4 · 03:42"), a DURATION is not ("0:18"). The prototype's demo
 * data shows both side by side, and using one for the other is the kind of
 * silent substitution that makes the product read wrong.
 */
function tagFor(b: BuildBeat): Tag {
  const has = !!b.media_r2_key;

  if (b.kind === "clip") {
    if (!b.clip_id) {
      return {
        tag: "Needs a clip",
        accent: ACCENT.green,
        meta: "Pull one from Footage — anything you've kept is fair game.",
        action: "Pick from Footage",
      };
    }
    return {
      tag: "Clip matched",
      accent: ACCENT.green,
      meta:
        b.sourceFilename && b.start_ms != null
          ? `${b.sourceFilename} · ${tc(b.start_ms / 1000)}`
          : b.quote
            ? `“${b.quote}” · from Footage`
            : undefined,
      action: "Swap clip",
    };
  }

  if (b.kind === "vo") {
    if (has) {
      return {
        tag: "Your voice",
        accent: ACCENT.green,
        meta: b.dur_ms ? `Recorded · ${hms(b.dur_ms / 1000)} — tap to play` : undefined,
        action: "Redo",
      };
    }
    return {
      tag: "Needs your voice",
      accent: ACCENT.gold,
      action: "Record",
      primary: true,
      action2: "Generate it",
    };
  }

  if (b.kind === "react") {
    if (has) {
      return {
        tag: "Your reaction",
        accent: ACCENT.gold,
        meta: b.dur_ms ? `On camera · ${hms(b.dur_ms / 1000)} — plays between the clips` : undefined,
        action: "Redo",
      };
    }
    return {
      tag: "Needs your reaction",
      accent: ACCENT.gold,
      meta: "Camera + mic, sandwiched between the clip before and whatever's next.",
      action: "Record reaction",
      primary: true,
    };
  }

  if (b.kind === "stock") {
    if (b.clip_id) {
      return { tag: "Clip matched", accent: ACCENT.green, action: "Swap" };
    }
    return {
      tag: "Needs a clip",
      accent: ACCENT.cyan,
      meta: "Pick one from Footage — it'll suggest the closest matches first.",
      action: "Pick a clip",
    };
  }

  if (has) {
    return {
      tag: "Visual queued",
      accent: ACCENT.violet,
      meta: "It'll generate this while you work on the rest.",
    };
  }
  return { tag: "Will generate", accent: ACCENT.violet, action: "Generate" };
}

/** The `+` between two blocks. 22px circle, inset ring, no border. */
function seam(projectId: string, atIdx: number): string {
  return `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:2px 4px">
    <button class="seam" data-project="${esc(projectId)}" data-at="${atIdx}" title="Add a beat here — clip, voice, reaction, or a visual" style="width:22px;height:22px;border-radius:50%;background:${C.surface};color:${C.ink32};display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);border:none;padding:0;font-family:${FONT.ui}">+</button>
  </div>`;
}

function moveButton(id: string, dir: -1 | 1, disabled: boolean): string {
  const label = dir === -1 ? "Move earlier" : "Move later";
  return `<button class="move-beat" data-beat="${esc(id)}" data-dir="${dir}" ${disabled ? "disabled" : ""} aria-label="${label}" style="width:22px;height:22px;border-radius:4px;background:${C.pill};display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;border:none;padding:0${disabled ? ";opacity:.35;cursor:default" : ""}">${dir === -1 ? iconArrowUp({ size: 10, stroke: C.ink70 }) : iconArrowDown({ size: 10, stroke: C.ink70 })}</button>`;
}

function actionButton(label: string, primary: boolean, beatId: string): string {
  const bg = primary ? C.ink : C.pill;
  const color = primary ? "#131316" : C.ink70;
  return `<button class="beat-action" data-beat="${esc(beatId)}" data-action="${esc(label)}" style="font-size:${SIZE.secondary};font-weight:500;padding:7px 14px;border-radius:${RADIUS.button};background:${bg};color:${color};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">${esc(label)}</button>`;
}

function beatBlock(b: BuildBeat, i: number, total: number): string {
  const t = tagFor(b);

  return `<div class="beat" data-beat="${esc(b.id)}" style="padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;align-items:center;gap:9px">
      ${b.act ? `<span data-content style="font-size:${SIZE.meta};color:${C.ink32}">${esc(b.act)}</span>` : ""}
      <span data-content style="font-size:${SIZE.meta};padding:2px 7px;border-radius:4px;background:${accentBg(t.accent)};color:${t.accent}">${esc(t.tag)}</span>
      <span data-content style="margin-left:auto;font-size:${SIZE.meta};color:rgba(236,236,241,0.3);font-family:${FONT.mono}">${b.dur_ms ? hms(b.dur_ms / 1000) : "0:00"}</span>
      ${moveButton(b.id, -1, i === 0)}
      ${moveButton(b.id, 1, i === total - 1)}
      <button class="remove-beat" data-beat="${esc(b.id)}" style="font-size:${SIZE.meta};color:rgba(236,236,241,0.3);cursor:pointer;flex:none;padding:0 2px;background:none;border:none;font-family:${FONT.ui}">Remove</button>
    </div>
    <textarea data-content class="beat-text" data-beat="${esc(b.id)}" rows="2" placeholder="What happens in this beat?" style="width:100%;box-sizing:border-box;margin-top:16px;background:transparent;border:none;outline:none;color:rgba(236,236,241,0.92);font-size:15.5px;line-height:1.55;resize:none;padding:0;font-family:${FONT.ui}">${esc(b.text || "")}</textarea>
    ${t.meta ? `<div data-content style="font-size:${SIZE.secondary};color:rgba(236,236,241,0.38);margin-top:6px">${esc(t.meta)}</div>` : ""}
    ${
      t.action
        ? `<div style="margin-top:16px;display:flex;gap:6px;flex-wrap:wrap">
            ${actionButton(t.action, !!t.primary, b.id)}
            ${t.action2 ? actionButton(t.action2, false, b.id) : ""}
          </div>`
        : ""
    }
  </div>`;
}

/**
 * The act progress bar. Green when every beat in the act is filled, gold when
 * some are, and the dead grey `#26262C` when none are — the prototype's own
 * three states, so a glance down the bar tells you where the holes are.
 */
function actBar(beats: BuildBeat[]): string {
  const ACTS = ["Hook", "Setup", "Development", "Turn", "Resolution"];
  const filled = (b: BuildBeat) => b.kind === "clip" ? !!b.clip_id : !!b.media_r2_key;

  return `<div style="margin-top:18px;display:flex;gap:3px">${ACTS.map((name) => {
    const inAct = beats.filter((b) => b.act === name);
    const done = inAct.filter(filled).length;
    const color = inAct.length && done === inAct.length ? ACCENT.green : done > 0 ? ACCENT.gold : "#26262C";
    return `<div style="flex:${inAct.length || 1};min-width:0">
      <div style="height:5px;border-radius:99px;background:${color}"></div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink32};margin-top:5px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
    </div>`;
  }).join("")}</div>`;
}

/** The pass composer — every instruction the user gives, in their words. */
function passComposer(projectId: string): string {
  return `<div style="margin-top:14px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface}">
    <!-- Scripted, not a form post: this posted to /p/:id/pass, which does not
         exist and 404'd every time. The pass endpoint is
         /api/projects/:id/passes and answers with JSON. -->
    <div class="pass-composer" data-project="${esc(projectId)}" style="display:flex;gap:8px;align-items:center;background:#131316;border-radius:${RADIUS.input};padding:4px 4px 4px 12px;flex-wrap:wrap">
      <input class="pass-input" placeholder="Tell it what you want — “tighten the middle” · “add a reaction after the schedule clip”" style="flex:1 1 200px;min-width:min(180px,100%);background:transparent;border:none;outline:none;color:${C.ink};font-size:13px;padding:7px 0;font-family:${FONT.ui}"/>
      <button type="button" class="pass-run" style="flex:none;font-size:${SIZE.secondary};font-weight:600;padding:7px 15px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">Run it</button>
    </div>
  </div>`;
}

/**
 * The sticky preview. The frame, the act chip over it, the beat's line burned
 * across the bottom, then a scrub bar whose segments are the beats themselves
 * — each one flexed by its duration and edged in its kind's colour. This is
 * the closest the product ever gets to a timeline, and it is read-only.
 */
function preview(d: BuildData): string {
  const durs = d.beats.map((b) => b.dur_ms ?? 0);
  const total = durs.reduce((a, n) => a + n, 0);
  const cur = d.beats[Math.min(d.playIdx, d.beats.length - 1)];
  const EDGE: Record<BeatKind, string> = {
    clip: ACCENT.green,
    vo: ACCENT.gold,
    react: ACCENT.gold,
    stock: ACCENT.cyan,
    generated: ACCENT.violet,
  };

  const blocks = d.beats
    .map(
      (b, i) =>
        `<button class="es-seek" data-idx="${i}" data-at="${b.start_ms ?? 0}" style="flex:${b.dur_ms ?? 1};border-radius:3px;background:${i === d.playIdx ? "#3A3A45" : C.pill};cursor:pointer;position:relative;overflow:hidden;min-width:6px;border:none;padding:0">
          <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:${EDGE[b.kind]}"></div>
        </button>`,
    )
    .join("");

  return `<div style="border-radius:11px;overflow:hidden;background:#000;box-shadow:0 0 0 1px rgba(255,255,255,0.07)">
    <div style="position:relative;width:100%;aspect-ratio:16/9;background:#07070a;overflow:hidden">
      ${
        /*
         * A real video, not a picture of one. The play button and the scrubber
         * were rendered and wired to nothing — the preview looked like a
         * player and could not play. Range requests on /media are what make
         * seeking to a beat work without downloading the whole source.
         */
        d.sourceKey
          ? `<video id="es-video" preload="metadata" playsinline ${cur?.frame_r2_key ? `poster="/media/${esc(cur.frame_r2_key)}"` : ""} src="/media/${esc(d.sourceKey)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#07070a"></video>`
          : cur?.frame_r2_key
            ? `<img loading="lazy" src="/media/${esc(cur.frame_r2_key)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"/>`
            : ""
      }
      <div style="position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden">
        <div style="padding:12px 14px;flex:none">${cur?.act ? `<span data-content style="font-size:${SIZE.meta};font-weight:600;color:rgba(255,255,255,0.85);background:rgba(0,0,0,0.55);padding:3px 8px;border-radius:4px">${esc(cur.act)}</span>` : ""}</div>
        <!-- CLAMPED. A beat's text is a transcript quote and can be a
             paragraph; this was unbounded and absolutely positioned, so a long
             one grew straight through the bottom of the frame and printed
             itself over the play button and the scrubber. Three lines, faded
             out at the cut, with the full text still readable in the beat
             block beside it. -->
        <div style="padding:0 18px 16px;flex:none;min-height:0">
          <div data-content style="font-size:15.5px;line-height:1.45;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,0.8);max-width:85%;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(cur?.text ?? "")}</div>
        </div>
      </div>
    </div>
    <div style="padding:11px 13px;background:#131316;display:flex;align-items:center;gap:12px">
      <!-- Both icons rendered, one hidden — the same shape the prototype uses, and
     it keeps every SVG inside icons.ts where the icon check requires them. -->
      <button id="es-toggle" aria-label="Play" style="flex:none;width:32px;height:32px;border-radius:${RADIUS.button};background:${C.ink};display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;padding:0">
        <span data-play>${iconPlay(12, "#131316")}</span>
        <span data-pause hidden>${iconPause(12, "#131316")}</span>
      </button>
      <div style="flex:1;display:flex;gap:2px;align-items:stretch;height:24px">${blocks}</div>
      <span data-content style="flex:none;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(236,236,241,0.4)">0:00 / ${hms(total / 1000)}</span>
    </div>
  </div>
  <div data-content style="font-size:${SIZE.meta};color:${C.ink32};margin-top:8px;line-height:1.5">Space to play or pause, ← → to step between beats.</div>`;
}

/** The panel under the last seam — start a beat from nothing. */
function addBeat(projectId: string, hasActs: boolean): string {
  const ACTS = ["Hook", "Setup", "Development", "Turn", "Resolution"];
  /*
   * The prototype's own labels, which describe the act rather than the data
   * type — "Me talking", not "Voiceover". A cut has no acts, and then only the
   * first three are offered.
   */
  const ALL: Array<[BeatKind, string]> = [
    ["clip", "A clip from my footage"],
    ["vo", "Me talking"],
    ["react", "A reaction to the clip before"],
    ["stock", "Something real to back it"],
    ["generated", "A visual it makes"],
  ];
  const KINDS = hasActs ? ALL : ALL.filter(([k]) => k === "clip" || k === "vo" || k === "react");
  const chip = (label: string, name: string, value: string) =>
    `<button type="button" class="add-beat" data-project="${esc(projectId)}" data-${name}="${esc(value)}" style="font-size:${SIZE.secondary};font-weight:500;padding:5px 11px;border-radius:${RADIUS.button};background:${C.raised};color:${C.ink};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">${esc(label)}</button>`;

  /* Which act the new beat lands in. Development is the prototype's default. */
  const actChip = (a: string) =>
    `<label class="act-pick" style="font-size:${SIZE.secondary};font-weight:500;padding:5px 11px;border-radius:${RADIUS.button};background:${a === "Development" ? C.active : C.pill};color:${C.ink};cursor:pointer;white-space:nowrap">
      <input type="radio" name="act" value="${esc(a)}" ${a === "Development" ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none"/>${esc(a)}
    </label>`;

  return `<div id="add-beat" data-project="${esc(projectId)}" style="margin-top:16px;padding:16px 18px;border-radius:${RADIUS.card};background:#141418;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05)">
    <div data-content style="font-size:${SIZE.secondary};font-weight:600;color:${C.ink45}">Add a beat</div>
    ${hasActs ? `<div style="margin-top:9px;display:flex;gap:5px;flex-wrap:wrap">${ACTS.map((a) => actChip(a)).join("")}</div>` : ""}
    <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">${KINDS.map(([k, label]) => chip(label, "kind", k)).join("")}</div>
  </div>`;
}

export function renderBuild(d: BuildData): string {
  if (!d.beats.length) {
    /*
     * A stage with nothing on it still has to be a tool.
     *
     * This was one grey sentence in a box — "nothing laid down yet." — and no
     * way to lay anything down, so opening Build on a new edit was a dead
     * screen with four tabs above it. The panel that adds the first beat
     * already existed and was already wired; it was simply never shown until
     * a beat existed, which is the one moment you do not need it.
     */
    return `<div data-content style="margin-top:22px;font-size:${SIZE.secondary};color:${C.ink45};max-width:520px;line-height:1.6">Nothing laid down yet. Build is where a cut becomes a piece — your clips in an order, with your own voice between them.</div>
    ${addBeat(d.projectId, d.hasActs)}`;
  }

  const blocks = d.beats
    .map((b, i) => beatBlock(b, i, d.beats.length) + seam(d.projectId, i + 1))
    .join("");

  return `${passComposer(d.projectId)}
  ${d.hasActs ? actBar(d.beats) : ""}
  <div id="build" data-project="${esc(d.projectId)}" style="margin-top:18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,300px);gap:22px;align-items:start">
    <div style="grid-column:2;grid-row:1;position:sticky;top:20px;min-width:0">${preview(d)}</div>
    <div style="grid-column:1;grid-row:1;min-width:0">
      <div style="display:flex;flex-direction:column;gap:6px">
        ${seam(d.projectId, 0)}${blocks}
      </div>
      ${addBeat(d.projectId, d.hasActs)}
    </div>
  </div>`;
}

/**
 * The tail of Build's lede: what is still missing, in the prototype's own
 * phrasing — "2 voiceovers, 1 clip to go." or "every beat is filled."
 *
 * Counted from the beats themselves rather than stored, so it cannot drift out
 * of step with the blocks below it.
 */
export function buildSummary(
  beats: Array<{ kind: string; media_r2_key: string | null; clip_id: string | null }>,
  kind = "essay",
): string {
  if (!beats.length) return "nothing laid down yet.";

  const voLeft = beats.filter((b) => (b.kind === "vo" || b.kind === "react") && !b.media_r2_key).length;
  const srcLeft = beats.filter((b) => (b.kind === "clip" || b.kind === "stock") && !b.clip_id).length;
  const genLeft = beats.filter((b) => b.kind === "generated" && !b.media_r2_key).length;

  const parts: string[] = [];
  if (voLeft) parts.push(`${voLeft} ${kind === "reaction" ? "reaction" : "voiceover"}${voLeft > 1 ? "s" : ""}`);
  if (srcLeft) parts.push(`${srcLeft} clip${srcLeft > 1 ? "s" : ""}`);
  if (genLeft) parts.push(`${genLeft} visual${genLeft > 1 ? "s" : ""}`);

  return parts.length ? `${parts.join(", ")} to go.` : "every beat is filled.";
}
