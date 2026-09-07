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
