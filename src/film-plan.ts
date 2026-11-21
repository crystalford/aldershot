/**
 * THE PLAN AT FILM SCALE: acts → sections → the two-column script.
 *
 * Doc 21 (`docs/handoff/21-THE-PLAN-IS-THE-ROOM.md`), build phase 1. The plan
 * in src/plan.ts is a claim and a handful of beats — right for a five-minute
 * cut, and nowhere to put a twenty-minute film. This is the same idea one
 * level up: a film has acts, an act has sections (a section is a beat at film
 * scale, and every one RAISES a question or ANSWERS one), and a section is a
 * two-column script — rows of a picture and a sound, each with a duration.
 *
 * WHAT IS STORED AND WHAT IS NOT. The plan is stored; the film is computed.
 * Nothing here holds a start time, a total or an act boundary — `computeFilm`
 * derives all three from the plan and the rules every time, which is
 * invariant 1 applied to structure rather than moments. `parseFilmPlan` is a
 * closed schema, so a plan that arrives carrying a `total` fails visibly
 * instead of becoming a second source of truth that drifts.
 *
 * WHAT A RULE IS HERE. "Open cold on Mariner 4", "trim The cuts to 1:05", "add
 * Both were true", "leave The fire out" — each is a rule object (order, len,
 * declare, drop) with an `on` switch, never an edit to the plan. Switch the
 * rule off and the film is what it was (invariant 6).
 *
 * A BLOCK'S DURATION IS A TARGET, NOT A TIMESTAMP (invariant 2). A len rule
 * re-fits a section by stretching or squeezing the blocks that can move, and
 * leaves alone the two kinds that cannot: someone else speaking in their own
 * words, and a take you have already recorded. When those alone are longer
 * than the length asked for, the rule does not fit — and says so, with the
 * shortest the section can be, rather than quietly cutting somebody off.
 */

import { fmt } from "./rules.ts";

export const PICTURES = ["you", "archive", "sketch", "found", "wanted", "card", "hold"] as const;
export const PICTURE_STATES = ["have", "found", "wanted", "figures", "drafted", "approved"] as const;
export const SOUNDS = ["vo", "sync", "breathe", "silence"] as const;
export const SOUND_STATES = ["rec", "draft", "have", "found", "wanted", ""] as const;
export const QUESTIONS = ["raises", "answers"] as const;

export type PictureKind = (typeof PICTURES)[number];
export type PictureState = (typeof PICTURE_STATES)[number];
export type SoundMode = (typeof SOUNDS)[number];
export type SoundState = (typeof SOUND_STATES)[number];

/** One row of the two-column script. */
export interface PlanBlock {
  /** Whole seconds. A target the solver fits, never a place on a timeline. */
  dur: number;
  picture: { kind: PictureKind; what: string; status: PictureState };
  sound: { mode: SoundMode; text: string; status: SoundState };
}

export interface PlanSection {
  id: string;
  /** Index into FilmPlan.acts. */
  act: number;
  title: string;
  question: { kind: (typeof QUESTIONS)[number]; text: string };
  blocks: PlanBlock[];
}

export interface FilmPlan {
  /** The one sentence the film argues. */
  claim: string;
  /** What the person asked for. The film's real length is computed. */
  targetS: number;
  acts: string[];
  sections: PlanSection[];
}

export type SectionRuleKind = "len" | "order" | "declare" | "drop";

export interface SectionRule {
  id: number | string;
  kind: SectionRuleKind;
  on: boolean;
  /** What it reads as. The rule IS this sentence. */
  text?: string;
  /** The section it acts on — for `declare`, the id of the section it adds. */
  section: string;
  /** len: the section's new length, whole seconds. */
  secs?: number;
  /** order: to the front of the film … */
  first?: boolean;
  /** … or straight after this section. Also where `declare` puts its section. */
  after?: string;
  /** declare: the section somebody said yes to. */
  declared?: PlanSection;
}

export interface ComputedBlock extends PlanBlock {
  startS: number;
  endS: number;
}

export interface ComputedSection {
  id: string;
  /** Its number in the film as it now stands, from 1. */
  n: number;
  act: number;
  title: string;
  question: PlanSection["question"];
  startS: number;
  endS: number;
  durS: number;
  blocks: ComputedBlock[];
}

export interface ComputedFilm {
  sections: ComputedSection[];
  totalS: number;
  /** Positive when the film runs over what was asked for. */
  overS: number;
  acts: Array<{ name: string; startS: number; endS: number }>;
  voice: { totalS: number; recordedS: number; wordsToGo: number };
  /** Sections a drop rule has taken out. Out, not deleted. */
  dropped: string[];
  /** Rules that could not apply, each as a sentence. Never silent. */
  problems: string[];
}

/** Narration runs about 150 words a minute. */
export const WORDS_PER_S = 2.5;
/** The shortest a block that can move is allowed to get. */
export const MIN_BLOCK_S = 2;

// ── the closed schema ────────────────────────────────────────────────────

export class PlanShapeError extends Error {}

const fail = (path: string, why: string): never => {
  throw new PlanShapeError(`${path}: ${why}`);
};

function exactKeys(v: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "expected an object");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${path}.${k}`, "not part of a plan — a plan stores no derived values");
  for (const k of keys) if (!(k in o)) fail(`${path}.${k}`, "missing");
  return o;
}
const str = (v: unknown, path: string): string => (typeof v === "string" ? v : fail(path, "expected text"));
const secs = (v: unknown, path: string): number =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(path, "expected whole seconds above zero");
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  return allowed.includes(v as T) ? (v as T) : fail(path, `expected one of ${allowed.map((a) => JSON.stringify(a)).join(", ")}`);
}

function parseSection(v: unknown, path: string, actCount: number): PlanSection {
  const o = exactKeys(v, path, ["id", "act", "title", "question", "blocks"]);
  const act = o.act;
  if (!Number.isInteger(act) || (act as number) < 0 || (act as number) >= actCount) fail(`${path}.act`, `expected an act from 0 to ${actCount - 1}`);
  const q = exactKeys(o.question, `${path}.question`, ["kind", "text"]);
  if (!Array.isArray(o.blocks) || o.blocks.length === 0) fail(`${path}.blocks`, "a section needs at least one block");
  return {
    id: str(o.id, `${path}.id`),
    act: act as number,
    title: str(o.title, `${path}.title`),
    question: { kind: oneOf(q.kind, `${path}.question.kind`, QUESTIONS), text: str(q.text, `${path}.question.text`) },
    blocks: (o.blocks as unknown[]).map((b, i) => {
      const p = `${path}.blocks[${i}]`;
      const bo = exactKeys(b, p, ["dur", "picture", "sound"]);
      const pic = exactKeys(bo.picture, `${p}.picture`, ["kind", "what", "status"]);
      const snd = exactKeys(bo.sound, `${p}.sound`, ["mode", "text", "status"]);
      return {
        dur: secs(bo.dur, `${p}.dur`),
        picture: { kind: oneOf(pic.kind, `${p}.picture.kind`, PICTURES), what: str(pic.what, `${p}.picture.what`), status: oneOf(pic.status, `${p}.picture.status`, PICTURE_STATES) },
        sound: { mode: oneOf(snd.mode, `${p}.sound.mode`, SOUNDS), text: str(snd.text, `${p}.sound.text`), status: oneOf(snd.status, `${p}.sound.status`, SOUND_STATES) },
      };
    }),
  };
}

/** A plan from JSON, or a PlanShapeError naming the first thing wrong with it. */
export function parseFilmPlan(v: unknown): FilmPlan {
  const o = exactKeys(v, "plan", ["claim", "targetS", "acts", "sections"]);
  if (!Array.isArray(o.acts) || o.acts.length === 0) fail("plan.acts", "a film needs at least one act");
  const acts = (o.acts as unknown[]).map((a, i) => str(a, `plan.acts[${i}]`));
  if (!Array.isArray(o.sections) || o.sections.length === 0) fail("plan.sections", "a film needs at least one section");
  const sections = (o.sections as unknown[]).map((s, i) => parseSection(s, `plan.sections[${i}]`, acts.length));
  const seen = new Set<string>();
  sections.forEach((s, i) => {
    if (seen.has(s.id)) fail(`plan.sections[${i}].id`, `"${s.id}" is used twice`);
    seen.add(s.id);
  });
  return { claim: str(o.claim, "plan.claim"), targetS: secs(o.targetS, "plan.targetS"), acts, sections };
}

/**
 * The prototype's row format — [dur, pictureKind, picture, pictureStatus,
 * soundMode, sound, soundStatus] — read into sections. design/next/film.js is
 * written this way because it is copied verbatim from the pages.
 */
export function sectionFromRows(s: { id: string; act: number; title: string; qk: string; q: string; rows: unknown[][] }, actCount: number): PlanSection {
  return parseSection(
    {
      id: s.id,
      act: s.act,
      title: s.title,
      question: { kind: s.qk, text: s.q },
      blocks: s.rows.map((r) => ({ dur: r[0], picture: { kind: r[1], what: r[2], status: r[3] }, sound: { mode: r[4], text: r[5], status: r[6] } })),
    },
    `section ${s.id}`,
    actCount,
  );
}

// ── compute ──────────────────────────────────────────────────────────────

/** Someone else's words and a recorded take keep their length. */
const fixedLength = (b: PlanBlock): boolean => b.sound.mode === "sync" || (b.sound.mode === "vo" && b.sound.status === "rec");

/**
 * Re-fit one section to `target` seconds, or say why it cannot be.
 * Whole seconds throughout; the remainder goes to the largest fractions,
 * ties to the earlier block, so the same plan always gives the same film.
 */
function fit(section: PlanSection, target: number): { blocks: PlanBlock[] } | { shortest: number } {
  const fixedS = section.blocks.filter(fixedLength).reduce((a, b) => a + b.dur, 0);
  const movable = section.blocks.map((b, i) => ({ b, i })).filter((x) => !fixedLength(x.b));
  const shortest = fixedS + movable.length * MIN_BLOCK_S;
  if (movable.length === 0 || target < shortest) return { shortest };

  const out = new Map<number, number>();
  let pool = movable, room = target - fixedS;
  // Anything that would scale below the floor sits at the floor; the rest share what is left.
  for (;;) {
    const poolS = pool.reduce((a, x) => a + x.b.dur, 0);
    const under = pool.filter((x) => (x.b.dur * room) / poolS < MIN_BLOCK_S);
    if (!under.length) {
      const raw = pool.map((x) => ({ i: x.i, v: (x.b.dur * room) / poolS }));
      const floors = raw.map((r) => ({ ...r, f: Math.floor(r.v) }));
      let left = room - floors.reduce((a, r) => a + r.f, 0);
      [...floors].sort((a, b) => b.v - b.f - (a.v - a.f) || a.i - b.i).forEach((r) => { if (left > 0) { r.f += 1; left -= 1; } });
      floors.forEach((r) => out.set(r.i, r.f));
      break;
    }
    under.forEach((x) => out.set(x.i, MIN_BLOCK_S));
    room -= under.length * MIN_BLOCK_S;
    pool = pool.filter((x) => !under.includes(x));
    if (!pool.length) break;
  }
  return { blocks: section.blocks.map((b, i) => (out.has(i) ? { ...b, dur: out.get(i)! } : b)) };
}

/** The film: the plan with every rule that is on applied, timed end to end. */
export function computeFilm(plan: FilmPlan, rules: SectionRule[] = []): ComputedFilm {
  const problems: string[] = [];
  const on = rules.filter((r) => r.on);
  const titleOf = (id: string, list: PlanSection[]) => list.find((s) => s.id === id)?.title ?? id;
  let list: PlanSection[] = plan.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b })) }));

  // 1. Sections somebody said yes to.
  for (const r of on.filter((r) => r.kind === "declare")) {
    if (!r.declared) { problems.push(`Rule ${r.id} adds a section and doesn't say what it is.`); continue; }
    if (list.some((s) => s.id === r.declared!.id)) { problems.push(`“${r.declared.title}” is already in the film.`); continue; }
    const at = r.after === undefined ? list.length : list.findIndex((s) => s.id === r.after) + 1;
    if (at === 0) { problems.push(`“${r.declared.title}” goes after a section that isn't in the film.`); continue; }
    list.splice(at, 0, { ...r.declared, blocks: r.declared.blocks.map((b) => ({ ...b })) });
  }

  // 2. Out, not deleted.
  const dropped: string[] = [];
  for (const r of on.filter((r) => r.kind === "drop")) {
    if (!list.some((s) => s.id === r.section)) { problems.push(`There's no section “${r.section}” to leave out.`); continue; }
    dropped.push(r.section);
    list = list.filter((s) => s.id !== r.section);
  }

  // 3. Order. A moved section joins the act it lands in.
  for (const r of on.filter((r) => r.kind === "order")) {
    const from = list.findIndex((s) => s.id === r.section);
    if (from < 0) { problems.push(`There's no section “${r.section}” to move.`); continue; }
    const [s] = list.splice(from, 1);
    let to = r.first ? 0 : r.after !== undefined ? list.findIndex((x) => x.id === r.after) + 1 : -1;
    if (to <= 0 && !r.first) { list.splice(from, 0, s); problems.push(`“${s.title}” has nowhere to move to.`); continue; }
    const neighbour = list[to] ?? list[to - 1];
    list.splice(to, 0, { ...s, act: neighbour ? neighbour.act : s.act });
  }

  // 4. Length.
  for (const r of on.filter((r) => r.kind === "len")) {
    const i = list.findIndex((s) => s.id === r.section);
    if (i < 0) { problems.push(`There's no section “${r.section}” to change the length of.`); continue; }
    if (!Number.isInteger(r.secs) || (r.secs as number) <= 0) { problems.push(`Rule ${r.id} asks for a length that isn't whole seconds.`); continue; }
    const got = fit(list[i], r.secs as number);
    if ("shortest" in got) {
      problems.push(`“${titleOf(r.section, list)}” can't be ${fmt(r.secs as number)} — ${fmt(got.shortest)} is as short as it goes without cutting someone's words or a recorded take.`);
      continue;
    }
    list[i] = { ...list[i], blocks: got.blocks };
  }

  // 5. Time it, end to end. Nothing above knew a start time.
  let at = 0;
  const sections: ComputedSection[] = list.map((s, idx) => {
    const startS = at;
    const blocks = s.blocks.map((b) => { const c = { ...b, startS: at, endS: at + b.dur }; at += b.dur; return c; });
    return { id: s.id, n: idx + 1, act: s.act, title: s.title, question: s.question, startS, endS: at, durS: at - startS, blocks };
  });

  const acts = plan.acts.map((name, i) => {
    const mine = sections.filter((s) => s.act === i);
    return { name, startS: mine.length ? mine[0].startS : 0, endS: mine.length ? mine[mine.length - 1].endS : 0 };
  });
  // Acts run in order. Name the section that is out of place, not just the act.
  let wedged = false;
  sections.forEach((s, k) => {
    const before = sections[k - 1], after = sections[k + 1];
    if (before && after && before.act === after.act && s.act !== before.act) {
      wedged = true;
      problems.push(`“${s.title}” is in ${plan.acts[s.act]} but sits inside ${plan.acts[before.act]}.`);
    }
  });
  if (!wedged && sections.some((s, k) => k > 0 && s.act < sections[k - 1].act)) problems.push("The acts are out of order — an earlier act comes back after a later one has started.");

  const vo = sections.flatMap((s) => s.blocks).filter((b) => b.sound.mode === "vo");
  const voS = vo.reduce((a, b) => a + b.dur, 0);
  const recS = vo.filter((b) => b.sound.status === "rec").reduce((a, b) => a + b.dur, 0);

  return {
    sections,
    totalS: at,
    overS: at - plan.targetS,
    acts,
    voice: { totalS: voS, recordedS: recS, wordsToGo: Math.round((voS - recS) * WORDS_PER_S) },
    dropped,
    problems,
  };
}
