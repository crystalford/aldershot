/** Minimal canonical PCM WAV helpers — mono 16-bit throughout this app. */
export const SAMPLE_RATE = 16000;
export const BYTES_PER_SAMPLE = 2; // mono, 16-bit
const HEADER_SIZE = 44;

export function wavHeader(dataLength: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const buf = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buf);
  const str = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  str(36, "data");
  view.setUint32(40, dataLength, true);
  return new Uint8Array(buf);
}

/** Wrap raw PCM bytes (as extracted from the middle of a WAV file, no header) into a standalone playable/decodable WAV. */
export function wrapPcm(pcm: ArrayBuffer): ArrayBuffer {
  const header = wavHeader(pcm.byteLength);
  const out = new Uint8Array(header.length + pcm.byteLength);
  out.set(header, 0);
  out.set(new Uint8Array(pcm), header.length);
  return out.buffer;
}

/** Byte offset of a given second into a headerless-relative full WAV file (i.e. offset from file start, header included). */
export const byteOffsetForSecond = (sec: number, sampleRate = SAMPLE_RATE) =>
  HEADER_SIZE + Math.round(sec * sampleRate) * BYTES_PER_SAMPLE;

/** Duration in seconds implied by a full WAV file's total byte size. */
export const durationFromWavSize = (size: number, sampleRate = SAMPLE_RATE) =>
  Math.max(0, (size - HEADER_SIZE) / (sampleRate * BYTES_PER_SAMPLE));
