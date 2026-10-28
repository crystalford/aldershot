/**
 * WHERE CHROMIUM IS, which is not the same answer everywhere.
 *
 * Five scripts launched the browser with `executablePath:
 * '/opt/pw-browsers/chromium'` — the path this sandbox happens to keep it at.
 * That is right here and wrong everywhere else: on a machine where Playwright
 * installed its own browser the path does not exist, `chromium.launch()`
 * throws ENOENT, and every browser-driven check in this repo is unrunnable.
 * Which is the whole reason the gate had never run in CI.
 *
 * So: use the sandbox path when it is really there, and otherwise say nothing
 * and let Playwright find the browser it installed. No fallback chain, no
 * guessing at other locations — either the file is there or Playwright knows
 * better than we do.
 */
const { existsSync } = require("node:fs");
const { join } = require("node:path");

/** The sandbox's shared browser, and the root check-graphics reads fonts from. */
const ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";

/**
 * Launch options for `chromium.launch()`, with `executablePath` set only when
 * a browser is actually at it. `CHROME` overrides, and is NOT existence-checked
 * — somebody naming a binary explicitly should be told it is missing rather
 * than silently given a different one.
 */
function chromeOptions(extra = {}) {
  if (process.env.CHROME) return { executablePath: process.env.CHROME, ...extra };
  const shared = join(ROOT, "chromium");
  return existsSync(shared) ? { executablePath: shared, ...extra } : { ...extra };
}

module.exports = { chromeOptions, BROWSER_ROOT: ROOT };
