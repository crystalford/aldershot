/**
 * The write half of meaning search.
 *
 * searchMeaning has existed since the clip library did and has never returned
 * anything, because nothing ever wrote a vector. These hold the half that was
 * missing, and the two rules that make the halves agree.
 *
 * Both failures here are silent by construction: a vector written under the
 * wrong id, or text that quietly includes the thing the evaluation uses as a
 * query, produce a working-looking search that is subtly wrong. Nothing
 * crashes, so only a test notices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clipText, indexClips, backfillClipIndex, type IndexableClip } from "../src/embeddings.ts";

const clip = (over: Partial<IndexableClip> = {}): IndexableClip => ({
  id: "01JCLIPAAAAAAAAAAAAAAAAAAA",
  user_id: "u1",
  source_id: "s1",
  start_ms: 1000,
  end_ms: 5000,
  quote: "the first four weeks are not about strength at all",
  source_title: "Finally Back at the Gym",
  ...over,
});

/** Records what it was handed, and answers like Workers AI and Vectorize do. */
function fakeEnv(opts: { dims?: number; vectorize?: boolean } = {}) {
  const upserts: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }> = [];
  const embedded: string[] = [];
  const env = {
    AI: {
      run: async (_m: string, i: { text: string[] }) => {
        embedded.push(...i.text);
        return { data: i.text.map(() => Array(opts.dims ?? 1024).fill(0.1)) };
      },
    },
    VECTORIZE: opts.vectorize === false ? undefined : {
      upsert: async (v: typeof upserts) => { upserts.push(...v); return { count: v.length }; },
      deleteByIds: async () => ({ count: 0 }),
    },
  } as never;
  return { env, upserts, embedded };
}

test("the vector id is the clip id, because the search half looks rows up by it", async () => {
  /*
   * searchMeaning takes the ids Vectorize returns and runs them straight into
   * `WHERE c.id IN (...)`. Write vectors under any other id — a composite key,
   * a hash, a source-prefixed thing — and every search returns zero rows while
   * looking completely healthy: the index matches, the database does not, and
   * nothing anywhere errors.
   */
  const { env, upserts } = fakeEnv();
  await indexClips(env, [clip({ id: "01JABC" }), clip({ id: "01JDEF" })]);

  assert.deepEqual(upserts.map((u) => u.id), ["01JABC", "01JDEF"]);
  /* ULIDs are 26 chars; Vectorize caps ids at 64 bytes. */
  assert.ok(upserts.every((u) => Buffer.byteLength(u.id) <= 64));
});

test("user_id travels as metadata, because that is the only thing search filters on", async () => {
  const { env, upserts } = fakeEnv();
  await indexClips(env, [clip({ user_id: "u7" })]);
  assert.equal(upserts[0].metadata.user_id, "u7");
  /* Nowhere near the 10 KiB per-vector ceiling, and worth knowing it stays so. */
  assert.ok(JSON.stringify(upserts[0].metadata).length < 1024);
});

test("the embedded text does not contain the reason the clip was kept", async () => {
  /*
   * THE ONE THAT KEEPS THE MEASUREMENT HONEST.
   *
   * `why` is the model's note about a moment — "Awkward closer, good button".
   * The evaluation harness uses it as a stand-in for the query somebody would
   * have typed, which only measures anything if it is NOT in the vector. Embed
   * it and recall goes up, the pipeline looks excellent, and the number means
   * nothing at all.
   *
   * It is also wrong on its own terms: `why` is our commentary, not something
   * anybody said, so matching on it is matching on ourselves.
   */
  const text = clipText({ ...clip(), source_title: "Gym" } as IndexableClip & { why?: string });
  assert.match(text, /first four weeks/, "the quote is the substance");
  assert.match(text, /Gym/, "the source title is the cheap contextual prefix");
  assert.doesNotMatch(text, /button|closer|awkward/i);

  const { env, embedded } = fakeEnv();
  await indexClips(env, [clip()]);
  assert.equal(embedded.length, 1);
  assert.doesNotMatch(embedded[0], /awkward|good button/i);
});

test("a library with no index is a no-op, not a failure", async () => {
  /* The normal state until someone runs the create command. Clips keep being
     made; they simply are not searchable by meaning yet. */
  const { env, upserts } = fakeEnv({ vectorize: false });
  assert.equal(await indexClips(env, [clip()]), 0);
  assert.equal(upserts.length, 0);
});

test("a short embedding response writes nothing rather than mismatched vectors", async () => {
  /* If the model returns fewer vectors than texts, pairing them by index puts
     clip B's meaning on clip A's id — a silently wrong index that searches
     fine and returns the wrong moments. Better to write none. */
  const env = {
    AI: { run: async () => ({ data: [Array(1024).fill(0.1)] }) },
    VECTORIZE: { upsert: async () => { throw new Error("must not be reached"); } },
  } as never;
  assert.equal(await indexClips(env, [clip({ id: "a" }), clip({ id: "b" })]), 0);
});

test("the backfill is library-wide and oldest-first", () => {
  /*
   * Two bugs this file exists because of, both already made in this codebase.
   *
   * Scoped per user, the sweep fed it the list of users with a job in flight —
   * so a full library with nothing running was never indexed at all.
   *
   * Newest-first, a bounded backfill re-reads the same recent rows every hour
   * and never reaches the back of the library. reapUsedAudio in src/audio.ts
   * has exactly that shape.
   *
   * Read from the source, because both are properties of the query.
   */
  const src = readFileSync(join(import.meta.dirname, "..", "src", "embeddings.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function backfillClipIndex"));
  const query = body.slice(0, body.indexOf("`,"));

  assert.match(query, /ORDER BY c\.created_at ASC/, "oldest first, or the back is never reached");
  assert.doesNotMatch(query, /c\.user_id = \?/, "indexing is library-wide; whose clip it is matters on search");
  assert.match(query, /c\.embedded_at IS NULL/, "resumable, so a big library finishes over several runs");
  assert.match(query, /c\.deleted_at IS NULL/, "a binned clip must not come back as a hit");
});

test("the backfill marks nothing when the upsert wrote nothing", async () => {
  /* Marking first would lose clips permanently: embedded_at set, no vector
     written, and the query that finds work to do skips them for ever. */
  let marked = 0;
  const env = {
    VECTORIZE: { upsert: async () => { throw new Error("index unavailable"); } },
    AI: { run: async (_m: string, i: { text: string[] }) => ({ data: i.text.map(() => Array(1024).fill(0.1)) }) },
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: [clip()] }),
          run: async () => { if (/embedded_at=\?/.test(sql)) marked++; },
        }),
      }),
      batch: async (xs: unknown[]) => { marked += xs.length; return []; },
    },
  } as never;

  await backfillClipIndex(env).catch(() => {});
  assert.equal(marked, 0, "a failed write must leave the work to be retried");
});
