/**
 * A D1 and R2 stand-in over real SQLite, so the destructive code can be tested
 * as it actually is.
 *
 * src/library-ops.ts holds every path that removes a row or an R2 object —
 * delete, restore, purge, closeAccount — and had no tests at all. Lifting its
 * SQL into a test the way test/reap-edits.test.ts does would work, but these
 * are functions rather than single statements: the ORDER of the writes, the
 * refusal conditions and the cascade all matter, and only running the real
 * function tests those.
 *
 * So this implements just enough of D1 (prepare/bind/run/first/all/batch, and
 * meta.changes) and R2 (head/put/delete) to run them. Deliberately thin — the
 * point is to exercise our code, not to reimplement Cloudflare.
 */

import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

class Stmt {
  /* Written out longhand rather than as parameter properties: the test runner
     uses --experimental-strip-types, which cannot compile those. */
  db: DatabaseSync;
  sql: string;
  args: unknown[];

  constructor(db: DatabaseSync, sql: string, args: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, args);
  }

  async first<T = Row>(): Promise<T | null> {
    const r = this.db.prepare(this.sql).get(...(this.args as never[]));
    return (r as T) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const out = this.db.prepare(this.sql).run(...(this.args as never[]));
    return { meta: { changes: Number(out.changes ?? 0) } };
  }
}

export function fakeD1(db: DatabaseSync) {
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    /* D1 runs a batch in order; sequential is the honest simulation. */
    batch: async (statements: Stmt[]) => {
      const out: unknown[] = [];
      for (const st of statements) out.push(await st.run());
      return out;
    },
  };
}

/** R2, as a Map. head/put/delete is the whole surface library-ops touches. */
export function fakeR2(seed: Record<string, number> = {}) {
  const objects = new Map<string, number>(Object.entries(seed));
  return {
    objects,
    async head(key: string) {
      return objects.has(key) ? { size: objects.get(key) as number } : null;
    },
    async put(key: string, body: { byteLength?: number }) {
      objects.set(key, body?.byteLength ?? 0);
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

/** The tables library-ops touches, in the shape src/schema.ts creates them. */
export function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE v2_users (id TEXT PRIMARY KEY, email TEXT, name TEXT, plan TEXT,
      is_owner INTEGER DEFAULT 0, created_at INTEGER, stripe_customer_id TEXT);
    CREATE TABLE sources (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, filename TEXT,
      origin TEXT, r2_key TEXT, proxy_r2_key TEXT, duration_s INTEGER, width INTEGER, height INTEGER,
      transcript_state TEXT, poster_r2_key TEXT, cut_title TEXT, brief TEXT, bytes INTEGER,
      created_at INTEGER, deleted_at INTEGER);
    CREATE TABLE segments (id TEXT PRIMARY KEY, source_id TEXT, idx INTEGER,
      start_ms INTEGER, end_ms INTEGER, speaker TEXT, text TEXT, words TEXT);
    CREATE TABLE v2_projects (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, kind TEXT,
      source_id TEXT, brief TEXT, has_acts INTEGER DEFAULT 0, runtime_s INTEGER,
      pct INTEGER DEFAULT 0, next_action TEXT, poster_r2_key TEXT, cuts TEXT, block_order TEXT,
      archived_at INTEGER, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
    CREATE TABLE v2_clips (id TEXT PRIMARY KEY, user_id TEXT, source_id TEXT,
      start_ms INTEGER, end_ms INTEGER, quote TEXT, why TEXT, score INTEGER, heat INTEGER,
      frame_r2_key TEXT, kept INTEGER DEFAULT 0, origin TEXT, used_count INTEGER DEFAULT 0,
      created_at INTEGER, deleted_at INTEGER);
    CREATE TABLE v2_threads (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, summary TEXT,
      clip_count INTEGER, created_at INTEGER);
    CREATE TABLE v2_clip_threads (clip_id TEXT, thread_id TEXT, confidence REAL);
    CREATE TABLE beats (id TEXT PRIMARY KEY, project_id TEXT, idx INTEGER, kind TEXT,
      act TEXT, clip_id TEXT, text TEXT, struck TEXT, dur_ms INTEGER,
      media_r2_key TEXT, recorded_at INTEGER);
    CREATE TABLE renders (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, kind TEXT,
      format TEXT, aspect TEXT, caption_style TEXT, clip_id TEXT, r2_key TEXT,
      stream_uid TEXT, duration_s INTEGER, bytes INTEGER, state TEXT, error TEXT,
      created_at INTEGER);
    CREATE TABLE passes (id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT, n INTEGER,
      instruction TEXT, result TEXT, undo TEXT, undone_at INTEGER, first_change TEXT,
      model TEXT, tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, ref_id TEXT,
      state TEXT, pct INTEGER, stage_label TEXT, queued_overnight INTEGER,
      error TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER);
    CREATE TABLE usage_events (id TEXT PRIMARY KEY, user_id TEXT, job_id TEXT,
      job_type TEXT, source_minutes REAL, cpu_ms INTEGER, gpu_ms INTEGER,
      tokens_in INTEGER, tokens_out INTEGER, bytes_stored INTEGER, bytes_delivered INTEGER,
      stream_minutes_stored REAL, stream_minutes_delivered REAL, unit_prices TEXT,
      cost_usd REAL, outcome TEXT, created_at INTEGER);
    CREATE TABLE trash (id TEXT PRIMARY KEY, user_id TEXT, entity TEXT, entity_id TEXT,
      label TEXT, payload TEXT, deleted_at INTEGER);
    CREATE TABLE uploads (source_id TEXT PRIMARY KEY, user_id TEXT, upload_id TEXT,
      part_size INTEGER, total_bytes INTEGER, filename TEXT, mode TEXT, created_at INTEGER);
    CREATE TABLE upload_parts (source_id TEXT, part_number INTEGER, etag TEXT,
      bytes INTEGER, created_at INTEGER, PRIMARY KEY (source_id, part_number));
    CREATE TABLE auth_tokens (token_hash TEXT PRIMARY KEY, email TEXT,
      expires_at INTEGER, created_at INTEGER);
  `);
}
