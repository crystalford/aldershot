/**
 * ALIGNING A TAKE, AND WRITING DOWN WHAT IT TURNED OUT TO BE.
 *
 * src/take.ts is the arithmetic and src/align-source.ts makes the call;
 * this is the part that reads the beat, asks, and records the answer.
 *
 * IT NEVER REJECTS A TAKE. A verdict of `drifted` is a thing the editor
 * says beside the beat, not a recording thrown away — the person was there
 * and we were not, and a take that reads badly to a model is sometimes
 * exactly the one they wanted. What it must not do is quietly use a take
 * of a different sentence under a caption claiming the written one.
 */

import type { Env } from "./env.ts";
import { alignTake } from "./align-source.ts";
import { readTake, scriptWords, type Take } from "./take.ts";

interface BeatRow {
  id: string;
  text: string | null;
  media_r2_key: string | null;
}

export async function runTake(env: Env, userId: string, beatId: string): Promise<Take> {
  const beat = await env.DB.prepare(
    `SELECT b.id, b.text, b.media_r2_key FROM beats b
       JOIN v2_projects p ON p.id = b.project_id
      WHERE b.id = ? AND p.user_id = ? AND p.deleted_at IS NULL`,
  )
    .bind(beatId, userId)
    .first<BeatRow>();
  if (!beat) throw new Error("that beat isn't here any more");
  if (!beat.media_r2_key) throw new Error("there is no recording on that beat");

  const words = scriptWords(beat.text ?? "");
  const take = readTake(await alignTake(env, beat.media_r2_key, words), words.length);

  /*
   * THE VERDICT BELONGS TO THE TAKE, and the beat mirrors the chosen one.
   *
   * It is a fact about one recording — whether THIS audio is the line that
   * was written — so writing it only to the beat meant a second take
   * inherited the first one's answer until it was re-aligned. The beat keeps
   * its copy because the editor and the renderer read one field, and that
   * copy is now a mirror of whichever take the beat points at.
   */
  await env.DB.prepare(
    `UPDATE takes SET verdict = ?, reason = ?, words = ?, dur_ms = COALESCE(?, dur_ms)
      WHERE beat_id = ? AND r2_key = ?`,
  )
    .bind(
      take.verdict,
      take.reason,
      JSON.stringify(
        take.words.map((w, i) => ({ w: words[i] ?? "", s: w.startMs / 1000, e: w.endMs / 1000 })),
      ),
      take.durationMs || null,
      beatId,
      beat.media_r2_key,
    )
    .run();

  await env.DB.prepare(
    `UPDATE beats SET take_verdict = ?, take_reason = ?, take_words = ?, dur_ms = ? WHERE id = ?`,
  )
    .bind(
      take.verdict,
      take.reason,
      /* SECONDS in storage, like every other word list in this product —
         the landmine documented in src/cuts.ts. */
      JSON.stringify(
        take.words.map((w, i) => ({ w: words[i] ?? "", s: w.startMs / 1000, e: w.endMs / 1000 })),
      ),
      /*
       * MEASURED, not claimed. The browser's x-duration-ms is what this
       * replaces: a number about a file the server had not looked at.
       * A take that aligned nothing keeps whatever was there rather than
       * being set to zero, because zero is a length and "we do not know"
       * is not.
       */
      take.durationMs || null,
      beatId,
    )
    .run();

  return take;
}
