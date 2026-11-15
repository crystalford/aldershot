/**
 * WHAT THIS DEPLOY ACTUALLY SWITCHED ON.
 *
 * Printed at the end of every deploy, so the answer arrives without anybody
 * having to ask for it.
 *
 * WHY THIS EXISTS. /api/preflight is the readiness report and it is
 * owner-only, so reading it needs a session — and getting a session needs the
 * sign-in it reports on. MAIL_FROM was empty for a month, nobody could sign in
 * to aldershot.io, including the owner, and the only way to discover that was
 * to read the tail of a failed deploy's log by hand. A deploy that knows which
 * secrets it was handed should simply say so.
 *
 * IT CANNOT PRINT A VALUE. It reads names from the shared list and prints the
 * name, a state, and prose that was written before any value existed. There
 * is no code path here that interpolates an environment variable's contents,
 * and test/deploy-readout.test.ts feeds it secret-shaped values and asserts
 * none of them come out. scripts/preflight.cjs holds the same property for the
 * same reason: a script that echoes a key puts it in somebody's shell history.
 *
 * Exits 0 whatever it finds. Nothing here is a failure — a product with no
 * Stripe keys is a product that does not charge, which is a choice. Only the
 * caller decides whether an absence matters, and the deploy has already
 * succeeded by the time this runs.
 */
import caps from "./capabilities.cjs";

const { CAPABILITIES } = caps;

const GREEN = process.stdout.isTTY ? "\u001b[32m" : "";
const DIM = process.stdout.isTTY ? "\u001b[2m" : "";
const OFF = process.stdout.isTTY ? "\u001b[0m" : "";

const present = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
};

let off = 0;
const lines = [];

for (const c of CAPABILITIES) {
  const missing = c.env.filter((n) => !present(n));

  if (!missing.length) {
    lines.push(`  ${GREEN}on ${OFF} ${c.name}`);
    continue;
  }

  /*
   * TWO THINGS THAT ARE NOT "OFF" JUST BECAUSE THIS JOB CANNOT SEE THEM.
   *
   * SESSION_SECRET is written by the deploy with `wrangler secret put`, so it
   * is never in the job's environment. APP_ORIGIN is committed in
   * wrangler.jsonc's vars, so it is in the deployed config rather than here.
   * Reporting either as missing would be the readout lying about the one
   * subject it exists to be right about.
   */
  if (c.setByDeploy) {
    lines.push(`  ${DIM}—  ${c.name} — the deploy sets this itself${OFF}`);
    continue;
  }
  if (c.inConfig) {
    lines.push(`  ${DIM}—  ${c.name} — committed in wrangler.jsonc, not a secret${OFF}`);
    continue;
  }

  off += 1;
  lines.push(`  OFF ${c.name} — needs ${missing.join(" + ")}`);
  lines.push(`      ${DIM}${c.without}${OFF}`);
}

console.log("");
console.log("==> What this deploy switched on");
for (const l of lines) console.log(l);
console.log("");
console.log(
  off
    ? `  ${off} of ${CAPABILITIES.length} are off. Each line above says what that costs.`
    : `  All ${CAPABILITIES.length} are configured.`,
);
console.log("  The running deployment's own answer is /api/preflight (owner-only).");
console.log("");
