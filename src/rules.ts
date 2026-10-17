/**
 * THE RULE ENGINE. A cut is not a thing you store.
 *
 * It is what a short list of plain-language rules produces when applied to the
 * moments, re-produced whenever the rules, the footage, the transcript or the
 * target length change. "Tighten 10%" is one setting, not a hundred trims.
 * Shorts, a trailer and the full cut are three renderings of one rule set.
 *
 * This is a port of `design/one-take/footage.js`, which the handoff says to
 * port rather than reinvent (`docs/handoff/04-RULE-ENGINE.md`). The order of
 * operations below is not a style choice — it encodes precedence, and the
 * reference implementation is the specification for it. test/rules.test.ts
 * reproduces the reference's own sample cut exactly: 8 of 14 moments, 5:59,
 * 4 to-camera gaps.
 *
 * ONE DELIBERATE DEPARTURE, in the cap rule, documented at capDropOrder below.
 * Everything else is the reference's behaviour, including the parts that look
 * like quirks.
 */

import { contentWords } from "./moment-tags.ts";

export type RuleKind = "keep" | "drop" | "order" | "gap" | "cap" | "len" | "count" | "hook";
export type Order = "time" | "strand" | "open";

export interface Rule {
  id: number | string;
  kind: RuleKind;
  on: boolean;
  /** What it reads as in the rules pane. The rule IS this sentence. */
  text?: string;
  /** What it matches: a tag, one moment, or a set of them. */
  tag?: string;
  cid?: number | string;
  cids?: Array<number | string>;
  /** keep/cut by hand, which overrides every rule above it. */
  hand?: boolean;
  /** A keep rule that re-takes a moment a drop rule contested. */
  wins?: boolean;
  order?: Order;
  /** The cap rule's ceiling, in seconds. */
  secs?: number;
}

export interface Moment {
  id: number | string;
  /** Which source it came from. */
  src: string;
  /** Where in that source, as m:ss. */
  ts: string;
  dur: number;
  tags: string[];
  strand?: string;
  text: string;
  /** Set when the moment came from outside the user's own footage. */
  provenance?: string;
  acq?: string;
  /** A plan's narration to place after this moment. */
  voAfter?: { secs?: number; text: string; byId?: Rule["id"] | null };
}

/** A moment with the engine's verdict on it. */
export interface Judged extends Moment {
  in: boolean;
  /** The rule that put it in, and the rule that took it out. */
  byId: Rule["id"] | null;
  dropId: Rule["id"] | null;
  /** Recorded when a keep and a drop both matched, so `wins` can settle it. */
  contest?: { k: Rule["id"]; d: Rule["id"] };
  byHand?: boolean;
}

export interface Row {
  kind: "clip" | "voice" | "react";
  key: string;
  secs: number;
  /** Zero-cost when the beat is voice over picture. */
  over?: boolean;
  voice?: boolean;
  strand?: string;
  text?: string;
  byId?: Rule["id"] | null;
  /** External footage not yet verified: shown, not trusted. */
  ghost?: boolean;
  fromPlan?: boolean;
  isInsert?: boolean;
  byHand?: boolean;
  moment?: Judged;
}

export interface Insert {
  id: string;
  kind: "clip" | "line" | "react";
  /** The row key this goes after. */
  after: string;
  cid?: Moment["id"];
}

export interface FootageSet {
  CLIPS: Moment[];
  STRANDS: string[];
}

export interface Computed {
  /** Every moment with the engine's verdict — this is what the rules pane reads. */
  st: Judged[];
  rows: Row[];
  secs: number;
  ord: Order;
}

/** m:ss → seconds. */
export const tsS = (ts: string): number => {
  const [m, s] = ts.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

/** seconds → m:ss. */
export const fmt = (n: number): string =>
  `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, "0")}`;

export const byTime = (a: Moment, b: Moment): number =>
  a.src.localeCompare(b.src) || tsS(a.ts) - tsS(b.ts);

/** How long a moment runs once struck words are taken out of it. */
export function wordDur(m: Moment, struck: Record<string, Record<number, boolean>> = {}): number {
  const words = m.text.split(" ").length;
  const gone = Object.keys(struck[String(m.id)] ?? {}).length;
  /* Three seconds is the floor: a moment struck down to one word is still a
     shot somebody has to watch. */
  return Math.max(3, Math.round(m.dur * (1 - gone / words)));
}

/**
 * WHICH MOMENTS THE CAP RULE DROPS FIRST — the one departure from the
 * reference.
 *
 * `footage.js` sorts the non-strong moments longest-first and drops until it is
 * under the ceiling. Longest-first is right about cost and says nothing about
 * value: six moments all making the same point are all short, so all six
 * survive a cap that was meant to tighten the cut.
 *
 * So the order is by cost over UNIQUE value — the moment whose words nothing
 * else still in the cut is saying. A moment that repeats another entirely has
 * no unique value and goes first however short it is, which is the behaviour
 * the research asked for and the reference cannot have. Recomputed after each
 * drop, because taking one moment out makes the next one's words unique.
 *
 * With no redundancy in the set this reduces exactly to longest-first, so it
 * is a refinement of the reference rather than a different algorithm, and
 * test/rules.test.ts pins that equivalence.
 *
 * Still charged to the cap rule, which is the part that matters: the rules
 * pane can say what it took and why, and it can be switched off.
 */
function capDropOrder(candidates: Judged[], others: Judged[]): Judged[] {
  const elsewhere = new Set<string>();
  for (const m of others) for (const w of contentWords(m.text)) elsewhere.add(w);

  const remaining = [...candidates];
  const order: Judged[] = [];

  while (remaining.length) {
    /* What each one would still be the only source of. */
    const covered = new Set(elsewhere);
    for (const m of remaining) for (const w of contentWords(m.text)) covered.add(w);

    let worst = 0;
    let worstCost = -1;
    remaining.forEach((m, i) => {
      const mine = contentWords(m.text);
      const others2 = new Set(covered);
      /* Strip this moment's contribution to see what only it provides. */
      for (const w of mine) others2.delete(w);
      for (const n of remaining) {
        if (n === m) continue;
        for (const w of contentWords(n.text)) others2.add(w);
      }
      const unique = mine.filter((w) => !others2.has(w)).length;
      /* No unique value at all: drop it first, whatever its length. */
      const cost = unique === 0 ? Infinity : m.dur / unique;
      if (cost > worstCost) {
        worstCost = cost;
        worst = i;
      }
    });

    order.push(remaining[worst]);
    remaining.splice(worst, 1);
  }
  return order;
}

/**
 * Rules → a cut.
 *
 * The numbered steps are `04-RULE-ENGINE.md`'s order of operations. Keep the
 * order; it is the precedence.
 */
export function compute(
  rules: Rule[],
  opts: {
    struck?: Record<string, Record<number, boolean>>;
    inserts?: Insert[];
    beatMode?: Record<string, string>;
    /** One source, or the whole set. */
    scope?: string | null;
    set: FootageSet;
  },
): Computed {
  const { struck = {}, inserts = [], beatMode = {}, scope = null, set } = opts;
  const STR = set.STRANDS;
  const on = rules.filter((r) => r.on);
  const hit = (r: Rule, m: Judged) =>
    (!!r.tag && m.tags.includes(r.tag)) ||
    (r.cid !== undefined && m.id === r.cid) ||
    (!!r.cids && r.cids.includes(m.id));
  const wdur = (m: Moment) => wordDur(m, struck);

  /* 1. Every moment in the set, nothing in yet. */
  const st: Judged[] = set.CLIPS.filter((m) => !scope || m.src === scope).map((m) => ({
    ...m,
    in: false,
    byId: null,
    dropId: null,
  }));

  /* 2. keep rules mark moments in, recording which rule did it. */
  for (const r of on.filter((r) => r.kind === "keep" && !r.hand)) {
    for (const m of st) {
      if (hit(r, m)) {
        m.in = true;
        m.byId = r.id;
        m.dropId = null;
      }
    }
  }

  /* 3. drop rules take them out, and a keep/drop contest is recorded. */
  for (const r of on.filter((r) => r.kind === "drop" && !r.hand)) {
    for (const m of st) {
      if (hit(r, m)) {
        if (m.in && m.byId !== null) m.contest = { k: m.byId, d: r.id };
        m.in = false;
        m.dropId = r.id;
      }
    }
  }

  /* 4. A keep rule with `wins` re-takes what it lost. */
  for (const r of on.filter((r) => r.kind === "keep" && !r.hand && r.wins)) {
    for (const m of st) {
      if (hit(r, m) && m.contest && m.contest.k === r.id) {
        m.in = true;
        m.byId = r.id;
        m.dropId = null;
      }
    }
  }

  /* 5. cap: drop until under the ceiling, never a `strong` moment. */
  const cap = on.find((r) => r.kind === "cap");
  if (cap && typeof cap.secs === "number") {
    let total = st.filter((m) => m.in).reduce((n, m) => n + wdur(m), 0);
    const inCut = st.filter((m) => m.in);
    const candidates = inCut.filter((m) => !m.tags.includes("strong"));
    const protected_ = inCut.filter((m) => m.tags.includes("strong"));
    for (const m of capDropOrder(candidates, protected_)) {
      if (total <= cap.secs) break;
      m.in = false;
      m.dropId = cap.id;
      total -= wdur(m);
    }
  }

  /* 6. hand rules override everything above. */
  for (const r of on.filter((r) => r.hand)) {
    for (const m of st) {
      if (!hit(r, m)) continue;
      if (r.kind === "keep") {
        m.in = true;
        m.byId = r.id;
        m.dropId = null;
      } else {
        m.in = false;
        m.dropId = r.id;
      }
    }
  }

  /* 7. A moment an insert places is out of the rule flow — it is placed by hand. */
  const insertedIds = inserts.filter((i) => i.kind === "clip").map((i) => i.cid);
  for (const m of st) {
    if (insertedIds.includes(m.id)) {
      m.in = false;
      m.byHand = true;
    }
  }

  /* 8. order. */
  const orderRule = on.find((r) => r.kind === "order");
  const ord: Order = orderRule?.order ?? "time";
  const kept = st.filter((m) => m.in);
  let seq: Judged[];
  if (ord === "time") {
    seq = kept.slice().sort(byTime);
  } else {
    seq = [];
    for (const s of STR) seq.push(...kept.filter((m) => m.strand === s).sort(byTime));
    for (const m of kept.filter((m) => !m.strand).sort(byTime)) seq.push(m);
  }
  if (ord === "open" && seq.length) {
    const strongest = seq
      .filter((m) => m.tags.includes("strong"))
      .sort((a, b) => b.dur - a.dur)[0];
    if (strongest) seq = [strongest, ...seq.filter((m) => m !== strongest)];
  }

  /* 9. gap: twelve seconds to camera after the last moment of each thread. */
  const gap = on.find((r) => r.kind === "gap");
  const rows: Row[] = [];
  seq.forEach((m, i) => {
    rows.push({
      kind: "clip",
      key: `c${m.id}`,
      secs: wdur(m),
      /* External and unverified: shown, flagged, not trusted. */
      ghost: m.provenance === "external" && m.acq !== "verified",
      moment: m,
    });
    const next = seq[i + 1];
    if (gap && ord !== "time" && m.strand && (!next || next.strand !== m.strand)) {
      rows.push({
        kind: "voice",
        key: `g${m.id}`,
        voice: true,
        strand: m.strand,
        secs: 12,
        byId: gap.id,
        text: `What “${m.strand}” adds up to — twelve seconds, you, to camera.`,
      });
    }
    if (m.voAfter) {
      rows.push({
        kind: "voice",
        key: `v${m.id}`,
        voice: true,
        strand: m.strand,
        secs: m.voAfter.secs ?? 12,
        byId: m.voAfter.byId ?? null,
        text: m.voAfter.text,
        fromPlan: true,
      });
    }
  });

  /* 10. inserts are spliced in after their anchor. */
  for (const ins of inserts) {
    let at = rows.findIndex((r) => r.key === ins.after);
    if (at < 0) at = rows.length - 1;
    let row: Row;
    if (ins.kind === "clip") {
      const m = st.find((x) => x.id === ins.cid);
      if (!m) continue;
      row = { kind: "clip", key: `i${ins.id}`, secs: wdur(m), isInsert: true, byHand: true, moment: m };
    } else {
      row = {
        kind: ins.kind === "react" ? "react" : "voice",
        key: `i${ins.id}`,
        secs: ins.kind === "react" ? 20 : 12,
        isInsert: true,
        voice: true,
        byHand: true,
        text:
          ins.kind === "react"
            ? "Your reaction — say what you make of what you just heard."
            : "A line from you — whatever needs saying here.",
      };
    }
    rows.splice(at + 1, 0, row);
  }

  /* 11. Voice over picture costs no runtime. */
  for (const r of rows) r.over = !!(r.voice && beatMode[r.key] === "over");

  const secs = rows.reduce((n, r) => n + (r.over ? 0 : r.secs), 0);
  return { st, rows, secs, ord };
}

/**
 * Adds one rule the way the editor does.
 *
 * order, cap, len, count and hook are single-valued: a second one replaces the
 * first. Everything else appends.
 *
 * NOTE a quirk kept from the reference: an `order` rule only ever UPDATES an
 * existing one, so the first order rule has to arrive in the seed set. The
 * prose in 04-RULE-ENGINE.md says "replaces … and appends anything else",
 * which would add one; the code does not. The reference wins, because the
 * rules pane is built expecting exactly one order row to be present from the
 * start — but it is a disagreement between doc and code, not a decision.
 */
export function applyRule(rules: Rule[], rule: Rule): Rule[] {
  if (rule.kind === "order") {
    return rules.map((x) =>
      x.kind === "order" ? { ...x, order: rule.order, on: true, text: rule.text ?? x.text } : x,
    );
  }
  if (["cap", "len", "count", "hook"].includes(rule.kind)) {
    return [...rules.filter((x) => x.kind !== rule.kind), rule];
  }
  return [...rules, rule];
}

/**
 * What a rule is doing right now, by diffing the cut with and without it.
 *
 * "8 of 14 moments · 2 to-camera gaps", "takes 3 slow openers off the
 * shortlist", "nothing here touches it — it watches for it". This is the
 * explanation layer; without it the product is a black box with toggles.
 */
export function ruleEffect(
  rules: Rule[],
  rule: Rule,
  opts: Parameters<typeof compute>[1],
): { added: number; removed: number; secs: number } {
  const withIt = compute(rules, opts);
  const without = compute(
    rules.map((r) => (r.id === rule.id ? { ...r, on: false } : r)),
    opts,
  );
  const inNow = new Set(withIt.st.filter((m) => m.in).map((m) => m.id));
  const inThen = new Set(without.st.filter((m) => m.in).map((m) => m.id));
  return {
    added: [...inNow].filter((id) => !inThen.has(id)).length,
    removed: [...inThen].filter((id) => !inNow.has(id)).length,
    secs: withIt.secs - without.secs,
  };
}

/**
 * A REAL LIBRARY, AS A FOOTAGE SET.
 *
 * The engine was ported against the reference's fourteen hand-tagged sample
 * clips, which proves the precedence and nothing else: an engine that only
 * ever runs on a fixture is the "built, and nothing can reach it" failure this
 * repo has had three times. Phase 2's acceptance is the port "over the real
 * document", and this is the join.
 *
 * Everything the engine needs, a real moment already has or can derive:
 *
 *   src      the source it came from, so chronological order is per video
 *   ts       m:ss, from start_ms
 *   dur      seconds, from the span
 *   text     the quote — the words that were actually said
 *   strand   the thread it was clustered into, which IS the sample's strand
 *   tags     derived deterministically; see src/moment-tags.ts
 *
 * `STRANDS` is ordered by first appearance rather than alphabetically, because
 * the engine runs threads in the set's order and an alphabetical cut would
 * open on whichever thread happened to start with an early letter.
 */
export function toFootageSet(
  moments: Array<{
    id: string;
    source_id: string;
    start_ms: number;
    end_ms: number;
    quote: string;
    thread_name?: string | null;
    heat?: number | null;
  }>,
  tagsFor: (m: { quote: string; heat?: number | null }) => string[],
): FootageSet {
  const CLIPS: Moment[] = moments.map((m) => ({
    id: m.id,
    src: m.source_id,
    ts: fmt(Math.round(m.start_ms / 1000)),
    dur: Math.max(1, Math.round((m.end_ms - m.start_ms) / 1000)),
    tags: tagsFor(m),
    strand: m.thread_name ?? undefined,
    text: m.quote,
  }));

  /* First appearance, not sorted: the engine runs threads in this order. */
  const STRANDS: string[] = [];
  for (const c of CLIPS) if (c.strand && !STRANDS.includes(c.strand)) STRANDS.push(c.strand);

  return { CLIPS, STRANDS };
}

/**
 * What the rules did, in a sentence somebody reads.
 *
 * The pass line used to report a count and a runtime. With an engine behind it
 * there is something better to say: which rules took part, and what the cut
 * actually came out at. "8 of 24 moments · 5:59 · one thread at a time" is a
 * cut you can check; "8 moments" is a number you have to trust.
 */
export function describe(out: Computed, rules: Rule[], note = ""): string {
  const total = out.st.length;
  const kept = out.st.filter((m) => m.in).length;
  const gaps = out.rows.filter((r) => r.voice && !r.isInsert).length;
  /* The same rule compute() uses — the FIRST enabled order rule — or this
     line reports an order the cut was not built in. */
  const order = rules.find((r) => r.on && r.kind === "order")?.order ?? out.ord;
  const orderName =
    order === "strand" ? "one thread at a time"
    : order === "open" ? "sharpest line first"
    : "as it happened";

  /* `note` goes immediately after the runtime, because that is what it
     explains. Appended at the end it read "one thread at a time of 2:00". */
  return (
    `${kept} of ${total} moment${total === 1 ? "" : "s"} · ${fmt(out.secs)}${note} · ${orderName}` +
    (gaps ? ` · ${gaps} to-camera gap${gaps === 1 ? "" : "s"}` : "")
  );
}

/**
 * WHAT ONE RULE IS DOING RIGHT NOW, in the words the pane shows.
 *
 * 04-RULE-ENGINE.md gives the shapes: "8 of 14 moments · 2 to-camera gaps",
 * "takes 3 slow openers off the shortlist", "nothing here touches it — it
 * watches for it", "off — footage as shot".
 *
 * Here rather than in the route because it is the explanation layer and it has
 * to be testable: a line that says a rule did nothing when it decided what you
 * watch first is worse than no line, and that is exactly what the first
 * version did to every order rule.
 *
 * AN ORDER RULE CHANGES NO MEMBERSHIP, so a membership diff reports zero for
 * the one rule that decides the shape of the thing. It is reported by what the
 * cut now OPENS on, which is its visible consequence and is not a restatement
 * of its own sentence — "Run it one thread at a time" answered by "one thread
 * at a time" tells nobody anything.
 */
export function effectLine(rules: Rule[], rule: Rule, opts: Parameters<typeof compute>[1]): string {
  if (!rule.on) return "off — footage as shot";

  if (rule.kind === "order") {
    /*
     * HOW MANY MOMENTS IT MOVES, against the order with the rule switched off
     * — which is chronological, because that is what compute() falls back to.
     *
     * The first version reported what the cut OPENS on. True, and in the
     * reference's own sample it is the same moment under all three orders:
     * the strongest line there is also the earliest kept one. An effect line
     * that reads identically whichever order is chosen is a constant wearing
     * a measurement's clothes, which is the thing this layer exists not to be.
     */
    const withIt = compute(rules, opts).rows.filter((r) => r.kind === "clip").map((r) => r.key);
    const without = compute(
      rules.map((r) => (r.id === rule.id ? { ...r, on: false } : r)),
      opts,
    )
      .rows.filter((r) => r.kind === "clip")
      .map((r) => r.key);
    if (!withIt.length) return "nothing to order yet";
    const moved = withIt.filter((k, i) => without[i] !== k).length;
    return moved ? `moves ${moved} of ${withIt.length}` : "already in that order";
  }

  const e = ruleEffect(rules, rule, opts);
  if (e.removed) return `takes ${e.removed} off the cut`;
  if (e.added) return `brings in ${e.added}`;
  /* A gap rule adds seconds without adding moments. */
  if (e.secs) return `adds ${Math.round(e.secs)}s to camera`;
  return "nothing here touches it — it watches for it";
}

/**
 * A RULE'S NAME, derived from what it is rather than from where it appeared.
 *
 * Rules are stored under a project-scoped unique name, so the name has to be
 * both stable across re-parses and unique within a set. Numbering by position
 * is neither, and the failure is a crash rather than a wrong cut: a brief that
 * parses to [order, cap] names them r-said-0 and r-said-1, and a later "make
 * it 90 seconds" parses to [cap] and names it r-said-0 — which applyRule then
 * replaces the CAP with while the ORDER rule still holds that name. The unique
 * constraint rejects the save.
 *
 * Kind plus tag cannot collide within a set, because applyRule already makes
 * order, cap, len, count and hook single-valued, and keep/drop rules are
 * distinguished by the tag they match. Two keeps on the same tag are the same
 * rule said twice.
 */
export function ruleKey(rule: Omit<Rule, "id">): string {
  const parts = ["r", rule.kind];
  if (rule.tag) parts.push(rule.tag);
  /* A hand decision names one moment and is not the same rule as the tag rule
     of the same kind — it is the escape hatch from it. */
  if (rule.hand && rule.cid !== undefined) parts.push("hand", String(rule.cid));
  return parts.join("-");
}
