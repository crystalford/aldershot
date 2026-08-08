/**
 * The narrative brain — reason over transcripts with a Workers AI text model to
 * (1) arrange a long-form cut and (2) suggest Opus-Clip-style shorts.
 *
 * The model never invents timestamps: it picks from a numbered MENU of
 * sentences, and we map its picks back to exact source times. That keeps output
 * small, grounded, and cheap to validate.
 */
import type { Env } from "../env";
import type { Word, Segment, Timeline, Short, EditSuggestion } from "../transcript/edl";

// Capable, fast Workers AI text model. Exact id to confirm against the live
// catalog (feasibility doc lists Llama available natively).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Was 500 — too low for a real long-form recording (a 66-minute talk alone runs
// ~600-700 sentences), which would silently drop the back half of the video
// exactly where cross-video "callback" candidates are most likely to live.
const MAX_SENTENCES = 4000;

export interface VideoTranscript {
  id: string;
  filename?: string;
  words: Word[];
}

interface Sentence {
  id: string;
  videoId: string;
  start: number;
  end: number;
  text: string;
}

const ts = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Split a video's kept words into sentences carrying their source time span. */
export function segmentSentences(words: Word[], videoId: string, vi: number): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  let si = 0;
  const flush = () => {
    if (!cur.length) return;
    out.push({
      id: `v${vi}s${si++}`,
      videoId,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim(),
    });
    cur = [];
  };
  for (const w of words) {
    if (w.deleted) continue;
    cur.push(w);
    if (/[.!?]["')\]]?$/.test(w.text.trim())) flush();
  }
  flush();
  return out;
}

function buildMenu(videos: VideoTranscript[]): { menu: string; byId: Map<string, Sentence> } {
  const sentences: Sentence[] = [];
  videos.forEach((v, vi) => sentences.push(...segmentSentences(v.words, v.id, vi)));
  const capped = sentences.slice(0, MAX_SENTENCES);
  const byId = new Map(capped.map((s) => [s.id, s]));
  const menu = capped.map((s) => `[${s.id}] (${ts(s.start)}-${ts(s.end)}) ${s.text}`).join("\n");
  return { menu, byId };
}

/** Merge consecutive same-video segments that are contiguous in the source. */
function mergeAdjacent(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.videoId === s.videoId && s.start - last.end <= 0.5) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

// Loosened Workers AI text call → returns the model's raw string.
async function runText(env: Env, system: string, user: string): Promise<string> {
  const run = env.AI.run.bind(env.AI) as (m: string, i: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const res = await run(MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 4096,
    temperature: 0.3,
  });
  return (res.response as string) ?? "";
}

/** Pull the first JSON value out of a model reply (tolerates code fences/prose). */
function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model reply");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("unterminated JSON in model reply");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

async function runJson<T>(env: Env, system: string, user: string): Promise<T> {
  let raw = await runText(env, system, user);
  try {
    return extractJson<T>(raw);
  } catch {
    // one retry with a stricter nudge
    raw = await runText(env, system, user + "\n\nReturn ONLY valid minified JSON, nothing else.");
    return extractJson<T>(raw);
  }
}

// ── Arrange ──────────────────────────────────────────────────────────
interface ArrangeReply {
  coldOpen?: { id: string; reason?: string }[];
  body?: { id: string; reason?: string }[];
}

export async function arrangeTimeline(env: Env, videos: VideoTranscript[]): Promise<Timeline> {
  const { menu, byId } = buildMenu(videos);
  const system =
    "You are a sharp video editor assembling a long-form cut from transcribed clips. " +
    "You only choose from the sentences given, by their [id]. You never invent text or times.";
  const user =
    "Build a long-form edit from these sentences.\n\n" +
    "- coldOpen: 2 to 4 of the punchiest hook sentences that grab attention up front.\n" +
    "- body: the strongest sentences in a coherent narrative order. Drop filler, rambling, " +
    "false starts, repeated takes, and dead air. Prefer keeping contiguous runs from the same clip.\n\n" +
    'Return ONLY JSON: {"coldOpen":[{"id":"v0s2","reason":"why"}],"body":[{"id":"v1s0","reason":"why"}]}\n\n' +
    "Sentences:\n" +
    menu;

  const reply = await runJson<ArrangeReply>(env, system, user);
  const toSeg = (r: { id: string; reason?: string }): Segment | null => {
    const s = byId.get(r.id);
    return s ? { videoId: s.videoId, start: s.start, end: s.end, reason: r.reason } : null;
  };
  const coldOpen = (reply.coldOpen ?? []).map(toSeg).filter((x): x is Segment => !!x);
  const body = mergeAdjacent((reply.body ?? []).map(toSeg).filter((x): x is Segment => !!x));
  return { coldOpen, body };
}

/** Same grounded arrange, but pointed at a user's free-form creative goal
 *  ("make a video about how the host keeps interrupting the guest") instead of
 *  a generic best-cut. Returns the same Timeline shape so it drops straight
 *  into the existing arranged-cut UI/apply flow. */
export async function directedArrange(env: Env, videos: VideoTranscript[], instruction: string): Promise<Timeline> {
  const { menu, byId } = buildMenu(videos);
  const system =
    "You are a sharp video editor. The user tells you EXACTLY what they want the edit to be " +
    "about — follow their brief precisely, don't substitute your own idea of a good cut. " +
    "Find every sentence relevant to their brief, even ones far apart in the recording. " +
    "You only choose from the sentences given, by their [id]. You never invent text or times. " +
    "If nothing in the transcript matches the brief, return empty arrays rather than forcing it.";
  const user =
    `The user's brief: "${instruction.trim()}"\n\n` +
    "Select and order the sentences that fulfill this brief. Put 1-3 sentences that best set up " +
    "the premise in coldOpen (skip this if the brief doesn't call for a hook), and the rest — in a " +
    "coherent order — in body. Prefer contiguous runs from the same clip where it doesn't hurt the brief.\n\n" +
    'Return ONLY JSON: {"coldOpen":[{"id":"v0s2","reason":"why"}],"body":[{"id":"v1s0","reason":"why"}]}\n\n' +
    "Sentences:\n" +
    menu;

  const reply = await runJson<ArrangeReply>(env, system, user);
  const toSeg = (r: { id: string; reason?: string }): Segment | null => {
    const s = byId.get(r.id);
    return s ? { videoId: s.videoId, start: s.start, end: s.end, reason: r.reason } : null;
  };
  const coldOpen = (reply.coldOpen ?? []).map(toSeg).filter((x): x is Segment => !!x);
  const body = mergeAdjacent((reply.body ?? []).map(toSeg).filter((x): x is Segment => !!x));
  return { coldOpen, body };
}

// ── Shorts ───────────────────────────────────────────────────────────
interface ShortReply {
  shorts?: { title: string; startId: string; endId: string; hook?: string; why?: string; score?: number }[];
}

export async function suggestShorts(env: Env, videos: VideoTranscript[]): Promise<Short[]> {
  const { menu, byId } = buildMenu(videos);
  const system =
    "You find self-contained short-form clips (15 to 60 seconds) inside longer transcripts, " +
    "like Opus Clip. Each short must stand alone with a strong hook and a satisfying finish. " +
    "You only reference the sentence [id]s given.";
  const user =
    "Find the best 4 to 8 shorts. Each spans a contiguous run of sentences from ONE clip " +
    "(startId..endId inclusive), 15-60s long.\n\n" +
    'Return ONLY JSON: {"shorts":[{"title":"...","startId":"v0s3","endId":"v0s6","hook":"first line","why":"why it pops","score":0-100}]}\n\n' +
    "Sentences:\n" +
    menu;

  const reply = await runJson<ShortReply>(env, system, user);
  const shorts: Short[] = [];
  for (const s of reply.shorts ?? []) {
    const a = byId.get(s.startId);
    const b = byId.get(s.endId);
    if (!a || !b || a.videoId !== b.videoId) continue;
    const start = Math.min(a.start, b.start);
    const end = Math.max(a.end, b.end);
    if (end - start < 5) continue;
    shorts.push({
      title: s.title || "Untitled short",
      videoId: a.videoId,
      start,
      end,
      hook: s.hook || a.text,
      why: s.why,
      score: typeof s.score === "number" ? s.score : undefined,
    });
  }
  return shorts.sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
}

// ── Suggested edits (callbacks / contrasts / themes) ──────────────────
// The documentary-editing technique this maps to is a "thematic string-out":
// cluster every mention of a theme across the whole recording into one
// sequence, regardless of when it was said. Here we ask the model to find
// specific, concrete pairings (not vague topic overlap) worth an intentional
// juxtaposition — a joke callback, a contradiction, or a strong through-line.
interface SuggestReply {
  suggestions?: { title: string; type?: string; why?: string; segmentIds?: string[] }[];
}

export async function suggestEdits(env: Env, videos: VideoTranscript[]): Promise<EditSuggestion[]> {
  const { menu, byId } = buildMenu(videos);
  const system =
    "You are a sharp story editor. You read a full transcript (as numbered sentences) and find " +
    "SPECIFIC, CONCRETE connections between moments that are far apart — the same subject " +
    "mentioned twice (a callback/punchline), two statements that contradict or ironically " +
    "undercut each other, or a clear through-line worth cutting together. You do NOT propose " +
    "vague 'both are about life' connections — only ones a sharp editor would actually cut " +
    "together on purpose. You only reference the sentence [id]s given, never invent text.";
  const user =
    "Find the best 3 to 8 edit suggestions. Each cites 2 (occasionally 3) sentence ids, ideally " +
    "separated by real distance in the recording (this is the whole point — surfacing a distant " +
    "echo the editor would otherwise miss). Classify each as one of: callback (a punchline that " +
    "pays off something said earlier), contrast (two statements that undercut or contradict each " +
    "other), theme (a strong recurring idea worth stitching together).\n\n" +
    'Return ONLY JSON: {"suggestions":[{"title":"short punchy label","type":"callback","why":"one sentence, specific","segmentIds":["v0s12","v1s340"]}]}\n\n' +
    "Sentences:\n" +
    menu;

  const reply = await runJson<SuggestReply>(env, system, user);
  const suggestions: EditSuggestion[] = [];
  for (const s of reply.suggestions ?? []) {
    const segs = (s.segmentIds ?? [])
      .map((id) => byId.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((sent): Segment => ({ videoId: sent.videoId, start: sent.start, end: sent.end }));
    if (segs.length < 2) continue;
    const type: EditSuggestion["type"] = s.type === "contrast" || s.type === "theme" ? s.type : "callback";
    suggestions.push({ title: s.title || "Untitled connection", type, why: s.why || "", segments: segs });
  }
  return suggestions;
}

// ── Compose a video essay from the clip library ───────────────────────
// Unlike arrangeTimeline/directedArrange (which ground against raw transcript
// sentences), this grounds against ALREADY-SAVED, ALREADY-TITLED/TAGGED
// clips — the model only ever picks and orders clip [id]s, it never sees or
// invents timestamps. The caller maps each cited clip id back to that clip's
// stored segments (see POST /api/clips/compose in src/index.ts), so a
// "callback" clip already spanning two far-apart moments in the source video
// carries both moments along automatically when it's picked.
export interface ComposableClip {
  id: string;
  title: string;
  description?: string | null;
  tags: string[];
}
interface ComposeRef {
  clipId: string;
  reason?: string;
}
export interface ComposePlan {
  coldOpen: ComposeRef[];
  body: ComposeRef[];
}
interface ComposeReply {
  coldOpen?: { id: string; reason?: string }[];
  body?: { id: string; reason?: string }[];
}

export async function composeFromClips(env: Env, clips: ComposableClip[], instruction: string): Promise<ComposePlan> {
  const menu = clips
    .map((c) => {
      const desc = c.description ? ` — ${c.description}` : "";
      const tags = c.tags.length ? ` (tags: ${c.tags.join(", ")})` : "";
      return `[${c.id}] "${c.title}"${desc}${tags}`;
    })
    .join("\n");
  const system =
    "You are a sharp documentary editor assembling a video essay from a library of already-cut, " +
    "already-titled clips. The user tells you the brief; you select and order clips (by their [id]) " +
    "that fulfill it — you don't invent clips, content, or timestamps, only choose from the ones given. " +
    "If nothing in the library matches the brief, return empty arrays rather than forcing it.";
  const user =
    `The user's brief: "${instruction.trim()}"\n\n` +
    "Select and order the clips that fulfill this brief. Put 1-3 clips that best set up the premise " +
    "in coldOpen (skip this if the brief doesn't call for a hook), and the rest — in a coherent " +
    "narrative order — in body.\n\n" +
    'Return ONLY JSON: {"coldOpen":[{"id":"clip-uuid","reason":"why"}],"body":[{"id":"clip-uuid","reason":"why"}]}\n\n' +
    "Clips:\n" +
    menu;

  const reply = await runJson<ComposeReply>(env, system, user);
  const byId = new Set(clips.map((c) => c.id));
  const toRef = (r: { id: string; reason?: string }): ComposeRef | null => (byId.has(r.id) ? { clipId: r.id, reason: r.reason } : null);
  const coldOpen = (reply.coldOpen ?? []).map(toRef).filter((x): x is ComposeRef => !!x);
  const body = (reply.body ?? []).map(toRef).filter((x): x is ComposeRef => !!x);
  return { coldOpen, body };
}

// ── Bridging narration for gaps in an assembled cut ────────────────────
// The last piece of the "video essay" workflow: given a sequence of clips
// that already forms a rough cut, find the transitions that need a spoken
// bridge to read as a coherent narrative, and write that narration. The
// caller (POST /api/projects/:id/bridges) resolves each segment's actual
// spoken text before calling this — the model reasons over real transcript
// text, not just titles, so it can judge whether a transition actually
// needs connective narration or already flows.
export interface SegmentWithText {
  videoId: string;
  start: number;
  end: number;
  text: string;
}
export interface Bridge {
  afterIndex: number; // the gap sits between segments[afterIndex] and segments[afterIndex + 1]
  script: string;
}
interface BridgeReply {
  bridges?: { afterIndex?: number; script?: string }[];
}

export async function generateBridges(env: Env, segments: SegmentWithText[], goal?: string): Promise<Bridge[]> {
  if (segments.length < 2) return [];
  const menu = segments.map((s, i) => `[${i}] "${s.text || "(no speech)"}"`).join("\n");
  const system =
    "You are a documentary narrator and script writer. Given an ordered sequence of clips (their spoken " +
    "text) that already form a rough cut, find the transitions between adjacent clips that would feel " +
    "jarring or unclear cut straight together, and write a short spoken bridge — one or two sentences of " +
    "narration, in a natural human voiceover voice, not a robotic summary — that a narrator would say " +
    "between them to make the cut flow. Not every transition needs one; only flag the ones that do. " +
    "You never invent quotes from the clips themselves, only write NEW connective narration.";
  const user =
    `${goal?.trim() ? `The video's overall goal: "${goal.trim()}"\n\n` : ""}` +
    "The clips, in order:\n" +
    menu +
    "\n\n" +
    'Return ONLY JSON: {"bridges":[{"afterIndex":0,"script":"one or two sentences of narration"}]}';

  const reply = await runJson<BridgeReply>(env, system, user);
  const bridges: Bridge[] = [];
  for (const b of reply.bridges ?? []) {
    if (typeof b.afterIndex !== "number" || b.afterIndex < 0 || b.afterIndex >= segments.length - 1) continue;
    const script = b.script?.trim();
    if (!script) continue;
    bridges.push({ afterIndex: b.afterIndex, script });
  }
  return bridges.sort((a, z) => a.afterIndex - z.afterIndex);
}
