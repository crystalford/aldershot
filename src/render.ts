/**
 * Container binding — the ffmpeg helper that extracts + chunks audio for
 * long-video transcription (see container/render.mjs).
 */
import { Container } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8080;   // render.mjs listens here

  /*
   * WARMTH BUYS NOTHING HERE, and it was costing everything.
   *
   * This was "15m", to "stay warm across a video's chunk requests" — but the
   * chunk requests go the other way. Every job makes exactly ONE fetch into
   * the container (extract-full, or render) and the container pulls the source
   * from R2 itself. Nothing ever asks a given instance a second question.
   *
   * Each job takes an instance of its own — audio-<key>, render-<project>,
   * short-<clip> — so twenty videos uploaded together took twenty instances
   * and each held one of five slots for a quarter of an hour after it had
   * finished. Six of that upload failed with "Maximum number of running
   * container instances exceeded", and the cap was being held by instances
   * with nothing left to do.
   *
   * Two minutes was slack for a retry landing on the same name. Forty-five
   * seconds is enough for that and no more, because the instance is now
   * standard-4 and an awake instance bills for its whole size whether it is
   * encoding or idling — a two-minute tail on four vCPUs, twelve times over,
   * is most of a month's included compute spent on nothing.
   *
   * Shortening it is only safe because a render is POLLED now: every status
   * check is a request, and sleepAfter counts from the last one, so an encode
   * that runs for twenty minutes keeps its own instance awake the whole time.
   * The countdown starts when the finished file has been collected.
   */
  sleepAfter = "45s";
}

/**
 * THE SAME IMAGE ON A SMALLER MACHINE, FOR THE WORK THAT CANNOT USE A BIG ONE.
 *
 * A container bills per second AWAKE on three dimensions at once — vCPU,
 * memory and disk — so the question is never "is this instance big" but "does
 * the work scale with what I am paying for".
 *
 * For x264 it does, and there is a counter-intuitive consequence: measured as
 * memory per vCPU, standard-4 is the CHEAPEST tier there is —
 *
 *     lite 4.0   basic 4.0   standard-1 8.0
 *     standard-2 6.0   standard-3 4.0   standard-4 3.0
 *
 * — so an encode that really does use four cores finishes in a quarter of the
 * time and pays a quarter of the memory-seconds. Downsizing the render would
 * cost MORE. It stays where it is.
 *
 * EXTRACTING THE AUDIO IS NOT THAT WORK. `extract-full` is
 * `-vn -ac 1 -ar 16000 -codec:a libmp3lame -b:a 32k` (container/render.mjs):
 * the video is discarded, and libmp3lame is single-threaded. It uses about one
 * core no matter how many it is given, so on standard-4 three vCPUs and most
 * of twelve GiB are bought and idled — on every upload.
 *
 * standard-2 is one whole vCPU, so single-threaded work runs at exactly the
 * same wall-clock speed, with half the memory and a bit over half the disk.
 * Strictly cheaper for this job with no one waiting any longer.
 *
 * A shorter tail too: this instance is only ever asked one question, and
 * nothing polls it, so there is no long conversation to keep alive — only
 * enough slack for a queue retry landing on the same name.
 */
export class AudioContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "20s";
}
