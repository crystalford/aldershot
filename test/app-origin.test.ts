/**
 * THE ONE VAR, AND THE GATE THAT STILL HAS TO BITE.
 *
 * wrangler.jsonc said "there is deliberately no vars block here" for the whole
 * life of this repo, and the reasoning was entirely about DEV_LOGIN_EMAIL's
 * CONTENT — it disables authentication, so shipping it would make every
 * visitor the owner. The block now exists and holds APP_ORIGIN, which is
 * https://aldershot.io: printed in every login email, registered with Google
 * as a redirect URI, and not a secret in any sense. It was a repo secret,
 * which meant the owner had to set it by hand before Google sign-in could
 * work, and the deploy wrote it AFTER `wrangler deploy` — so a secret of that
 * name would land on top of the committed var with nothing detecting two
 * sources for one name.
 *
 * Adding a block beside a gate is exactly when you check the gate still
 * bites, so these tests run the DEPLOY'S OWN stripper — lifted out of the
 * workflow rather than copied, because a copy stays green while the thing it
 * describes changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The auth-bypass check, exactly as .github/workflows/deploy.yml runs it. */
function gateScript(): string {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
  const open = yml.indexOf("node -e '\n            const fs=require(\"fs\");");
  assert.ok(open >= 0, "could not find the auth-bypass check in deploy.yml");
  const close = yml.indexOf("\n          '", open);
  assert.ok(close > open, "could not find the end of the auth-bypass check");
  const body = yml.slice(yml.indexOf("\n", open) + 1, close);
  /* The YAML block is indented; node does not care, but the escaped
     backslashes inside single-quoted shell are literal, so this is the exact
     program the runner executes. */
  return body;
}

/** Runs the gate against a given wrangler.jsonc, returning its exit code. */
function gateOn(config: string): number {
  const dir = mkdtempSync(join(tmpdir(), "wrangler-"));
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), config);
    writeFileSync(join(dir, "gate.cjs"), gateScript());
    try {
      execFileSync("node", ["gate.cjs"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
      return 0;
    } catch (e) {
      return (e as { status?: number }).status ?? -1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LIVE = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");

test("the committed config passes the deploy's auth-bypass gate", () => {
  assert.equal(gateOn(LIVE), 0, "the real wrangler.jsonc would stop the deploy");
});

test("APP_ORIGIN is the committed var, and it is the real origin", () => {
  /* Read it the way the gate does, so this is the value the deploy ships. */
  const dir = mkdtempSync(join(tmpdir(), "wrangler-"));
  try {
    cpSync(join(ROOT, "wrangler.jsonc"), join(dir, "wrangler.jsonc"));
    writeFileSync(
      join(dir, "read.cjs"),
      gateScript().replace(
        'if ("DEV_LOGIN_EMAIL" in (cfg.vars||{})) process.exit(1);',
        "process.stdout.write(JSON.stringify(cfg.vars||{}));",
      ),
    );
    const vars = JSON.parse(execFileSync("node", ["read.cjs"], { cwd: dir, encoding: "utf8" }));
    assert.equal(vars.APP_ORIGIN, "https://aldershot.io");
    assert.deepEqual(Object.keys(vars), ["APP_ORIGIN"], "something else moved into vars");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * THE GATE STILL BITES. This is the test the whole file exists for: a block
 * that did not exist cannot have been tested, and the thing standing between
 * this config and a total auth bypass is one `in` check.
 */
test("DEV_LOGIN_EMAIL in the new block still stops the deploy", () => {
  const poisoned = LIVE.replace(
    '"vars": {\n    "APP_ORIGIN": "https://aldershot.io"\n  },',
    '"vars": {\n    "APP_ORIGIN": "https://aldershot.io",\n    "DEV_LOGIN_EMAIL": "someone@example.com"\n  },',
  );
  assert.notEqual(poisoned, LIVE, "the poisoning did not apply — the block's shape changed");
  assert.equal(gateOn(poisoned), 1, "a var that disables authentication would have shipped");
});

test("an unparseable config fails the deploy rather than passing it", () => {
  assert.equal(gateOn('{ "name": "aldershot", '), 2);
});

/*
 * AND NOTHING WRITES IT AS A SECRET ANY MORE, because that write happens after
 * `wrangler deploy` and would silently become the real source.
 */
test("the deploy no longer sets APP_ORIGIN as a secret", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
  assert.ok(!/put_secret APP_ORIGIN/.test(yml), "APP_ORIGIN is being written as a secret again");
  assert.ok(
    !/APP_ORIGIN:\s*\$\{\{\s*secrets\./.test(yml),
    "APP_ORIGIN is still read from the repo secrets into the job env",
  );
});
