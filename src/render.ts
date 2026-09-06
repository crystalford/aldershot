/**
 * Container binding — the ffmpeg helper that extracts + chunks audio for
 * long-video transcription (see container/render.mjs).
 */
import { Container } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8080;   // render.mjs listens here
  sleepAfter = "15m";   // stay warm across a video's chunk requests
}
