/**
 * Clip embeddings — powers Threads' semantic clustering (see src/threads.ts).
 * Each clip's title/description/transcript-excerpt/visual-tag text gets
 * embedded once and upserted into Vectorize; threads.ts clusters that space
 * instead of matching on exact tag strings, so two differently-tagged clips
 * about the same theme still land in the same thread.
 *
 * VECTORIZE is an optional binding (see env.ts, same pattern as RENDER) — a
 * fresh deploy works fully via the tag-equality fallback in threads.ts until
 * `wrangler vectorize create` has actually been run and the binding added to
 * wrangler.jsonc. Every function here no-ops (not throws) when it's absent.
 */
import type { Env } from "./env";
import type { ClipDetail } from "./clips";
import type { Word } from "./transcript/edl";
import { MODELS } from "./models";
import { transcriptKey } from "./keys";
import { readJson } from "./r2json";

/** What gets embedded: title, description, the spoken words within each
 *  segment's [start,end] (kept words only — a deleted word isn't part of
 *  the clip anymore), and any visual-tag caption/OCR text on that range.
 *  Bounded length — an embedding model call doesn't need (or want) an
 *  unbounded transcript, just enough text to place the clip in theme-space. */
export async function clipEmbeddingText(env: Env, clip: ClipDetail): Promise<string> {
  const parts: string[] = [clip.title];
  if (clip.description) parts.push(clip.description);

  const wordsCache = new Map<string, Word[] | null>();
  for (const seg of clip.segments) {
    const key = transcriptKey(seg.projectId, seg.videoId);
    if (!wordsCache.has(key)) wordsCache.set(key, await readJson<Word[]>(env.MEDIA, key));
    const words = wordsCache.get(key);
    if (words?.length) {
      const spoken = words
        .filter((w) => !w.deleted && w.start >= seg.start && w.end <= seg.end)
        .map((w) => w.text)
        .join(" ");
      if (spoken) parts.push(spoken);
    }
    for (const vt of seg.visualTags) {
      if (vt.caption) parts.push(vt.caption);
      if (vt.ocrText) parts.push(vt.ocrText);
    }
  }
  return parts.join(". ").slice(0, 4000);
}

async function embed(env: Env, text: string): Promise<number[] | null> {
  const res = (await env.AI.run(MODELS.embed, { text: [text] })) as { data?: number[][] };
  return res.data?.[0] ?? null;
}

/** Embed a clip and upsert its vector. Call after create, after visual tags
 *  land (title/description alone at creation time misses "what's on screen"),
 *  and after any edit that changes title/description/segments. */
export async function embedAndIndexClip(env: Env, clip: ClipDetail): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    const text = await clipEmbeddingText(env, clip);
    const vector = await embed(env, text);
    if (!vector) return;
    await env.VECTORIZE.upsert([{ id: clip.id, values: vector }]);
  } catch (err) {
    // Embedding is an enrichment, not a requirement for the clip to exist —
    // same "fire it, don't fail the save" discipline as visual tagging.
    console.error("[embeddings] embedAndIndexClip failed:", err);
  }
}

export async function removeClipEmbedding(env: Env, clipId: string): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([clipId]);
  } catch (err) {
    console.error("[embeddings] removeClipEmbedding failed:", err);
  }
}
