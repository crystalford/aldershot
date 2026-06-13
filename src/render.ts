/**
 * Render container binding — the ffmpeg cutter for the Transcript Editor export.
 * The Worker hands it the source bytes + EDL ranges; it returns the cut MP4.
 * See container/render.mjs for the in-container server.
 */
import { Container } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8080;       // render.mjs listens here
  sleepAfter = "5m";        // idle the instance after the burst of exports
}
