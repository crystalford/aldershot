import type { TriggerConfig } from "@trigger.dev/sdk/v3";

export const config: TriggerConfig = {
  project: "aldershot-video-pipeline",
  maxDuration: 900,
  dirs: ["./src/trigger"],
};
