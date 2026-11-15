/**
 * DOCUMENTS — invariant 8's second tier, which had no supply.
 *
 * "own footage → user's documents → open world → generated", and nothing in
 * the product took a PDF or a photograph. `documents` was a source the
 * framework ranked above the open world and nobody could fill, so every
 * EVIDENCE line fell through to footage or to nothing.
 *
 * WHAT MAKES A DOCUMENT PROOF IS THE MAKER SAYING SO. Doc 08 asks for "the
 * proof itself — the document with its line marked", and nothing here reads
 * a PDF to find the line. So the marking is a sentence the maker writes:
 * what this document shows. That sentence is what a line is matched against,
 * and it is what the receipt records them having asserted — invariant 10,
 * the user's own words win where they exist.
 *
 * A DOCUMENT WITH NO NOTE IS NOT PROBATIVE, and that is the whole reason
 * `note` is nullable rather than required. It is still a document and still
 * outranks the open world; it simply cannot carry an EVIDENCE line, because
 * "with its line marked" is exactly the half that would be missing. Nobody
 * is blocked from adding one — a scan you have not described yet is a normal
 * state — and the offer says why it is not being suggested as proof.
 *
 * MATCHED BY MEASUREMENT, NOT BY A MODEL. Word overlap between the line and
 * the document's own words, which is the house rule: if it can be a
 * measurement it is not a model call. A document library is tens of items,
 * not tens of thousands, so there is nothing here that needs an index.
 */

import { ulid } from "./id.ts";

/** What may be dropped in, and nothing else. */
export const DOCUMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/**
 * The ceiling, and it is small on purpose.
 *
 * A document goes through the worker in one request rather than through the
 * multipart path a video needs. Eight megabytes covers a scanned contract or
 * a photograph of a letter; anything larger is a video pretending to be a
 * document, or a file somebody will be happier compressing than waiting for.
 */
export const MAX_BYTES = 8 * 1024 * 1024;

export interface DocumentRow {
  id: string;
  title: string;
  /** What it shows, in the maker's words. Null until they say. */
  note: string | null;
  filename: string | null;
  mediaType: string;
  r2Key: string;
  bytes: number;
  createdAt: number;
}

export const isDocumentType = (t: string): boolean =>
  (DOCUMENT_TYPES as readonly string[]).includes(t);

/** Where the file lives. Under the user, like everything else of theirs. */
export const keyFor = (userId: string, id: string): string => `u/${userId}/documents/${id}`;

export async function addDocument(
  db: D1Database,
  userId: string,
  d: { title: string; note?: string | null; filename?: string | null; mediaType: string; bytes: number },
  now = Date.now(),
): Promise<DocumentRow> {
  const id = ulid(now);
  const row: DocumentRow = {
    id,
    title: d.title,
    note: d.note?.trim() || null,
    filename: d.filename ?? null,
    mediaType: d.mediaType,
    r2Key: keyFor(userId, id),
    bytes: d.bytes,
    createdAt: now,
  };
  await db
    .prepare(
      "INSERT INTO documents (id,user_id,title,note,filename,media_type,r2_key,bytes,created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(id, userId, row.title, row.note, row.filename, row.mediaType, row.r2Key, row.bytes, now)
    .run();
  return row;
}

interface Raw {
  id: string;
  title: string;
  note: string | null;
  filename: string | null;
  media_type: string;
  r2_key: string;
  bytes: number;
  created_at: number;
}

const rowOf = (r: Raw): DocumentRow => ({
  id: r.id,
  title: r.title,
  note: r.note,
  filename: r.filename,
  mediaType: r.media_type,
  r2Key: r.r2_key,
  bytes: Number(r.bytes),
  createdAt: Number(r.created_at),
});

/** Everything the maker has added and not put away. Newest first. */
export async function listDocuments(db: D1Database, userId: string, limit = 100): Promise<DocumentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id,title,note,filename,media_type,r2_key,bytes,created_at FROM documents " +
        "WHERE user_id = ? AND removed_at IS NULL ORDER BY created_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<Raw>();
  return (results ?? []).map(rowOf);
}

export async function getDocument(db: D1Database, id: string, userId: string): Promise<DocumentRow | null> {
  const r = await db
    .prepare(
      "SELECT id,title,note,filename,media_type,r2_key,bytes,created_at FROM documents " +
        "WHERE id = ? AND user_id = ? AND removed_at IS NULL",
    )
    .bind(id, userId)
    .first<Raw>();
  return r ? rowOf(r) : null;
}

/** Say what it shows, or change what you said. The marking, after the fact. */
export async function markDocument(
  db: D1Database,
  id: string,
  userId: string,
  note: string,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE documents SET note = ? WHERE id = ? AND user_id = ? AND removed_at IS NULL")
    .bind(note.trim() || null, id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Put one away. NOT a delete — invariant 6, nothing is deleted.
 *
 * The row stays and the file stays; it stops being offered. A document
 * somebody removed because it was the wrong scan is a document they may want
 * back when they find out it was the right one.
 */
export async function removeDocument(db: D1Database, id: string, userId: string, now = Date.now()): Promise<boolean> {
  const res = await db
    .prepare("UPDATE documents SET removed_at = ? WHERE id = ? AND user_id = ? AND removed_at IS NULL")
    .bind(now, id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/* ── Matching a line ────────────────────────────────────────────────────── */

/**
 * Words that carry meaning, which is the same stopword list the adversarial
 * eval set uses and for the same reason: a filter that drops short words
 * throws away "cut", "won", "owed" and keeps "about".
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "by", "for", "with",
  "from", "as", "is", "was", "are", "were", "be", "been", "it", "its", "this", "that", "these",
  "those", "they", "them", "their", "we", "us", "our", "you", "your", "i", "me", "my", "he", "she",
  "him", "her", "his", "not", "no", "so", "then", "than", "there", "here", "what", "which", "who",
  "when", "where", "how", "all", "any", "some", "about", "into", "over", "out", "up", "down",
]);

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => !STOP.has(w));
}

/**
 * HOW WELL THIS DOCUMENT ANSWERS THIS LINE.
 *
 * Share of the LINE's content words that appear in the document's own words —
 * its title and the maker's note. Keyed on the line rather than the document
 * so a long note cannot win by covering everything: the question is whether
 * this document is about what the line says, not whether the line is a
 * subset of the note.
 */
export function overlap(line: string, d: Pick<DocumentRow, "title" | "note">): number {
  const want = new Set(contentWords(line));
  if (!want.size) return 0;
  const have = new Set(contentWords(`${d.title} ${d.note ?? ""}`));
  let hit = 0;
  for (const w of want) if (have.has(w)) hit += 1;
  return hit / want.size;
}

/**
 * The floor for offering a document at all.
 *
 * One content word in five, which is loose — and deliberately: a document
 * library is small and hand-made, so the cost of showing one too many is a
 * person glancing past it, while the cost of hiding the right scan is them
 * concluding the feature does not work. Nothing about this number decides
 * whether a document is PROOF; that is the note's job and `allowed()`'s.
 */
export const MATCH_AT = 0.2;

/** The documents worth offering for this line, best first. */
export function matchDocuments(line: string, docs: DocumentRow[], limit = 4): Array<DocumentRow & { score: number }> {
  return docs
    .map((d) => ({ ...d, score: overlap(line, d) }))
    .filter((d) => d.score >= MATCH_AT)
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    .slice(0, limit);
}
