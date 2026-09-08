#!/usr/bin/env node
/**
 * THE EDITOR, DRIVEN.
 *
 * src/ui/client.ts is 4,000 lines inside one String.raw template. TypeScript
 * never sees it, no test imports it, and `node --check` cannot parse a string.
 * Three defects shipped out of that file in a single day — a dropped field on
 * a copied object, an audio element detached from the document, and a scope
 * question — and all three were found by a human driving a browser by hand.
 *
 * scripts/sweep.cjs already presses every control, but it only ever asks "did
 * anything happen": a navigation, a request, a DOM change, a toast. A control
 * that does the WRONG thing passes it, and so does a page whose heading
 * contradicts its own body. That is exactly how the Clipping page stayed
 * broken through several rounds of checks.
 *
 * So this asks about OUTCOMES. Not "did the button respond" but "is the count
 * the same number as the list", "did the runtime fall by what was promised",
 * "did undo put it back". It is the same shape as check-container.cjs: assert
 * a table of specific questions, report every failure, exit non-zero.
 *
 *   node scripts/check-editor.cjs        needs `npx wrangler dev` on 8787
 *
 * LOCAL ONLY, and not a nicety: two of these cut a real video and rely on the
 * undo path to put it back. Against a real account a failure part-way through
 * would leave somebody's edit cut. It refuses any BASE that is not loopback.
 */
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8787";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";

const bad = [];
const say = (ok, name, detail) => {
  if (ok) return console.log("    ✓ " + name);
  bad.push(detail ? name + " — " + detail : name);
  console.log("    ✗ " + name + (detail ? " — " + detail : ""));
};

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
    console.log("\n✘ editor — refusing to run against " + BASE);
    console.log("    Two of these cut a real video and undo it again. Localhost only.");
    process.exit(1);
  }

  /* A dev server is a dependency this cannot install, so it SKIPS rather than
     fails — the same rule the fidelity string check follows. A check that goes
     red for an absent server teaches people to ignore red. */
  try {
    await fetch(BASE + "/api/projects");
  } catch {
    console.log("⚠ editor — SKIPPED: no dev server at " + BASE);
    console.log("    Run `npx wrangler dev --port 8787 --enable-containers=false` and re-run.");
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const errs = [];
  page.on("pageerror", (e) => errs.push("threw: " + e.message));
  /* The editing copy and the poster are often absent in a fixture account and
     say nothing about the code; a 5xx always does. */
  page.on("response", (r) => {
    if (r.status() >= 500) errs.push(r.status() + " " + r.url().replace(BASE, ""));
  });
  /* Fonts are unreachable in the sandbox and each attempt is a ~20s tunnel
     timeout, so nothing off-BASE is allowed out. */
  await page.route("**", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

  /* An account with no transcribed video cannot answer any of this. Say so
     rather than reporting a page of failures about the fixtures. */
  await page.goto(BASE + "/api/projects", { waitUntil: "domcontentloaded" });
  let projects = [];
  try {
    projects = JSON.parse(await page.locator("body").innerText()).projects || [];
  } catch {}

  let project = null;
  for (const cand of projects.slice(0, 12)) {
    await page.goto(BASE + "/p/" + cand.id + "/cut", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => document.querySelectorAll(".w").length)) > 40) {
      project = cand;
      break;
    }
  }
  if (!project) {
    console.log("⚠ editor — SKIPPED: no transcribed project in this account to drive.");
    await browser.close();
    return;
  }
  console.log("  the editor, on " + JSON.stringify(project.title));
  await page.waitForTimeout(500);

  const $ = (fn, arg) => page.evaluate(fn, arg);

  /* ── The layout the controls were moved for ─────────────────────────── */
  say(
    await $(() => {
      const a = document.querySelector(".editor-aside");
      return !!a && a.scrollHeight <= a.clientHeight + 1;
    }),
    "the rail does not scroll",
    "it holds the player, its bar and the source link; anything else belongs in the command bar",
  );
  say(
    await $(() => {
      const bar = document.querySelector(".cmd");
      const blocks = document.querySelector("#blocks");
      return !!bar && !!blocks
        && bar.getBoundingClientRect().bottom <= blocks.getBoundingClientRect().top + 2
        && bar.getBoundingClientRect().width > 800;
    }),
    "the command bar spans the page, above the columns",
  );

  /* ── The panel answers what you type ────────────────────────────────── */
  say(await $(() => document.querySelector(".cmd-panel").hidden), "the panel is shut until you focus the field");
  await page.click(".find-q");
  say(await $(() => !document.querySelector(".cmd-panel").hidden), "focusing opens it");
  say(
    await $(() => {
      const g = document.querySelector('[data-group="clean"]');
      return !!g && !g.hidden && g.querySelectorAll("button").length === 3;
    }),
    "the three clean-ups are offered straight away",
  );
  say(
    await $(() => [...document.querySelectorAll(".pass-eg")].filter((e) => !e.hidden).length === 3),
    "three examples, not nine",
  );
  await page.click(".cmd-more");
  say(
    await $(() => [...document.querySelectorAll(".pass-eg")].filter((e) => !e.hidden).length === 9),
    "and the rest on request",
  );

  const word = await $(() => {
    const counts = new Map();
    for (const el of document.querySelectorAll(".w")) {
      const t = el.textContent.trim().toLowerCase();
      /* Fixture transcripts are synthetic tokens like "w10", so this cannot
         insist on letters — it just needs a word the find route will match. */
      if (/^[a-z0-9']{3,}$/.test(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  });
  if (!word) {
    say(false, "a searchable word in the transcript", "no token of 3+ characters in this transcript");
  } else {
    await page.fill(".find-q", word);
    await page.waitForTimeout(900);

    say(
      await $(() => {
        const g = document.querySelector('[data-group="matches"]');
        return !!g && !g.hidden && g.querySelectorAll(".find-hit").length > 0;
      }),
      "typing a word that IS in the cut lists where it is said",
    );
    /*
     * THE COUNT AND THE LIST ARE THE SAME NUMBER.
     *
     * This product has twice shipped a count that disagreed with the thing it
     * counted — "Clips · 0" over sixteen clips, and Footage and Clipping
     * disagreeing about how many shorts existed. A count you cannot trust is
     * worse than no count, and it is the one bug a "did the button do
     * something" sweep can never see.
     */
    say(
      await $(() => {
        const n = document.querySelectorAll(".find-hit").length;
        return document.querySelector(".find-count").textContent.trim() === n + " found";
      }),
      "the count in the field is the length of the list",
    );
    say(
      await $(() => {
        const c = document.querySelector(".find-cut");
        return !!c && !c.hidden && /Cut all \d+ · −\d+:\d\d/.test(c.textContent);
      }),
      "Cut all says how many and what it costs",
    );
    say(
      await $(() => {
        const a = document.querySelector(".cmd-ask");
        return !!a && !a.hidden && a.textContent.includes(document.querySelector(".find-q").value);
      }),
      "the model is offered the words you actually typed",
    );
    await page.keyboard.press("ArrowDown");
    say(
      await $(() => document.querySelectorAll('.cmd-panel [aria-selected="true"]').length === 1),
      "the arrows mark exactly one row",
    );
  }

  await page.fill(".find-q", "Keep only the strongest points");
  await page.waitForTimeout(900);
  say(
    await $(() => document.querySelector('[data-group="matches"]').hidden),
    "a sentence that matches no words shows no matches",
  );
  say(await $(() => !document.querySelector(".cmd-ask").hidden), "and still offers to ask the model");
  await page.keyboard.press("Escape");
  say(await $(() => document.querySelector(".cmd-panel").hidden), "Escape shuts the panel");

  /* ── Striking, and getting it back ──────────────────────────────────────
     The one round trip that touches data. It reads the runtime, strikes the
     first kept block, and requires the runtime to FALL by that block's own
     length — not merely to change. Then it undoes it and requires the number
     to come back exactly. */
  const before = await $(() => {
    const blk = [...document.querySelectorAll('.blk[data-struck="0"]')][0];
    return {
      runtime: document.querySelector("#cut-runtime").textContent.trim(),
      ms: blk ? Number(blk.getAttribute("data-ms")) : 0,
      id: blk ? blk.getAttribute("data-block") : null,
    };
  });
  if (!before.id) {
    say(false, "a kept block to strike", "every block in this cut is already struck");
  } else {
    await page.click('.blk[data-block="' + before.id + '"] .blk-strike');
    await page.waitForTimeout(900);
    const after = await $((id) => {
      const blk = document.querySelector('.blk[data-block="' + id + '"]');
      return {
        struck: blk && blk.getAttribute("data-struck") === "1",
        pill: blk ? blk.querySelector(".blk-strike .seg-pill").textContent.trim() : "",
        runtime: document.querySelector("#cut-runtime").textContent.trim(),
      };
    }, before.id);

    say(after.struck, "striking a block marks it struck");
    say(after.pill === "Add back", "and the control now offers the way out", "says " + JSON.stringify(after.pill));

    const secs = (t) => {
      const m = /(\d+):(\d\d)/.exec(t || "");
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const fell = secs(before.runtime) - secs(after.runtime);
    const want = Math.round(before.ms / 1000);
    say(
      Math.abs(fell - want) <= 1,
      "the runtime falls by the length of what was cut",
      "lost " + fell + "s, the block is " + want + "s",
    );

    const undo = page.locator('#toasts [role="button"]', { hasText: "Undo" }).first();
    if (await undo.count()) {
      await undo.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(900);
      say(
        (await $(() => document.querySelector("#cut-runtime").textContent.trim())) === before.runtime,
        "undo puts the runtime back exactly",
      );
      say(
        await $((id) => {
          const blk = document.querySelector('.blk[data-block="' + id + '"]');
          return !!blk && blk.getAttribute("data-struck") === "0";
        }, before.id),
        "and the block is kept again",
      );
    } else {
      say(false, "a cut offers an Undo", "no Undo in the toast — the block is still struck");
    }
  }

  /* ── Narrow ─────────────────────────────────────────────────────────── */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  say(
    await $(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    "nothing spills sideways at 390px",
  );
  say(
    await $(() => {
      const a = document.querySelector(".editor-aside");
      return !!a && a.scrollHeight <= a.clientHeight + 1;
    }),
    "the rail still does not scroll at 390px",
  );

  for (const e of [...new Set(errs)]) bad.push(e);

  await browser.close();

  if (bad.length) {
    console.log("\n✘ editor — it renders, but it does not do what it says.");
    console.log(bad.map((b) => "    " + b).join("\n"));
    process.exit(1);
  }
  console.log("✔ editor — the command bar, striking and undo all do what they claim");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
