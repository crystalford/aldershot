/**
 * THE CHECK THAT CATCHES DEAD CODE IS ITSELF A SETTING, so something has to
 * pin it.
 *
 * `noUnusedLocals` is what makes an import nothing uses, a local nothing
 * reads and a database round trip nobody wanted fail the typecheck — and
 * therefore `npm run check`, which typechecks first. Switched off, all three
 * come back silently, and no test in this repo would notice, because the
 * guarantee IS the flag.
 *
 * It went on after thirty-eight of them had accumulated: three were a
 * `getBeats` per request whose result was thrown away, and one was a whole
 * UI panel that had been superseded and was still being compiled. The
 * fidelity gate's `wired` rule proves every EXPORT is referenced and says
 * nothing about the other direction, which is the hole this fills.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("the typechecker is still told to refuse dead code", () => {
  const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../tsconfig.json"), "utf8");
  /* Read as text, not JSON.parse: the file carries comments explaining why
     the flag is on, and those are the part worth keeping. */
  assert.match(
    raw.replace(/\/\*[\s\S]*?\*\//g, ""),
    /"noUnusedLocals"\s*:\s*true/,
    "turning this off lets dead imports, dead locals and wasted reads back in silently",
  );
  assert.match(raw.replace(/\/\*[\s\S]*?\*\//g, ""), /"strict"\s*:\s*true/);
});
