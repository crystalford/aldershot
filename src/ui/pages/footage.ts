/**
 * Footage — the library. Three tabs: Moments (clips), Threads (clips grouped
 * by meaning), Sources (the long videos, clickable straight into the editor).
 *
 * Phase 1 fills Sources, because that is what ingest produces. Moments and
 * Threads need the score pass (Phase 2) and embeddings (Phase 5); until then
 * they show their real empty states rather than a fabricated preview.
 */

import { C, ACCENT, FONT, RADIUS, SIZE, accentBg } from "../tokens.ts";
import { esc } from "../shell.ts";
import { emptyState, pageHeading } from "./empty.ts";
import { iconPause, iconPlay, iconSearch } from "../icons.ts";
import { itemMenu } from "../item-menu.ts";
import { selectBar, selectBox } from "../select-bar.ts";

export type FootTab = "moments" | "threads" | "sources" | "exports" | "find";

export interface SourceRow {
  id: string;
  title: string;
  filename: string | null;
  duration_s: number | null;
  transcript_state: "pending" | "running" | "ready" | "failed";
  poster_r2_key: string | null;
  created_at: number;
  /** Live read progress, so the row shows a bar rather than a bare label. */
  pct?: number;
  /** What has come out of this video, and what is being made from it. */
  clip_count?: number;
  edit_count?: number;
}

/**
 * A POSITION in the source: zero-padded, "03:38" / "1:02:47".
 *
 * Distinct from hms() on purpose. The prototype pads positions but not
 * durations — "03:42 in the original" against "0:42" for how long a clip
 * runs — and mixing them makes columns of timecodes fail to line up.
 */
export function tc(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
}

/** A DURATION: m:ss, or h:mm:ss past an hour. Unpadded. */
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * The state a source is in, in the words the design uses, with the accent that
 * means that thing. Never a raw enum — "pending" is not a word the user said.
 */
function stateChip(state: SourceRow["transcript_state"]): string {
  const map: Record<SourceRow["transcript_state"], [string, string]> = {
    pending: ["Queued", C.ink45],
    running: ["Reading", ACCENT.gold],
    ready: ["Ready", ACCENT.green],
    // The prototype's own word for this state, and its own red.
    failed: ["Failed", ACCENT.red],
  };
  const [label, color] = map[state];
  return `<span style="flex:none;font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${color}">${esc(label)}</span>`;
}

/*
 * The tabs are named for what is behind them, and carry their counts:
 * "Clips · 23". They were "Moments / Threads / Sources", which is the
 * vocabulary of the data model rather than the product's — and the Find tab
 * was missing altogether. A count of null renders bare, which is why Find has
 * no number.
 */
function tabs(active: FootTab, counts: Partial<Record<FootTab, number>>): string {
  const all: Array<[FootTab, string]> = [
    ["moments", "Clips"],
    ["threads", "Threads"],
    ["sources", "Videos"],
    /*
     * WHAT YOU HAVE FINISHED.
     *
     * A rendered cut lived only in the Exports strip inside the one edit that
     * made it, so finding last week's meant remembering which edit that was.
     * The owner said it the moment his first export worked: "that should also
     * be saved to a place of finished or exported or whatever."
     *
     * Here rather than behind a fifth nav item, because Footage is already
     * "everything you have" and a finished cut is a video you own as much as
     * an upload is. Every extra surface has made this product feel MORE
     * redundant, not less.
     */
    ["exports", "Exports"],
    ["find", "Find"],
  ];
  const items = all
    /*
     * A tab you can never fill is a lie.
     *
     * NOTHING in this codebase creates a thread — the tables are read in four
     * places and written in none — so "Threads · 0" was permanent, and it read
     * as "you have not made any yet" rather than "this does not exist". It is
     * blocked on the same thing meaning-search is: threads are clusters of
     * clip embeddings, and VECTORIZE is deliberately unbound until the index
     * is created (see wrangler.jsonc).
     *
     * The tab is not deleted, it is conditional — the day something writes a
     * thread, it comes back on its own. Same rule as a clean-up chip that
     * shows no count when it has nothing to count.
     */
    .filter(([id]) => id !== "threads" || (counts.threads ?? 0) > 0 || active === "threads")
    /*
     * And Find, by the same rule, which it had somehow escaped.
     *
     * Its whole content is a disabled field and the sentence "Reading captions
     * from a link isn't switched on yet." — a top-level tab that has never
     * been able to do anything. The panel and the route stay exactly where
     * they are, so the day it works this is one condition to flip.
     */
    .filter(([id]) => id !== "find" || active === "find");

  return `<div style="margin-top:18px;display:flex;gap:4px;border-bottom:1px solid ${C.hairline}">${items
    .map(([id, label]) => {
      const n = counts[id];
      return `<a href="/footage?tab=${id}" style="font-size:${SIZE.body};font-weight:500;padding:9px 14px;color:${
        id === active ? C.ink : C.ink45
      };border-bottom:2px solid ${id === active ? C.ink : "transparent"};margin-bottom:-1px;white-space:nowrap">${label}${n == null ? "" : ` · ${n}`}</a>`;
    })
    .join("")}</div>`;
}

/**
 * The thread filter chips above the clip grid — a coloured dot, the thread's
 * name, and its count in mono. "Everything" leads and is selected by default.
 * The dot colour comes from the thread's position, so a thread keeps the same
 * colour everywhere it appears.
 */
const THREAD_DOTS = [ACCENT.gold, ACCENT.violet, ACCENT.green, ACCENT.cyan, ACCENT.red];

function threadChips(threads: ThreadRow[], total: number, active: string | null): string {
  const chip = (name: string, count: number, dot: string, href: string, on: boolean) =>
    `<a href="${href}" style="display:flex;align-items:center;gap:7px;font-size:${SIZE.secondary};padding:7px 13px;border-radius:${RADIUS.button};background:${on ? C.active : C.pill};color:${on ? C.ink : C.ink70};font-weight:500;white-space:nowrap">
      <span style="width:6px;height:6px;border-radius:50%;background:${dot}"></span>${esc(name)} <span data-content style="color:${C.ink32};font-family:${FONT.mono};font-size:${SIZE.meta}">${count}</span>
    </a>`;

  return `<div style="margin-top:24px;display:flex;gap:6px;flex-wrap:wrap">
    ${chip("Everything", total, C.ink45, "/footage?tab=moments", !active)}
    ${threads
      .map((t, i) =>
        chip(t.name, t.clip_count, THREAD_DOTS[i % THREAD_DOTS.length], `/footage?tab=moments&thread=${encodeURIComponent(t.id)}`, active === t.id),
      )
      .join("")}
  </div>`;
}

/**
 * One video in Footage.
 *
 * A CARD, not a row.
 *
 * Footage is a library of videos, and it was rendering as a list of text rows
 * with three buttons on the end of each — 76px of poster and everything else
 * words. Seven videos meant twenty-eight click targets, which is what the
 * owner meant by "it's a nightmare to use". It also made Footage look exactly
 * like Home, Editor and Clipping, which are also a title over a stack of rows:
 * four surfaces that hold four different things and looked like one thing.
 *
 * A library of video looks like video. The poster is the card, the title sits
 * under it, and the whole card opens the editor — so the primary action needs
 * no button at all. "Edit" was dropped for exactly that reason: it duplicated
 * clicking the card. The two that remain are different jobs, not the same one
 * again, and they sit quietly beneath.
 *
 * While it is still being read the card shows real progress instead, since
 * none of those actions can work yet.
 */
function sourceCard(s: SourceRow): string {
  /* The duration is stamped on the poster, so repeating it here printed
     "0:20 · test · 0:20 · 30 Aug" across every card. */
  const added = new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  /*
   * WHAT IS IN IT, which is the whole subject of this page.
   *
   * A card said its title and the date. Clipping's little picker strip says
   * "11 clips found"; the library page said less than the picker did — and
   * with sixteen clips across two videos there was no way to tell which came
   * from where without leaving. The edits count is the footage/edit
   * relationship this product is built on, and Footage was the one surface
   * that never mentioned it.
   *
   * A zero is not shown. "0 clips" on a video nobody has scanned reads as a
   * verdict on the video rather than as the absence of a pass — the same rule
   * the score badge follows.
   */
  const meta = [
    added,
    s.clip_count ? `${s.clip_count} clip${s.clip_count === 1 ? "" : "s"}` : "",
    s.edit_count ? `${s.edit_count} edit${s.edit_count === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const ready = s.transcript_state === "ready";
  const working = s.transcript_state === "running" || s.transcript_state === "pending";

  const poster = s.poster_r2_key
    ? `<img loading="lazy" src="/media/${esc(s.poster_r2_key)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>`
    : "";

  /* The duration rides on the poster the way it does on every video service,
     which is one fewer line of text under the card and reads faster. */
  const stamp = s.duration_s
    ? `<span style="position:absolute;right:6px;bottom:6px;font-size:${SIZE.meta};font-family:${FONT.mono};background:rgba(0,0,0,.66);color:${C.ink};border-radius:3px;padding:1px 5px">${hms(s.duration_s)}</span>`
    : "";

  /* Not ready: the card says so over its own poster rather than beside it, so
     an unusable card reads as unusable at a glance. */
  const veil = ready
    ? ""
    : `<div style="position:absolute;inset:0;background:rgba(11,11,14,0.72);display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:10px">
        ${
          working && s.pct
            ? `<div style="height:3px;border-radius:99px;background:#26262C;overflow:hidden"><div style="width:${Math.max(2, s.pct)}%;height:100%;background:${ACCENT.green};border-radius:99px"></div></div>`
            : `<div style="align-self:flex-start">${stateChip(s.transcript_state)}</div>`
        }
      </div>`;

  const cardStyle = `display:block;position:relative;width:100%;aspect-ratio:16/9;border-radius:${RADIUS.card};overflow:hidden;background:#0B0B0E;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)`;

  const art = `<div style="${cardStyle}">${poster}${ready ? stamp : ""}${veil}</div>`;

  /* Poster AND title in one link. They were separate, so the title — which is
     what people actually aim at — was not clickable. */
  const label = `<div style="min-width:0;margin-top:9px">
      <div data-content style="font-size:${SIZE.secondary};font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</div>
      <div data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:2px;font-family:${FONT.mono}">${esc(meta)}</div>
    </div>`;

  return `<div data-item-row style="position:relative;display:flex;flex-direction:column;gap:9px">
    ${selectBox("sources", s.id)}
    ${
      ready
        ? `<a href="/sources/${esc(s.id)}/edit" style="display:block;color:${C.ink}"><div style="${cardStyle}">${poster}${stamp}</div>${label}</a>`
        : art + label
    }
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${
        ready
          ? `<a href="/clipping?source=${esc(s.id)}" style="font-size:${SIZE.meta};font-weight:500;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};white-space:nowrap">Clip it</a>
             <button type="button" class="source-go" data-source="${esc(s.id)}" data-brief="React to it" style="font-size:${SIZE.meta};font-weight:500;padding:5px 10px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};cursor:pointer;white-space:nowrap;border:none;font-family:${FONT.ui}">React to it</button>`
          : ""
      }
      <!-- Rename and delete belong on a video too, and a video that failed to
           read needs them MOST — it is otherwise a permanent broken row. -->
      <div style="margin-left:auto">${itemMenu("sources", s.id, s.title, "video")}</div>
    </div>
  </div>`;
}

export interface MomentRow {
  id: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  why: string | null;
  origin: string;
  used_count: number;
  frame_r2_key: string;
  source_id: string;
  source_title: string;
  /** The footage's own object, so the moment can play its range in place. */
  source_key: string;
  /** A finished 9:16 short of this moment, when one has been made. */
  short_key: string | null;
  thread_name: string | null;
}

export interface ThreadRow {
  id: string;
  name: string;
  summary: string | null;
  clip_count: number;
  sample: string | null;
}

export type SearchMode = "meaning" | "exact";

/**
 * Two ways to search the library (01-PRODUCT.md §Footage). They are genuinely
 * different questions, so they get different prompts: meaning describes the
 * kind of clip, exact searches the words that were said.
 */
function searchBox(tab: FootTab, mode: SearchMode, q: string, canMean: boolean): string {
  /*
   * One placeholder, not two. The prototype asks the same question either way
   * — the mode chips below say how it will be answered — and swapping the
   * prompt on mode change made the field feel like two different controls.
   */
  const placeholder = "Search clips or ask — “every contradiction” · “studio visuals”";

  /* Chips, below the field: "By meaning" / "Exact words". */
  const chip = (m: SearchMode, label: string, notYet = false) =>
    `<a href="/footage?tab=${tab}&mode=${m}${q ? `&q=${encodeURIComponent(q)}` : ""}" style="font-size:${SIZE.secondary};font-weight:500;padding:5px 11px;border-radius:${RADIUS.button};background:${
      m === mode ? C.active : C.pill
    };color:${m === mode ? C.ink : "rgba(236,236,241,0.5)"};white-space:nowrap;${notYet ? "opacity:.45;" : ""}">${label}</a>`;

  return `<form method="GET" action="/footage">
    <input type="hidden" name="tab" value="${tab}"/>
    <input type="hidden" name="mode" value="${mode}"/>
    <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="flex:1 1 280px;min-width:min(260px,100%)">
        <div style="display:flex;align-items:center;gap:8px;background:${C.raised};border-radius:${RADIUS.card};padding:9px 13px;box-shadow:0 0 0 1px ${C.hairline}">
          ${iconSearch({ size: 14, stroke: "rgba(236,236,241,0.4)" })}
          <input name="q" value="${esc(q)}" placeholder="${esc(placeholder)}" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${C.ink};font-size:${SIZE.body};font-family:${FONT.ui}"/>
        </div>
      </div>
      <label style="flex:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:${RADIUS.button};background:${C.ink};color:#131316;cursor:pointer;white-space:nowrap">Upload<input type="file" accept="video/*" multiple id="footageUpload" style="display:none"/></label>
    </div>
    <!-- The mode that cannot work is still offered, because it will work once
         the index exists and hiding it would hide the feature. It is dimmed,
         so the choice reads as "not yet" rather than "your library is empty".
         The notice below the field says so in words when a search runs. -->
    <div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap">${chip("meaning", "By meaning", !canMean)}${chip("exact", "Exact words")}</div>
  </form>`;
}

/**
 * One moment, and the three things you can do with it.
 *
 * This was a <div> with a still and some text in it — no link, no player, no
 * control of any kind. Sixteen dead cards. The owner: "i can't click any
 * clips in footage -> clips".
 *
 * A moment is a RANGE of a video, so it plays as one: a video element given
 * #t=start,end plays exactly that stretch, with no render and no second file.
 * Once a 9:16 short has actually been made of it, the card shows the short
 * instead of offering to make it again.
 */
function momentCard(m: MomentRow): string {
  const used = m.used_count > 0 ? `used in ${m.used_count} ${m.used_count === 1 ? "essay" : "essays"}` : null;
  const from = m.start_ms / 1000;
  const to = m.end_ms / 1000;

  /*
   * ITS OWN MOMENT, and our own player.
   *
   * frame_r2_key is the SOURCE's poster, so every clip of one video wore the
   * same image — black, on footage that opens dark. The canvas underneath is
   * painted by seeking to this moment's own time, the same seek-and-draw the
   * editor uses for block rows and Clipping for short cards; one definition,
   * called from three places.
   *
   * And `controls` was Chrome's own player, the last one left in the product
   * after the editor's and Clipping's were replaced today.
   *
   * preload="none": a grid of clips is a grid of VIDEOS, and asking each one
   * for its metadata on page load is a range request per card before anybody
   * has pressed anything. The browser fetches when you play.
   */
  const src = m.short_key ? `/media/${esc(m.short_key)}` : `/media/${esc(m.source_key)}#t=${from},${to}`;

  const media = `<canvas class="short-frame" data-media="${esc(m.source_key)}" data-at="${m.start_ms}" width="320" height="180"
      style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
    <video preload="none" playsinline src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:transparent"></video>
    <div class="player" style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:7px;padding:6px 8px;background:linear-gradient(to top,rgba(8,8,10,.86),rgba(8,8,10,0))">
      <button class="pl-play" aria-label="Play" style="flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:${RADIUS.button};background:transparent;border:none;cursor:pointer">
        <span class="pl-i-play" style="display:grid">${iconPlay(11, C.ink)}</span>
        <span class="pl-i-pause" hidden>${iconPause(11, C.ink)}</span>
      </button>
      <div class="pl-track" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        style="position:relative;flex:1;height:14px;cursor:pointer;touch-action:none">
        <div style="position:absolute;left:0;right:0;top:6px;height:2px;background:rgba(255,255,255,0.22)"></div>
        <div class="pl-played" style="position:absolute;left:0;top:6px;width:0;height:2px;background:${C.ink}"></div>
      </div>
      <span class="pl-now" data-content style="flex:none;font-size:${SIZE.pill};font-family:${FONT.mono};color:${C.ink};font-variant-numeric:tabular-nums">0:00</span>
      <button class="pl-full" aria-label="Fullscreen" style="flex:none;font-size:${SIZE.pill};font-weight:600;padding:0 4px;background:transparent;border:none;color:${C.ink};cursor:pointer;font-family:${FONT.ui}">Full</button>
    </div>`;

  return `<div data-moment="${esc(m.id)}" style="display:flex;flex-direction:column;border-radius:${RADIUS.card};background:${C.surface};overflow:hidden">
    <div style="position:relative;aspect-ratio:16/9;background:#0B0B0E">
      ${media}
      ${
        m.short_key
          ? `<span data-content style="position:absolute;left:6px;top:6px;font-size:${SIZE.pill};font-weight:600;padding:2px 7px;border-radius:4px;background:${accentBg(ACCENT.green)};color:${ACCENT.green};pointer-events:none">Short</span>`
          : ""
      }
      <!-- Above the player bar, not on top of its Fullscreen button. -->
      <span data-content style="position:absolute;right:6px;bottom:34px;font-size:${SIZE.meta};font-family:${FONT.mono};color:rgba(255,255,255,0.8);background:rgba(0,0,0,0.55);padding:1px 5px;border-radius:3px;pointer-events:none">${hms((m.end_ms - m.start_ms) / 1000)}</span>
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:5px;flex:1">
      ${m.thread_name ? `<div data-content style="font-size:${SIZE.pill};font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${ACCENT.cyan}">${esc(m.thread_name)}</div>` : ""}
      <div data-content style="font-size:${SIZE.secondary};line-height:1.5;color:${C.ink}">${esc(m.quote.slice(0, 120))}</div>
      <!-- Where it came from, as a link. A moment belongs to a video and you
           should be able to get to it — that is the whole footage/edit
           relationship in one line. -->
      <a href="/sources/${esc(m.source_id)}" data-content style="font-size:${SIZE.meta};color:${C.ink45};margin-top:auto;padding-top:4px">${esc(m.source_title)} · ${hms(m.start_ms / 1000)}${used ? ` · ${used}` : ""}</a>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-top:8px">
        ${
          m.short_key
            ? `<a href="/media/${esc(m.short_key)}?download=1" style="font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink}">Download</a>`
            : `<button class="moment-short" data-clip="${esc(m.id)}" style="font-size:${SIZE.meta};font-weight:600;padding:6px 11px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink70};border:none;cursor:pointer;font-family:${FONT.ui}">Make a short</button>`
        }
      </div>
    </div>
  </div>`;
}

function threadCard(t: ThreadRow): string {
  return `<div style="padding:16px 18px;border-radius:${RADIUS.card};background:${C.surface}">
    <div style="display:flex;align-items:baseline;gap:10px">
      <div data-content style="font-size:${SIZE.body};font-weight:600">${esc(t.name)}</div>
      <span data-content style="font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${t.clip_count}</span>
    </div>
    ${t.summary ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:5px;line-height:1.5">${esc(t.summary)}</div>` : ""}
    ${t.sample ? `<div data-content style="font-size:${SIZE.secondary};color:${C.ink70};margin-top:8px">“${esc(t.sample.slice(0, 100))}”</div>` : ""}
  </div>`;
}

/**
 * One finished export, as a row.
 *
 * A row rather than a card: these are files you go and get, identified by
 * which edit made them and how long they run, and a wall of 16:9 thumbnails
 * of the same footage tells you less than the titles do.
 */
function exportRow(r: ExportRow): string {
  if (!r.r2_key) return "";
  const size = r.bytes
    ? r.bytes / 1e9 >= 1
      ? `${(r.bytes / 1e9).toFixed(1)} GB`
      : `${Math.round(r.bytes / 1e6)} MB`
    : "";
  const meta = [r.duration_s ? hms(r.duration_s) : null, r.format.startsWith("mp4") ? r.aspect : r.format, size]
    .filter(Boolean)
    .join(" · ");
  const name = `<span data-content style="flex:1;min-width:0;font-size:${SIZE.secondary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title ?? "")}</span>`;
  return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:${RADIUS.card};background:${C.surface}">
    <span style="flex:none;width:6px;height:6px;border-radius:50%;background:${ACCENT.green}"></span>
    ${r.href ? `<a href="${esc(r.href)}" style="flex:1;min-width:0;display:flex">${name}</a>` : name}
    <span data-content style="flex:none;font-size:${SIZE.meta};color:${C.ink45};font-family:${FONT.mono}">${esc(meta)}</span>
    <a href="/media/${esc(r.r2_key)}?download=1" style="flex:none;font-size:${SIZE.meta};font-weight:600;padding:6px 12px;border-radius:${RADIUS.button};background:${C.ink};color:#131316">Download</a>
  </div>`;
}

export interface FootageData {
  tab: FootTab;
  sources: SourceRow[];
  /** The moments SHOWN — only loaded on the Clips tab. */
  moments: MomentRow[];
  /**
   * How many there are, whichever tab you are on.
   *
   * This used to be `moments.length`, and moments is only fetched on the
   * Clips tab — so every other tab read "Clips · 0" and clicking it showed
   * sixteen. A count that disagrees with the list it counts is worse than no
   * count: it is the tab bar telling you there is nothing there.
   */
  momentCount: number;
  threads: ThreadRow[];
  mode: SearchMode;
  q: string;
  /** True when meaning search is asked for but the index is not available. */
  meaningUnavailable: boolean;
  /** Whether meaning search can work at all — the index has to exist. */
  canMean: boolean;
  /** The thread being filtered to, or null for "Everything". */
  thread: string | null;
  /** How the video grid is ordered. */
  sort?: string;
  /**
   * Finished exports — the cuts you have actually rendered.
   *
   * Only loaded on the Exports tab, and counted separately for the same
   * reason momentCount exists: a tab that says 0 and then shows six is the
   * tab bar telling you there is nothing there.
   */
  exports: ExportRow[];
  exportCount: number;
}

/** One finished cut, as Footage lists it. */
export interface ExportRow {
  id: string;
  r2_key: string | null;
  duration_s: number | null;
  bytes: number | null;
  format: string;
  aspect: string;
  created_at: number;
  /** The edit it came from. */
  title: string | null;
  href: string | null;
}

/*
 * Sorting. There was no sort control anywhere in the product — every list
 * was newest first and that was the only order available. It carries the
 * current search and mode with it so choosing an order does not silently
 * drop what you had typed.
 */
function sortBar(current: string, q: string, mode: string): string {
  const opt = (id: string, label: string) => {
    const on = current === id;
    const params = new URLSearchParams({ tab: "sources", sort: id });
    if (q) params.set("q", q);
    if (mode) params.set("mode", mode);
    return `<a href="/footage?${params.toString()}" style="font-size:${SIZE.meta};padding:5px 10px;border-radius:${RADIUS.button};background:${on ? C.active : "transparent"};color:${on ? C.ink : C.ink45};white-space:nowrap">${label}</a>`;
  };
  return `<div style="margin-top:16px;display:flex;gap:4px;align-items:center;flex-wrap:wrap">
    <span style="font-size:${SIZE.meta};color:${C.ink32};margin-right:4px">Sort</span>
    ${opt("newest", "Newest")}${opt("oldest", "Oldest")}${opt("longest", "Longest")}${opt("name", "Name")}
  </div>`;
}


/*
 * renderFootage — the simple variant — WAS HERE, and nothing called it.
 *
 * It was a near-copy of renderFootageFull's branches, and being a copy it
 * caught two of my fixes that were meant for the real one: the sort bar, and
 * the empty state that told someone with no videos to add back a clip they
 * never had. The sort bar failed to compile, which is how I noticed; the
 * string did not, and shipped.
 *
 * A dead near-copy of a live function is worse than no function: it looks
 * like the thing you are editing.
 */


/** The full surface, with Moments and Threads filled from the library. */
/**
 * Find — a moment in a video you don't have yet. Reads a URL's public
 * captions, text only, and hands back timestamps you can grab yourself.
 *
 * The panel is built to the design; the caption reader behind it is not wired
 * up yet, so the button says so rather than failing silently. Same honesty as
 * the meaning-search notice.
 */
function findPanel(): string {
  return `<div style="margin-top:24px;padding:20px;border-radius:11px;background:#141418;box-shadow:inset 0 0 0 1px rgba(94,184,201,0.18)">
    <div data-content style="font-size:${SIZE.body};font-weight:600">Find a moment in a video you don't have yet</div>
    <div data-content style="font-size:${SIZE.secondary};color:${C.ink45};margin-top:5px;line-height:1.55;max-width:640px">Paste a link and we read its public captions — text only, nothing downloaded. Search it in plain language and you get exact timestamps back. Grab those segments yourself, drop them in Footage, and they behave like everything else here.</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <input placeholder="https://www.youtube.com/watch?v=…" disabled style="flex:1 1 260px;min-width:min(240px,100%);background:#101014;border:none;outline:none;color:${C.ink};font-size:${SIZE.secondary};font-family:${FONT.mono};padding:10px 12px;border-radius:6px"/>
      <button type="button" disabled style="font-size:${SIZE.secondary};font-weight:600;padding:9px 16px;border-radius:${RADIUS.button};background:${C.pill};color:${C.ink45};flex:none;white-space:nowrap;border:none;font-family:${FONT.ui}">Read the captions</button>
    </div>
    <div style="margin-top:12px;font-size:${SIZE.secondary};color:${C.ink45}">Reading captions from a link isn't switched on yet.</div>
  </div>`;
}

export function renderFootageFull(d: FootageData): string {
  /*
   * Order matters and was wrong: the search field and Upload sit directly
   * under the subtitle, ABOVE the tabs, because they act on the whole library
   * rather than on the tab you happen to be looking at. Built below the tabs,
   * search read as a filter for one list.
   */
  const head =
    pageHeading("Footage", "Every video you've added. Search by topic, upload new ones, or ask what's in there.") +
    searchBox(d.tab, d.mode, d.q, d.canMean) +
    tabs(d.tab, { moments: d.momentCount, threads: d.threads.length, sources: d.sources.length, exports: d.exportCount });

  if (d.tab === "find") return head + findPanel();

  if (d.tab === "sources") {
    /* The prototype's "Nothing kept yet — add a clip back" is its line for an
       empty CLIPS list. On the Videos tab it told someone with no videos at
       all to restore a clip they never had. Signed off in check-fidelity. */
    if (!d.sources.length) return head + emptyState("Nothing here yet — upload a video and it starts reading.");
    return (
      head +
      sortBar(d.sort ?? "newest", d.q, d.mode) +
      `<div id="footage-grid" style="margin-top:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(210px,100%),1fr));gap:22px 16px">${d.sources.map(sourceCard).join("")}</div>${selectBar("video")}`
    );
  }

  if (d.tab === "exports") {
    /*
     * The videos you have finished.
     *
     * Every one of these was reachable before only by opening the edit that
     * made it and scrolling to its Exports strip. A file you own should be
     * findable by looking for it.
     */
    if (!d.exports.length) {
      return head + emptyState("Nothing exported yet — finish a cut and it lands here.");
    }
    return (
      head +
      `<div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">${d.exports.map(exportRow).join("")}</div>`
    );
  }

  if (d.tab === "threads") {
    if (!d.threads.length) return head + emptyState("No footage yet");
    return (
      head +
      `<div style="margin-top:20px;font-size:${SIZE.secondary};color:${C.ink45}">Threads — it sorts, you don't</div>
       <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">${d.threads.map(threadCard).join("")}</div>`
    );
  }

  // Meaning search needs the embeddings index. When it is unavailable, say so
  // and fall back to exact rather than silently returning worse results and
  // letting the user think the library is empty.
  const notice = d.meaningUnavailable
    ? `<div style="margin-top:12px;padding:12px 14px;border-radius:${RADIUS.card};background:${C.surface};font-size:${SIZE.secondary};color:${C.ink45}">Searching the words that were said. Meaning search isn't switched on yet.</div>`
    : "";

  const chips = d.threads.length ? threadChips(d.threads, d.momentCount, d.thread) : "";

  if (!d.moments.length) {
    return head + chips + notice + emptyState(d.q ? "No footage yet" : "Nothing kept yet — add a clip back.");
  }

  /* The grid's heading names the filter: the thread's name, or "All clips". */
  const heading = d.thread ? (d.threads.find((t) => t.id === d.thread)?.name ?? "All clips") : "All clips";

  return (
    head +
    chips +
    notice +
    `<div data-content style="margin-top:26px;font-size:${SIZE.body};font-weight:600;color:${C.ink45}">${esc(heading)}</div>
     <div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:14px">${d.moments.map(momentCard).join("")}</div>`
  );
}
