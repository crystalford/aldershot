/**
 * Resumable multipart upload straight into R2.
 *
 * The product's whole premise is a 45–180 minute source, which is gigabytes.
 * A single PUT cannot carry that: it exceeds request limits, and any blip
 * means starting the whole thing again — on a 3GB file over a domestic
 * connection, that is the difference between usable and not.
 *
 * R2's multipart API gives us both halves: parts upload independently (so a
 * failure retries one 8MB part, not the file), and an interrupted upload can
 * be resumed because the uploadId and the parts already accepted are known.
 */

/**
 * 8MB. R2 requires every part except the last to be at least 5MB, and caps
 * parts at 10,000 — so 8MB supports a 78GB source while keeping a failed part
 * cheap to retry. Larger parts waste more work on each retry; smaller ones
 * risk hitting the part limit on a long 4K source.
 */
export const PART_SIZE = 8 * 1024 * 1024;

/**
 * The part size to use for a file of a given size.
 *
 * A fixed 8MB meant a 2.14GB upload was 268 round trips nose to tail. Every
 * round trip is a chance to stall, and the owner's did — so for a big file the
 * right move is fewer, larger parts.
 *
 * Targets roughly 100 parts, clamped to [8MB, 64MB]: R2 requires every part
 * except the last to be at least 5MB and allows 10,000 of them, so 64MB still
 * supports a 640GB source. The cost of a larger part is that a failed one
 * re-sends more, which is why the client scales its timeout with this rather
 * than holding a fixed one.
 *
 *   120MB → 8MB   (15 parts)
 *   1GB   → 16MB  (64 parts)
 *   2.1GB → 32MB  (67 parts)
 *   10GB  → 64MB  (157 parts)
 */
export function partSizeFor(bytes: number | undefined): number {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return PART_SIZE;
  const target = bytes / 100;
  const MB = 1024 * 1024;
  // Round up to a power-of-two multiple of 8MB so sizes stay predictable.
  for (const size of [8 * MB, 16 * MB, 32 * MB, 64 * MB]) {
    if (target <= size) return size;
  }
  return 64 * MB;
}

export interface StartedUpload {
  uploadId: string;
  key: string;
  partSize: number;
}

export async function startUpload(
  bucket: R2Bucket,
  key: string,
  contentType?: string,
  /** The client tells us how big the file is, so parts can be sized for it. */
  totalBytes?: number,
): Promise<StartedUpload> {
  const mpu = await bucket.createMultipartUpload(key, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
  return { uploadId: mpu.uploadId, key, partSize: partSizeFor(totalBytes) };
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Uploads one part. Parts are 1-indexed and may arrive in any order — the
 * client can run several in parallel, and a retry of a part that already
 * succeeded simply overwrites it.
 */
export async function uploadPart(
  bucket: R2Bucket,
  key: string,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer,
): Promise<UploadedPart> {
  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  const part = await mpu.uploadPart(partNumber, body);
  return { partNumber: part.partNumber, etag: part.etag };
}

/** Assembles the object. Parts must be passed in ascending part order. */
export async function completeUpload(
  bucket: R2Bucket,
  key: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<R2Object> {
  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  return await mpu.complete(ordered);
}

/**
 * Abandons an upload, releasing the parts R2 is holding.
 *
 * Worth being deliberate about: an abandoned multipart upload keeps billing
 * for its parts until it is aborted. This is the one place the product
 * deletes anything, and it is not user data — it is a half-arrived file that
 * never became a source.
 */
export async function abortUpload(bucket: R2Bucket, key: string, uploadId: string): Promise<void> {
  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  await mpu.abort();
}
