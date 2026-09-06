/** Read and parse a JSON object from R2, or null if it doesn't exist. Split
 *  out of index.ts so src/embeddings.ts can read a video's transcript without
 *  a circular import between the two. */
export async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  return obj ? await obj.json<T>() : null;
}
