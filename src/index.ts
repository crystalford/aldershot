/**
 * Aldershot — Worker entry (v0).
 * Thin HTTP surface over the cinematic compiler. The console + Workflows
 * orchestration come in later phases; v0 just proves a shot can be made.
 */
import { Hono } from "hono";
import { runShot, narrate, type Env, type ShotSpec } from "./pipeline/compiler";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ app: "aldershot", status: "ok", phase: "v0-spine" }));

// Run a single art-directed shot through still -> clip. Body: ShotSpec.
app.post("/shot", async (c) => {
  const spec = (await c.req.json()) as ShotSpec;
  const shotId = crypto.randomUUID();
  const out = await runShot(c.env, shotId, spec);
  return c.json({ shotId, ...out });
});

// Generate voiceover for a script beat. Body: { text }.
app.post("/narrate", async (c) => {
  const { text } = (await c.req.json()) as { text: string };
  const beatId = crypto.randomUUID();
  const key = await narrate(c.env, beatId, text);
  return c.json({ beatId, key });
});

export default app;
