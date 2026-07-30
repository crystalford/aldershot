/**
 * The narrative brain — reason over transcripts with a Workers AI text model to
 * (1) arrange a long-form cut and (2) suggest Opus-Clip-style shorts.
 *
 * The model never invents timestamps: it picks from a numbered MENU of
 * sentences, and we map its picks back to exact source times. That keeps output
 * small, grounded, and cheap to validate.
 */
import type { Env } from "../env";
import type { Word, Segment, Timeline, Short } from "../transcript/edl";

// Capable, fast Workers AI text model. Exact id to confirm against the live
// catalog (feasibility doc lists Llama available natively).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_SENTENCES = 500;

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
