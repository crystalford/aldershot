/**
 * CONNECTING A BUCKET, AND BRINGING THE FOOTAGE ACROSS.
 *
 * The storage half of src/bucket.ts: who has connected what, and turning a
 * listing into sources you can see in Footage.
 *
 * NOTHING IS COPIED AND NOTHING IS READ. An import creates a row per video
 * pointing at the object where it already lives, in state `unread`. That is
 * why connecting an archive of two hundred videos is instant and free: the
 * expensive, metered part is reading one, and that happens the first time you
 * cut with it (invariant 5 — footage is read once, charged once).
 */
import { listBucket, isFootage, presignFromBucket, type BucketConn } from "./bucket.ts";
import { VLOG_COLUMNS, importableFrom, type Importable, type VlogRow } from "./neolog.ts";
import { open, seal } from "./secretbox.ts";
import type { Env } from "./env.ts";

export interface Connection {
  id: string;
  provider: string;
  endpoint: string;
  bucket: string;
  region: string | null;
  access_key_id: string;
  foreign_db: string | null;
  last_import_at: number | null;
  created_at: number;
}

interface Row extends Connection {
  secret_sealed: string;
}

/*
 * The access key id is readable; only the secret is sealed. Showing which
 * key is connected without decrypting anything is the difference between a
 * Settings page that can describe a connection and one that has to unlock a
 * secret to draw a label.
 */
const PUBLIC =
  "id, provider, endpoint, bucket, region, access_key_id, foreign_db, last_import_at, created_at";

export async function listConnections(db: D1Database, userId: string): Promise<Connection[]> {
  const { results } = await db
    .prepare(`SELECT ${PUBLIC} FROM connections WHERE user_id=? ORDER BY created_at DESC`)
    .bind(userId)
    .all<Connection>();
  return results ?? [];
}

export async function saveConnection(
  env: Env,
  userId: string,
  conn: BucketConn & { provider?: string; foreignDb?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO connections
       (id,user_id,provider,endpoint,bucket,region,access_key_id,secret_sealed,foreign_db,last_import_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL,?)`,
  )
    .bind(
      id,
      userId,
      conn.provider || "r2",
      conn.endpoint,
      conn.bucket,
      conn.region || null,
      conn.accessKeyId,
      await seal(env, conn.secretAccessKey),
      conn.foreignDb || null,
      Date.now(),
    )
    .run();
  return id;
}

/**
 * The connection with its key, ready to sign a request.
 *
 * Null when the row is gone or the secret will not open — a connection
 * written under a different SESSION_SECRET, or a tampered column. Both mean
 * the same thing to the person: reconnect it.
 */
export async function usableConnection(
  env: Env,
  id: string,
  userId: string,
): Promise<(BucketConn & { id: string; foreignDb: string | null }) | null> {
  const row = await env.DB.prepare(
    `SELECT ${PUBLIC}, secret_sealed FROM connections WHERE id=? AND user_id=?`,
  )
    .bind(id, userId)
    .first<Row>();
  if (!row) return null;

  const secret = await open(env, row.secret_sealed);
  if (!secret) return null;

  return {
    id: row.id,
    endpoint: row.endpoint,
    bucket: row.bucket,
    region: row.region ?? undefined,
    accessKeyId: row.access_key_id,
    secretAccessKey: secret,
    foreignDb: row.foreign_db,
  };
}

/**
 * WHAT THE ARCHIVE'S OWN DATABASE KNOWS, and nothing more.
 *
 * Length and date, read from a `vlogs` table. Length is how you choose what
 * to read now that reading is a decision you make per video; the date is
 * what `time` ordering and Story sort by, and it is the one field an import
 * cannot recover later.
 *
 * NOT transcripts — see the header of src/neolog.ts for why, and
 * test/bucket.test.ts for the check that keeps it true.
 *
 * A missing or unreadable metadata database is not a failure: you get the
 * footage without lengths and dates, which is worse and still works.
 */
async function metadataFor(env: Env, dbName: string | null): Promise<Map<string, Importable>> {
  const out = new Map<string, Importable>();
  const archive = dbName ? (env as unknown as Record<string, D1Database>)[dbName] : null;
  if (!archive || typeof archive.prepare !== "function") return out;
  try {
    const { results } = await archive.prepare(`SELECT ${VLOG_COLUMNS} FROM vlogs`).all<VlogRow>();
    for (const it of importableFrom(results ?? [])) out.set(it.key, it);
  } catch {
    /* Another schema, no such table, no permission. The footage still
       imports; it simply arrives without lengths and dates. */
  }
  return out;
}

/**
 * A URL the reader can fetch this source's video with.
 *
 * Imported footage is never copied here — the row points at the object in the
 * bucket it came from — so reading it means signing a request with THAT
 * connection's key. Null for an ordinary uploaded source, which the caller
 * reads from our own bucket exactly as before.
 *
 * Null also when the connection has been removed or its key will not open:
 * the honest answer there is that this video cannot be read until the
 * connection is restored, which is better than reaching for a bucket we can
 * no longer prove we may read.
 */
export async function presignSource(
  env: Env,
  userId: string,
  source: { r2_key: string; connection_id?: string | null },
): Promise<string | null> {
  if (!source.connection_id) return null;
  const conn = await usableConnection(env, source.connection_id, userId);
  if (!conn) return null;
  return presignFromBucket(conn, source.r2_key);
}

export interface ImportReport {
  added: number;
  already: number;
  /** The listing stopped at the page cap — there is more over there. */
  truncated: boolean;
}

/**
 * Bring across everything in the bucket that is footage.
 *
 * Idempotent by `foreign_id`: running it again after you have added videos
 * adds only the new ones. That matters because this is the gesture somebody
 * repeats — connect once, import again next month — and a second import
 * duplicating a library would be unrecoverable by hand.
 */
export async function importFromBucket(
  env: Env,
  userId: string,
  conn: BucketConn & { id: string; foreignDb: string | null },
  opts: { fetcher?: typeof fetch } = {},
): Promise<ImportReport> {
  const { objects, truncated } = await listBucket(conn, { fetcher: opts.fetcher });
  const meta = await metadataFor(env, conn.foreignDb);

  const { results } = await env.DB.prepare(
    `SELECT foreign_id FROM sources WHERE user_id=? AND connection_id=? AND foreign_id IS NOT NULL`,
  )
    .bind(userId, conn.id)
    .all<{ foreign_id: string }>();
  const have = new Set((results ?? []).map((r) => r.foreign_id));

  let added = 0;
  let already = 0;
  const now = Date.now();
  for (const obj of objects) {
    if (!isFootage(obj.key)) continue;
    const known = meta.get(obj.key);
    /* The archive's own id when it has one, the object key otherwise. Either
       way it is stable across imports, which is what makes this repeatable. */
    const foreignId = known?.foreignId ?? obj.key;
    if (have.has(foreignId)) {
      already += 1;
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO sources
         (id,user_id,title,filename,origin,r2_key,stream_uid,duration_s,width,height,
          transcript_state,poster_r2_key,brief,created_at,deleted_at,
          connection_id,foreign_id,recorded_at)
       VALUES (?,?,?,?,?,?,NULL,?,NULL,NULL,'unread',?,NULL,?,NULL,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        known?.title ?? (obj.key.split("/").pop()?.replace(/\.[^.]+$/, "") || obj.key),
        obj.key.split("/").pop() ?? obj.key,
        "library",
        obj.key,
        known?.durationS ?? null,
        known?.posterKey ?? null,
        now,
        conn.id,
        foreignId,
        /* When it was SHOT. Falling back to the object's upload time is
           wrong and worse than nothing: it would order a Story by when
           somebody happened to copy files. Null is honest. */
        known?.recordedAt ?? null,
      )
      .run();
    added += 1;
  }

  await env.DB.prepare(`UPDATE connections SET last_import_at=? WHERE id=? AND user_id=?`)
    .bind(now, conn.id, userId)
    .run();

  return { added, already, truncated };
}
