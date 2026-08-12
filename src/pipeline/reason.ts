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
import { MODELS } from "../models";

const MODEL = MODELS.writer;
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
  /** A short summary of what's visually tagged within the clip's own time
   *  range (see visualtags.ts) — folded into the menu line when present, so
   *  a clip with no matching dialogue but a matching visual (a silent
   *  reaction shot, an on-screen graphic) is still findable. Optional: only
   *  populated once a clip has been through visual tagging. */
  visualSummary?: string;
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

function buildClipMenu(clips: ComposableClip[]): string {
  return clips
    .map((c) => {
      const desc = c.description ? ` — ${c.description}` : "";
      const tags = c.tags.length ? ` (tags: ${c.tags.join(", ")})` : "";
      const visual = c.visualSummary ? ` [on screen: ${c.visualSummary}]` : "";
      return `[${c.id}] "${c.title}"${desc}${tags}${visual}`;
    })
    .join("\n");
}

export async function composeFromClips(env: Env, clips: ComposableClip[], instruction: string): Promise<ComposePlan> {
  const menu = buildClipMenu(clips);
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

// ── Source AI summary — a one-time, cached exec summary of a source video's
// own transcript, shown on the Sources detail page. Purely extractive-in-
// spirit (summarizes what's actually said), not a claim-generating call. ──
export async function summarizeTranscript(env: Env, words: Word[]): Promise<string | null> {
  const text = words.map((w) => w.text).join(" ").trim();
  if (!text) return null;
  const system =
    "You write a two-sentence executive summary of a video transcript for someone deciding whether to use " +
    "it as source footage. Be concrete about what's actually said/covered — no vague filler.";
  const user = `Transcript:\n${text.slice(0, 6000)}\n\nReturn ONLY JSON: {"summary":"two sentences"}`;
  try {
    const reply = await runJson<{ summary?: string }>(env, system, user);
    return reply.summary?.trim() || null;
  } catch {
    return null;
  }
}

// ── Thread description — a one-time, cached classification + one-sentence
// synopsis for a Threads card, derived only from that thread's own sample
// clip titles (never invents details beyond what the titles suggest). Kind
// is a coarse bucket for grouping the Threads view, mirroring the
// prototype's People/Shows/Topics sections — there's no fixed roster here
// (threads are auto-clustered, not hand-curated), so this is inferred per
// thread rather than looked up. ─────────────────────────────────────────
interface ThreadDescribeReply {
  kind: "person" | "show" | "topic";
  synopsis: string;
}
export interface ThreadDescription {
  kind: "person" | "show" | "topic";
  synopsis: string;
}
export async function describeThread(env: Env, name: string, sampleTitles: string[]): Promise<ThreadDescription | null> {
  const system =
    "You classify a cluster of video-clip titles from one creator's personal archive into a short profile. " +
    'kind is "person" if the cluster is centered on one recurring individual, "show" if it\'s a recurring ' +
    'program/series/stream, or "topic" otherwise. synopsis is one plain sentence (under 25 words) describing ' +
    "what this cluster is about, grounded only in the titles given — don't invent facts not implied by them.";
  const user =
    `Cluster name: "${name}"\n` +
    `Sample clip titles:\n${sampleTitles.map((t) => `- ${t}`).join("\n")}\n\n` +
    'Return ONLY JSON: {"kind":"person"|"show"|"topic","synopsis":"one sentence"}';
  try {
    const reply = await runJson<ThreadDescribeReply>(env, system, user);
    if (!reply.synopsis?.trim()) return null;
    const kind = reply.kind === "person" || reply.kind === "show" ? reply.kind : "topic";
    return { kind, synopsis: reply.synopsis.trim() };
  } catch {
    return null;
  }
}

// ── Discover result -> thread tagging — a single batched call (not one per
// result) that assigns each generic search result to whichever existing
// Archive thread it best matches, if any, plus a one-sentence "why" and a
// 0-100 confidence label. The model only ever picks a real thread id from
// the menu (or none) — it never invents a thread. ──────────────────────
interface DiscoverMatchReply {
  matches?: { index?: number; threadId?: string | null; confidence?: number; why?: string }[];
}
export interface DiscoverThreadMatch {
  threadId: string;
  confidence: number;
  why: string;
}
export async function matchDiscoverToThreads(
  env: Env,
  results: { title: string; extract: string }[],
  threads: { id: string; name: string }[],
): Promise<Map<number, DiscoverThreadMatch>> {
  const map = new Map<number, DiscoverThreadMatch>();
  if (!results.length || !threads.length) return map;
  const resultMenu = results.map((r, i) => `[${i}] "${r.title}" — ${r.extract.slice(0, 200)}`).join("\n");
  const threadMenu = threads.map((t) => `[${t.id}] ${t.name}`).join("\n");
  const system =
    "You match search results to the existing topic thread (if any) they're most relevant to, for a " +
    "video-essay research tool. Only ever pick a threadId from the list given, or null if nothing fits well. " +
    "Never invent a thread.";
  const user =
    `Threads:\n${threadMenu}\n\nSearch results:\n${resultMenu}\n\n` +
    'Return ONLY JSON: {"matches":[{"index":0,"threadId":"thread-id-or-null","confidence":0-100,"why":"one short sentence"}]}';
  try {
    const reply = await runJson<DiscoverMatchReply>(env, system, user);
    const byId = new Set(threads.map((t) => t.id));
    for (const m of reply.matches ?? []) {
      if (typeof m.index !== "number" || !m.threadId || !byId.has(m.threadId)) continue;
      map.set(m.index, { threadId: m.threadId, confidence: Math.max(0, Math.min(100, Math.round(m.confidence ?? 0))), why: (m.why || "").trim() });
    }
  } catch {
    /* best-effort tagging — Discover results are still fully usable untagged */
  }
  return map;
}

// ── "Ask the archive" — a grounded Q&A read over the saved clip library,
// same discipline as composeFromClips: the model only ever cites a real
// clip's [id] plus that clip's own title/description as its "quote" (there's
// no raw transcript text stored per clip, only title/description/tags), and
// returns null rather than inventing an answer when nothing supports it. ──
interface AskReply {
  answer: string | null;
  citations?: { id: string }[];
}
export interface ArchiveAnswer {
  summary: string;
  citations: { clipId: string; quote: string }[];
}
export async function askArchive(env: Env, clips: ComposableClip[], question: string): Promise<ArchiveAnswer | null> {
  const menu = buildClipMenu(clips);
  const system =
    "You answer questions about a personal video-clip archive using ONLY the clips given to you — their " +
    "titles, descriptions, and tags. You never invent a fact, a quote, or a clip that isn't in the menu. " +
    "If nothing in the archive actually answers the question, say so by returning answer: null — do not " +
    "guess or pad out a vague answer.";
  const user =
    `Question: "${question.trim()}"\n\n` +
    'Return ONLY JSON: {"answer":"one or two sentence answer grounded in the clips below, or null if nothing supports an answer","citations":[{"id":"clip-uuid"}]}\n\n' +
    "Clips:\n" +
    menu;

  const reply = await runJson<AskReply>(env, system, user);
  const answer = reply.answer?.trim();
  if (!answer) return null;
  const byId = new Map(clips.map((c) => [c.id, c]));
  const citations = (reply.citations ?? [])
    .map((r) => byId.get(r.id))
    .filter((c): c is ComposableClip => !!c)
    .map((c) => ({ clipId: c.id, quote: c.title }));
  return { summary: answer, citations };
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

// ── Reaction / cutaway clip suggestion ──────────────────────────────────
// The "he says X, cut to some unrelated clip that echoes X" pattern common
// in commentary/review editing — a comedic punctuation cut, not a narrative
// bridge. Scoped deliberately to the user's OWN saved library only (same
// grounded, cite-a-real-id-or-return-nothing discipline as everything else
// here) — reaching into a broader stock/meme corpus of clips the user
// doesn't own is a different, deferred idea, not this function's job.
interface ReactionReply {
  clipId?: string | null;
  reason?: string;
}

// ── Generative scene-building ──────────────────────────────────────────
// "Context first, then image, then video" (see Generative's design brief) —
// this function is the "context" step: turn a script line into ONE
// consistent scene description (same location/light/palette across every
// cut) plus N individual shot descriptions. Like generateBridges, this is
// genuinely GENERATIVE content, not grounded against a menu of real things —
// there's nothing to cite an [id] from here, the whole point is drafting new
// descriptive text for an image model to render. The "register" the design
// brief calls for (an internal emotional/thematic read of the line) is
// deliberately never surfaced as its own field in the reply — it only shows
// up baked into the prose of world/shot descriptions, matching the brief's
// explicit rejection of exposing that as a separate labeled picker.
export interface SceneWorld {
  location: string;
  light: string;
  palette: string;
}
export interface SceneShot {
  index: number;
  type: string; // short label, e.g. "establishing", "detail", "reaction"
  description: string;
  weight: string; // framing, e.g. "wide", "medium close-up"
  motion: string; // what should move in the animate step
}
export interface SceneDraft {
  world: SceneWorld;
  shots: SceneShot[];
}
interface SceneReply {
  world?: { location?: string; light?: string; palette?: string };
  shots?: { type?: string; description?: string; weight?: string; motion?: string }[];
}

export async function draftSceneShots(env: Env, line: string, cutCount: number): Promise<SceneDraft> {
  const n = Math.min(4, Math.max(1, Math.round(cutCount)));
  const system =
    "You are a cinematographer breaking a single line from a video essay's script into b-roll. " +
    "Read the line for its emotional and thematic register, then design ONE consistent cinematic " +
    "scene — same location, same light, same color palette — described concretely enough for an " +
    "image model to render, in plain visual prose (no camera jargon dump, no separate labeled " +
    "fields). Never mention the register or your interpretation directly — it should only show up " +
    "baked into how you describe the scene.";
  const user =
    `The line: "${line.trim()}"\n\n` +
    `Design ${n} shot(s) of one consistent scene for this line. Return ONLY JSON:\n` +
    '{"world":{"location":"...","light":"...","palette":"..."},' +
    '"shots":[{"type":"establishing","description":"concrete visual description, one or two sentences",' +
    '"weight":"wide|medium|close-up etc.","motion":"what moves for the animate step, one short phrase"}]}\n\n' +
    `Exactly ${n} entries in "shots".`;

  const reply = await runJson<SceneReply>(env, system, user);
  const world: SceneWorld = {
    location: reply.world?.location?.trim() || "an unspecified location",
    light: reply.world?.light?.trim() || "natural light",
    palette: reply.world?.palette?.trim() || "neutral tones",
  };
  const shots: SceneShot[] = (reply.shots ?? []).slice(0, n).map((s, i) => ({
    index: i,
    type: s.type?.trim() || "shot",
    description: s.description?.trim() || line.trim(),
    weight: s.weight?.trim() || "medium",
    motion: s.motion?.trim() || "slow push-in",
  }));
  while (shots.length < n) {
    shots.push({ index: shots.length, type: "shot", description: line.trim(), weight: "medium", motion: "slow push-in" });
  }
  return { world, shots };
}

// ── Essay act-by-act drafting ─────────────────────────────────────────
// Powers the Essay Builder's "Build it act by act" flow — a small,
// conversational alternative to a single black-box "Generate outline"
// button. One call proposes exactly ONE candidate beat for ONE named act,
// grounded against the same saved-clip menu as composeFromClips whenever a
// real clip fits; otherwise it drafts a short narration line instead (a
// generative script *draft* the user reviews/edits, same as
// generateBridges — not presented as fact, so inventing the line's wording
// is fine even though clip picks must still cite a real [id]).
const ACT_HINTS: Record<string, string> = {
  hook: "Hook — grab attention immediately, pose the question or tension the piece will explore.",
  setup: "Setup — establish the context/characters/stakes a viewer needs before the argument develops.",
  development: "Development — build the case with concrete evidence, escalating specificity.",
  turn: "Turn — introduce a complication, contradiction, or twist that recontextualizes everything before it.",
  resolution: "Resolution — land the payoff/conclusion the whole piece has been building toward.",
};

export interface ActDraftCandidate {
  kind: "clip" | "vo" | "research";
  clipId?: string;
  text: string;
  reason: string;
}
interface ActDraftReply {
  kind?: string;
  clipId?: string | null;
  text?: string;
  reason?: string;
}

export async function draftEssayActBeat(
  env: Env,
  premise: string,
  act: string,
  existingBeatTexts: string[],
  clips: ComposableClip[],
  direction?: string,
): Promise<ActDraftCandidate | null> {
  const menu = buildClipMenu(clips);
  const hint = ACT_HINTS[act] || act;
  const already = existingBeatTexts.length
    ? `Beats already drafted elsewhere in this essay (don't repeat these):\n${existingBeatTexts.map((t) => `- ${t}`).join("\n")}\n\n`
    : "";
  const directionNote = direction?.trim() ? `The user's direction for this beat specifically: "${direction.trim()}"\n\n` : "";
  const system =
    "You are a sharp documentary editor drafting ONE beat at a time for a video essay, act by act. " +
    "Prefer a real clip from the library when one genuinely fits — cite it by its [id], never invent a " +
    "clip or timestamp. Propose a short new narration line (kind \"vo\") when no clip in the library " +
    "actually serves this act, or (kind \"research\") when the beat states a factual claim that needs an " +
    "outside source to back it up rather than the essay's own footage — narration is a draft the user will " +
    "review and can re-record, so it's fine to write it yourself, but keep it one or two sentences in a " +
    "natural spoken voice, not a summary. A research beat is left ungrounded here on purpose — the user " +
    "grounds it to a real source afterward, never invented.";
  const user =
    `Essay premise: "${premise.trim()}"\n\n` +
    `Draft the next beat for this act: ${hint}\n\n` +
    already +
    directionNote +
    (clips.length ? `Clips available:\n${menu}\n\n` : "No clips are saved in the library yet — you'll have to propose narration.\n\n") +
    'Return ONLY JSON: {"kind":"clip","clipId":"clip-uuid","reason":"why this clip fits, one sentence"} ' +
    'OR {"kind":"vo","text":"the narration line","reason":"why narration instead of a clip, one sentence"} ' +
    'OR {"kind":"research","text":"the claim that needs a source","reason":"why it needs outside grounding, one sentence"}';

  const reply = await runJson<ActDraftReply>(env, system, user);
  if (reply.kind === "clip" && reply.clipId) {
    const match = clips.find((c) => c.id === reply.clipId);
    if (match) return { kind: "clip", clipId: match.id, text: match.title, reason: reply.reason?.trim() || "" };
  }
  if (reply.kind === "research" && reply.text?.trim()) {
    return { kind: "research", text: reply.text.trim(), reason: reply.reason?.trim() || "" };
  }
  if (reply.text?.trim()) return { kind: "vo", text: reply.text.trim(), reason: reply.reason?.trim() || "" };
  return null;
}

export async function suggestReactionClip(env: Env, clips: ComposableClip[], line: string): Promise<{ clipId: string; reason: string } | null> {
  if (!clips.length) return null;
  const menu = buildClipMenu(clips);
  const system =
    "You are a sharp comedy editor. The user just said a specific line in their video, and wants to know " +
    "if any clip already in their library would land as a quick reaction or cutaway right after it — the " +
    "kind of edit where cutting to an unrelated clip echoes or punctuates what was just said, for comedic " +
    "effect. You only choose from the clips given, by their [id]. A forced, unfunny match is worse than no " +
    "match — if nothing genuinely fits, say so rather than picking the closest thing.";
  const user =
    `The line just said: "${line.trim()}"\n\n` +
    "If one of these clips would land as a reaction/cutaway right after that line, name it and say why in " +
    "one sentence. If nothing really fits, return null for clipId.\n\n" +
    'Return ONLY JSON: {"clipId":"clip-uuid or null","reason":"why it lands, one sentence"}\n\n' +
    "Clips:\n" +
    menu;

  const reply = await runJson<ReactionReply>(env, system, user);
  if (!reply.clipId) return null;
  const match = clips.find((c) => c.id === reply.clipId);
  if (!match) return null;
  return { clipId: match.id, reason: reply.reason?.trim() || "" };
}
