/**
 * THE QUEUE PROVISIONING, WITH A STUB WRANGLER.
 *
 * Deploy runs 237 and 238 both died in about thirty seconds on a queue check
 * that listed every queue, parsed the JSON, and fell back to an empty list
 * when the parse failed — so every queue looked absent, the create was
 * attempted, and Cloudflare refused a name it already had. Two merges never
 * reached production.
 *
 * Nothing could have caught it, because the logic was ten lines of inline YAML
 * reachable only by pushing to main. It is scripts/ensure-queues.sh now, and
 * these tests drive it with a fake `npx` on PATH: there are no Cloudflare
 * credentials in CI or on a dev machine, and the shape of the bug was never
 * about the network — it was about which branch the script takes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "ensure-queues.sh");

/**
 * A fake `npx` that answers for `wrangler queues info` and `… create`.
 *
 * `info` exits 0 for any name in PRESENT. `create` exits 0, or fails with the
 * text given in CREATE_FAILS_WITH, so the taken-name path and a genuine error
 * can both be driven.
 */
function run(opts: { present?: string[]; createFails?: string; args: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), "queues-"));
  const npx = join(dir, "npx");
  writeFileSync(
    npx,
    `#!/usr/bin/env bash
# $1=wrangler $2=queues $3=info|create $4=name
if [ "$3" = "info" ]; then
  for p in ${(opts.present ?? []).map((q) => `"${q}"`).join(" ")}; do
    [ "$4" = "$p" ] && exit 0
  done
  echo "queue not found" >&2; exit 1
fi
if [ "$3" = "create" ]; then
  ${opts.createFails ? `echo "${opts.createFails}"; exit 1` : `echo "Creating queue $4"; exit 0`}
fi
exit 99
`,
  );
  chmodSync(npx, 0o755);
  try {
    const out = execFileSync("bash", [SCRIPT, ...opts.args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a queue that exists is left alone — the bug that broke two deploys", () => {
  const r = run({ present: ["aldershot-jobs", "aldershot-jobs-dlq"], args: ["aldershot-jobs", "aldershot-jobs-dlq"] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /aldershot-jobs is there/);
  assert.match(r.out, /aldershot-jobs-dlq is there/);
  assert.ok(!/creating/.test(r.out), `it tried to create an existing queue:\n${r.out}`);
});

test("a queue that is genuinely absent is created", () => {
  const r = run({ present: ["aldershot-jobs"], args: ["aldershot-jobs", "aldershot-jobs-dlq"] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /aldershot-jobs is there/);
  assert.match(r.out, /creating aldershot-jobs-dlq/);
  assert.match(r.out, /created aldershot-jobs-dlq/);
});

/*
 * THE ONE TOLERATED FAILURE, AND ONLY IT.
 *
 * If `info` says no and the API says the name is taken, the queue exists —
 * survivable, and said out loud rather than smoothed over. This is also the
 * exact error that ended runs 237 and 238, so it is the regression this file
 * exists for.
 */
test("a taken name is survived, and reported rather than hidden", () => {
  const r = run({
    present: [],
    createFails: "Queue name 'aldershot-jobs' is already taken. [code: 11009]",
    args: ["aldershot-jobs"],
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /was already there/);
  assert.match(r.out, /'info' did not see it/);
});

test("any other failure ends the deploy, with the reason", () => {
  const r = run({
    present: [],
    createFails: "You have reached the maximum number of queues for this account.",
    args: ["aldershot-jobs"],
  });
  assert.equal(r.code, 1, `a real provisioning failure did not fail:\n${r.out}`);
  assert.match(r.out, /maximum number of queues/, "the real reason was swallowed");
  assert.match(r.out, /not because it already existed/);
});

test("no arguments is a usage error, not a silent success", () => {
  const r = run({ args: [] });
  assert.equal(r.code, 2);
});
