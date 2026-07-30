/** Canonical R2 object layout — everything is grouped under its project. */
export const videoSourceKey = (pid: string, vid: string, ext: string) =>
  `projects/${pid}/videos/${vid}/source.${ext}`;
export const transcriptKey = (pid: string, vid: string) =>
  `projects/${pid}/videos/${vid}/transcript.json`;
export const timelineKey = (pid: string) => `projects/${pid}/timeline.json`;
export const shortsKey = (pid: string) => `projects/${pid}/shorts.json`;
export const exportKey = (pid: string, name: string) => `projects/${pid}/exports/${name}`;

/** Best-effort file extension from a filename, then content-type, else mp4. */
export function pickExt(filename: string | undefined, contentType: string | undefined): string {
  const fromName = filename?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromType = contentType?.split(";")[0].split("/")[1];
  if (fromType) return fromType.toLowerCase().replace("quicktime", "mov").replace("x-matroska", "mkv");
  return "mp4";
}
