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
const { chromeOptions } = require("./chrome.cjs");

const BASE = process.env.BASE || "http://localhost:8787";

const bad = [];
/** What went unchecked, and why — read by the exit code at the bottom. */
const SKIPS = [];
const skipped = (why) => {
  SKIPS.push(why);
  console.log("⚠ editor — SKIPPED: " + why + ".");
};

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
    skipped("no dev server at " + BASE);
    console.log("    Run `npx wrangler dev --port 8787 --enable-containers=false` and re-run.");
    return;
  }

  const browser = await chromium.launch(chromeOptions());
  /*
   * 1440, WHICH IS THE MEASURE THE DESIGN IS DRAWN AT.
   *
   * One Take is three columns — direction 400, the thing itself, the player
   * 300 — and LAYOUT.room is min(1440px,100%) because 960 cannot hold them.
   * Checking at 1280 checked a width where the player correctly folds
   * underneath, and then asserted it was beside. The narrow cases below set
   * their own viewports, which is where folding belongs.
   */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  /*
   * A project with a video of its OWN.
   *
   * Everything from here to the library section is about word-level work —
   * find, strike a phrase, undo the runtime — and none of it can be done on a
   * clip pulled from another video, whose word cuts have no source to address
   * (see src/blocks.ts). This used to filter on having words on the page,
   * which was the same thing until pulled clips gained displayWords for
   * READING: after that the picker quietly started landing on assembled edits
   * and five real assertions went red for the right reason on the wrong
   * fixture. The library case has a section of its own further down, which
   * builds its own edit rather than hoping to find one.
   */
  let project = null;
  for (const cand of projects.slice(0, 12)) {
    if (!cand.source_id) continue;
    await page.goto(BASE + "/p/" + cand.id + "/cut", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => document.querySelectorAll(".w").length)) > 40) {
      project = cand;
      break;
    }
  }
  if (!project) {
    skipped("no transcribed project in this account to drive");
    console.log("    Run `node scripts/seed-fixture.cjs` and re-run.");
    await browser.close();
    return;
  }
  console.log("  the editor, on " + JSON.stringify(project.title));
  await page.waitForTimeout(500);

  const $ = (fn, arg) => page.evaluate(fn, arg);

  /* ── The shape: THREE COLUMNS ──────────────────────────────────────────
     Direction on the left, the document in the middle, the player on the
     right. One Take's shape, and what the prototype renders.

     THIS CHECK DESCRIBED THE OLD ONE FOR WEEKS. It asserted a two-column
     editor with the video inside the assistant — the layout the room
     replaced — and it never once failed, because it needs a transcribed
     project to drive and the account it runs against had none. Four
     guarantees sat red behind a skip. Seeding one is what surfaced them,
     and the code was right every time: the player moved on purpose and
     cut.ts says so where it moved from. */
  say(
    await $(() => {
      const doc = document.querySelector(".editor-doc");
      const asst = document.querySelector(".asst");
      const player = document.querySelector(".editor-player");
      if (!doc || !asst || !player) return false;
      const d = doc.getBoundingClientRect();
      const a = asst.getBoundingClientRect();
      const p = player.getBoundingClientRect();
      /* Direction, then the document, then the player — and the document is
         the widest, because the transcript is the work. */
      return a.left < d.left && d.left < p.left && d.width > a.width;
    }),
    "direction, the transcript, and the player — in that order, widest in the middle",
  );
  say(
    await $(() => {
      const form = document.querySelector(".asst .pass-form");
      if (!form) return false;
      const r = form.getBoundingClientRect();
      /* Visible on arrival, not behind a focus or a click. THE finding this
         whole change exists for: "I don't think people would actually even
         understand what that was". */
      return r.height > 0 && r.top < window.innerHeight && form.offsetParent !== null;
    }),
    "the composer is visible without opening anything",
  );
  say(
    await $(() => {
      const top = document.querySelector(".asst-top");
      const talk = document.querySelector(".asst-talk");
      const foot = document.querySelector(".asst-foot");
      if (!top || !talk || !foot) return false;
      /*
       * Rules, then conversation, then composer — the order that makes it
       * read as a chat rather than a panel of controls.
       *
       * ASSERTED AS ORDER, NOT AS GEOMETRY. This compared bounding rects,
       * which is a proxy that holds only while all three sit in one
       * unclipped flow. The direction column is now one scroller with the
       * composer OUTSIDE it, the way the prototype has it, so a long
       * conversation's rect runs well past the composer's while being, in
       * every sense a person would mean, above it. The claim was always
       * about order; this is the claim.
       *
       * The composer's own geometry is still asserted, twice: "visible
       * without opening anything" above, and the export-bar overlap below.
       * Those are what the rect comparison was standing in for.
       */
      const before = (a, b) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (!before(top, talk) || !before(talk, foot)) return false;
      /* And the composer is not inside the scrolling part, or it scrolls
         away — which is the failure this layout exists to prevent. */
      const scroll = document.querySelector(".asst-scroll");
      return !!scroll && !scroll.contains(foot) && scroll.contains(talk);
    }),
    "rules above the conversation, conversation above the composer",
  );
  say(
    await $(() => !!document.querySelector(".editor-player #cut-video")),
    "the player is its own column",
  );
  say(
    await $(() => {
      const talk = document.querySelector(".asst-talk");
      if (!talk) return false;
      /*
       * THE CONVERSATION HAS TO HOLD A CONVERSATION.
       *
       * This used to assert that the conversation was taller than the video
       * above it, which was the right bar for a layout where the video was a
       * cropped band. The picture is its true 16:9 shape again — the owner
       * asked for that and it was not negotiable — so that comparison no
       * longer measures anything useful; passing it would just mean shrinking
       * the video to a stamp.
       *
       * A floor is the honest bar: two exchanges, each a question, what it did,
       * and the Show me / Undo beneath, which measures about 190px. One
       * exchange visible is not a conversation, and 88px — which is what a
       * full-width 16:9 video left — is not even one.
       *
       * THE VIDEO IS NOT ABOVE IT ANY MORE — it is the third column — so
       * the room is the rules above and the composer below. The floor is
       * the same because the thing being measured is the same: can you see
       * two exchanges without scrolling.
       */
      return talk.getBoundingClientRect().height >= 185;
    }),
    "the conversation has room for two exchanges",
  );
  say(
    await $(() => {
      const v = document.querySelector(".editor-player #cut-video");
      if (!v) return false;
      /*
       * THE PICTURE IS NOT CROPPED, AND NOT STRETCHED.
       *
       * This used to assert the opposite — that the poster cropped to a fixed
       * band — and the owner's verdict on seeing it was "it needs to be 16:9".
       * He was right: a video editor that shows a cropped frame is lying about
       * the footage, and the arithmetic should never have been paid for out of
       * the picture.
       *
       * object-fit:contain never crops. The box is asserted to actually match
       * the declared shape, so "contain" cannot be quietly correct while the
       * element is the wrong rectangle and the video letterboxes inside it.
       */
      const fit = getComputedStyle(v).objectFit;
      const r = v.getBoundingClientRect();
      /*
       * Against the FOOTAGE's own dimensions, not the box's own declaration.
       * Written the lazy way first — box versus its computed aspect-ratio —
       * this passed while the declared ratio was changed to 4/3, because a box
       * always matches what it says it is. videoWidth/videoHeight come from
       * the decoded file and cannot be talked into agreeing.
       */
      if (!v.videoWidth || !v.videoHeight) return "no metadata";
      const want = v.videoWidth / v.videoHeight;
      return fit === "contain" && Math.abs(r.width / r.height - want) < 0.02;
    }),
    "the picture is its own shape, neither cropped nor stretched",
  );
  say(
    await $(() => {
      const g = document.querySelector(".asst-foot");
      return !!g && g.querySelectorAll("button").length >= 4;
    }),
    "the counted quick actions sit above the composer",
    "expected three clean-ups plus Run it",
  );

  /* ── The verbs ─────────────────────────────────────────────────────────
     These are the product, not decoration: "it's like a chatbot LLM powered
     video editing system". They were removed once and had to come back, and
     "Keep only the good bits" spent a fortnight rendered and bound to
     NOTHING — its one line of handler did not follow the markup when the
     assistant became a column. A gold button doing nothing at all is most of
     why the feature "could be improved", and no check saw it: the wiring
     check reads class="literal" and these are built by a helper. */
  say(
    await $(() => {
      const foot = document.querySelector(".asst-foot");
      if (!foot) return false;
      /* A verb is type=button, deliberately: they sit outside the composer's
         form today and a default type=submit would post it the day anyone
         moves them inside. Run it is the only submit in the foot. */
      const shown = [...foot.querySelectorAll("button")].filter(
        (b) => b.offsetParent !== null && b.type === "button" && !b.classList.contains("asst-mic"),
      );
      /* Six verbs and More. Fewer means someone quietly tidied them away
         again; the whole row is the discoverability of the box below it. */
      return shown.length >= 7;
    }),
    "six verbs and More are visible without opening anything",
  );
  say(
    await $(() => {
      const rest = document.querySelector(".verb-rest");
      const more = document.querySelector(".verb-more");
      if (!rest || !more || !rest.hidden) return false;
      more.click();
      return !rest.hidden && more.offsetParent === null;
    }),
    "More opens the rest of them, and takes itself away",
  );
  say(
    await $(() => {
      /* Every verb carries the sentence it would type. The rule these are
         built on is that no button does anything the box cannot, so a verb
         with no sentence behind it is a special path and a lie. */
      const asks = [...document.querySelectorAll(".verb-ask")];
      return asks.length >= 9 && asks.every((b) => (b.getAttribute("data-ask") || "").length > 12);
    }),
    "every verb carries the sentence it would type",
  );

  /*
   * AND PRESSING ONE ACTUALLY RUNS IT.
   *
   * The failure worth a browser: markup rendered, handler absent, silence.
   * The pass itself is refused at the network so no real job is queued and no
   * real edit is cut — what is being asserted is that the click reached the
   * code at all, which is exactly what was missing.
   */
  await page.route("**/passes", (r) => r.abort());
  const pressed = await (async () => {
    const field = page.locator(".asst .pass-form [name=instruction]");
    await page.locator(".find-good").click();
    await page.waitForTimeout(300);
    return await field.inputValue();
  })();
  say(/good bits/.test(pressed), "pressing a verb puts its sentence in the composer", JSON.stringify(pressed));
  const asked = await (async () => {
    const btn = page.locator(".verb-ask").first();
    const want = await btn.getAttribute("data-ask");
    await btn.click();
    await page.waitForTimeout(300);
    const got = await page.locator(".asst .pass-form [name=instruction]").inputValue();
    return got === want;
  })();
  say(asked, "and a written verb sends exactly the sentence it shows");
  await page.unroute("**/passes");
  say(
    await $(() => {
      const f = document.querySelector(".editor-doc .find .find-q");
      const blocks = document.querySelector("#blocks");
      return !!f && !!blocks
        && f.getBoundingClientRect().bottom <= blocks.getBoundingClientRect().top + 2;
    }),
    "find is on the document, above the words it searches",
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
      await $(() => document.querySelectorAll(".find-hit").length > 0),
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
  }

  await page.fill(".find-q", "zzzznotawordzzzz");
  await page.waitForTimeout(900);
  say(
    await $(() => document.querySelectorAll(".find-hit").length === 0
      && document.querySelector(".find-cut").hidden),
    "a word that is not there offers nothing to cut",
  );
  await page.fill(".find-q", "");

  /*
   * SAYING IT INSTEAD OF TYPING IT.
   *
   * Nothing else in this market ships voice INPUT for editing — every search
   * for it returns text-to-speech. The control has to be visible next to the
   * composer, and it must not be a ninth icon: src/ui/icons.ts says outright
   * that a feature which seems to need one does not, and this draws with type
   * and the recorder's own red dot instead.
   */
  say(
    await $(() => {
      const mic = document.querySelector(".asst-mic");
      if (!mic) return false;
      return mic.offsetParent !== null && /say it/i.test(mic.textContent);
    }),
    "you can say the instruction instead of typing it",
  );
  say(
    await $(() => {
      const dot = document.querySelector(".asst-mic-dot");
      /* Hidden until it is listening — a red dot that is always on says
         something untrue about a microphone. */
      return !!dot && dot.hidden;
    }),
    "and it is not pretending to listen before you press it",
  );

  /*
   * THE EXPORT BAR IS GONE, and these two assertions with it.
   *
   * They checked that the composer never ended up underneath a sticky strip
   * across the bottom of the page — and they were right to: it had, by two
   * pixels at the top of the page, and the measurement they printed is what
   * found it. But One Take has no bottom bar at all. Its Export is in the
   * title row, which never scrolls away, and the build's is there now too.
   *
   * What they were protecting is still protected. "the composer is visible
   * without opening anything" above asserts the control is on screen, and
   * "the conversation has room for two exchanges" asserts that the column
   * above it has not been crushed to make space. Keeping a check about the
   * geometry of a bar that does not exist would be a green tick measuring
   * nothing, which is the failure this file's own header is about.
   */

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);

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

  /* ── Density: the things that made the column read as a form ─────────── */
  say(
    await $(() => {
      const seams = [...document.querySelectorAll(".seam-open")];
      if (seams.length < 2) return true;
      /* None lit until you are on a block. There used to be one between every
         pair — up to 120 identical circles down the page. */
      return seams.every((b) => getComputedStyle(b).opacity === "0");
    }),
    "no + is shown until you are on a block",
  );
  {
    const blk = await page.$('.blk[data-struck="0"]');
    if (blk) {
      await blk.click({ position: { x: 200, y: 8 } });
      await page.waitForTimeout(200);
      say(
        await $(() => document.querySelectorAll('.blk[data-here="1"]').length === 1),
        "pressing a block makes it the one you are on",
      );
      say(
        await $(() => {
          const lit = [...document.querySelectorAll(".seam-open")]
            .filter((b) => getComputedStyle(b).opacity !== "0");
          /* The seams either side of the current block, and no others. */
          return lit.length > 0 && lit.length <= 2;
        }),
        "and only the seams touching it offer a +",
      );
    }
  }
  say(
    await $(() => {
      /* The reason is clamped to one line. Unclamped it routinely ran longer
         than the quote it was explaining. */
      const w = document.querySelector(".blk-why");
      return !w || getComputedStyle(w).webkitLineClamp === "1";
    }),
    "the model's reason is one line until you ask for the rest",
  );
  say(
    await $(() => {
      /* The header used to repeat the bar's two numbers. */
      return !document.querySelector("#head-runtime") && !document.querySelector("#head-kept");
    }),
    "the runtime and kept count are shown once, not twice",
  );

  /*
   * AN EDIT MADE FROM THE WHOLE LIBRARY.
   *
   * Every edit in this product belonged to one video, and the assumption lived
   * in the route guards rather than in the machinery — a Block already carried
   * its own mediaKey and the container already downloaded one file per
   * distinct url. The failure this guards against is a cut whose blocks come
   * from several videos rendering ranges out of ONE of them: a perfectly valid
   * file of the wrong footage.
   *
   * Made and then deleted, so running the gate does not silt the account up
   * with test edits.
   */
  {
    const words = await $(() => {
      const t = [...document.querySelectorAll(".w")].map((e) => e.textContent.trim());
      return t.find((w) => /^[a-z0-9']{4,}$/i.test(w)) || null;
    });
    let madeId = null;
    try {
      const made = await page.evaluate(async (brief) => {
        const r = await fetch("/api/begin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief }),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      }, "the bits about " + (words || "this"));

      if (made.status === 422) {
        console.log("  ⚠ nothing in this library matches — the library edit is not exercised");
      } else {
        say(made.status === 200 && !!made.body.projectId, "a brief with no video makes an edit", JSON.stringify(made.body).slice(0, 120));
        madeId = made.body.projectId;
      }

      if (madeId) {
        const edl = await page.evaluate(async (id) => {
          const r = await fetch("/api/projects/" + id + "/edl");
          return { status: r.status, body: await r.json().catch(() => ({})) };
        }, madeId);
        say(edl.status === 200 && (edl.body.cuts || []).length > 0,
          "and it has something to render", "an edit with no source used to have no EDL at all");
        say((edl.body.cuts || []).every((c) => c.sourceKey),
          "every cut names the file it comes from");

        await page.goto(BASE + "/p/" + madeId + "/cut", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(700);
        say(await $(() => document.querySelectorAll(".blk").length > 0), "the editor shows its blocks");
        say(
          await $(() => !!document.querySelector("#cut-video")),
          "and a player to play them into",
          "each block carries its own file; without the element there is nothing to swap",
        );
        say(await $(() => !!document.querySelector(".asst .pass-form")), "and the assistant is there too");

        /*
         * AND IT SAYS WHAT IT DID.
         *
         * Blocks appearing from several places with no account of where they
         * came from is the review gap this product is supposed to be better at
         * than everyone else's. The assembly writes itself into the
         * conversation as the first turn.
         */
        /*
         * TWO FACTS, ASKED FOR SEPARATELY.
         *
         * This used to be one regex — /moments? from \d+ video/ — which also
         * demanded the two sit next to each other. They never have to:
         * src/assemble.ts builds the line as describe() + " · from N videos",
         * and describe() puts the runtime and the rules in between, so the
         * real sentence reads "4 of 5 moments · 0:20 · one thread at a time ·
         * from 1 video". The assertion was pinning the gap between two facts
         * rather than the facts.
         *
         * It had never run to find out. The brief is built from a word in
         * whatever project this check happened to drive, and until there was a
         * seeded fixture that word matched nothing in the library, so /api/begin
         * answered 422 and this whole block skipped with a warning.
         */
        const opening = await $(() => (document.querySelector(".asst-talk") || {}).textContent || "");
        say(/\bmoments?\b/.test(opening), "the conversation opens with what it pulled",
          "no count of moments in the first turn");
        say(/from \d+ video/.test(opening), "and from how many videos",
          "blocks from several places with no account of where they came from");
        say(
          await $(() => {
            const turn = document.querySelector(".turn");
            return !!turn && !!turn.querySelector(".turn-show") && !turn.querySelector(".turn-undo");
          }),
          "with a Show me, and no Undo — there is no earlier state to go back to",
        );
        /*
         * AND IT IS IN THE PLAYER COLUMN, not the rail.
         *
         * This looked in `.asst` because the player used to sit at the top of
         * the assistant column — src/ui/pages/cut.ts says so where it moved it
         * out: "it used to sit at the top of the assistant, which made one
         * column do two jobs". The line back to the footage went with it. The
         * assertion kept naming the rail and never ran to find out.
         */
        say(
          await $(() => /in your library/.test((document.querySelector(".editor-player") || {}).textContent || "")),
          "and the line under the player says it is made of the library rather than one video",
        );

        /*
         * SELECTING WORDS IN A PULLED CLIP SAYS SO, RATHER THAN DOING NOTHING.
         *
         * Pulled clips gained words so an assembled edit could be READ, and
         * the words came out selectable-looking and inert: highlight them,
         * press Backspace, and nothing happened — no button, no message, no
         * effect. They cannot be cut into, because the render addresses a
         * pulled clip as one whole span (src/blocks.ts).
         *
         * Silence was the bug. The chip appears and says what is true.
         */
        say(
          await $(() => {
            const w = document.querySelector(".blk[data-block^='b:'] .w");
            if (!w) return "no pulled words on screen";
            const r = document.createRange();
            r.selectNodeContents(w);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            document.dispatchEvent(new Event("selectionchange"));
            return new Promise((done) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const b = [...document.querySelectorAll("button")].find(
                    (x) => x.offsetParent !== null && /cut \d+ word|pulled clips/i.test(x.textContent),
                  );
                  sel.removeAllRanges();
                  done(!!b && /pulled clips/i.test(b.textContent) && b.disabled);
                }),
              ),
            );
          }),
          "selecting inside a pulled clip explains itself instead of going quiet",
        );
      }
    } finally {
      if (madeId) {
        await page.evaluate(
          (id) => fetch("/api/projects/" + id + "/delete", { method: "POST" }).catch(() => {}),
          madeId,
        );
      }
    }
  }

  /*
   * THE SAME EDIT, READ TWO WAYS.
   *
   * The script view is the block view restyled — the same .blk wrappers, the
   * same .w spans, the same data attributes, the same seams — because
   * paintBlock, here(), retotal and every strike, move and short branch in the
   * client key off them. A view that dropped .blk would silently lose half the
   * editor, so what is checked here is that BOTH readings still carry the
   * contract, and that the reading actually differs.
   */
  {
    await page.goto(BASE + "/p/" + project.id + "/script", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);

    const shape = await $(() => {
      const bs = [...document.querySelectorAll(".blk")];
      const words = document.querySelectorAll(".w").length;
      return {
        blocks: bs.length,
        words,
        view: document.querySelector("#blocks").getAttribute("data-view"),
        thumbs: document.querySelectorAll(".blk-play").length,
        gap: bs.length > 1
          ? Math.round(bs[1].getBoundingClientRect().top - bs[0].getBoundingClientRect().bottom)
          : 0,
        strikeButtons: document.querySelectorAll(".blk-strike .seg-pill").length,
      };
    });

    say(shape.view === "script", "the script view says which reading it is");
    say(shape.blocks > 0 && shape.words > 0, "the words are all still there", JSON.stringify(shape));
    say(
      shape.strikeButtons === shape.blocks,
      "and every line still carries its Cut control",
      "paintBlock looks it up by .blk-strike .seg-pill; without it a strike repaints nothing",
    );
    say(shape.thumbs === 0, "no frames — this is for reading, not managing");
    say(shape.gap <= 6, "the lines run together rather than sitting apart", "gap " + shape.gap + "px");

    /* The chrome is quiet until you are on a line, and by attribute rather
       than :hover, which does not exist on a touch screen. */
    const blk = await page.$('.blk[data-struck="0"]');
    if (blk) {
      await blk.click({ position: { x: 200, y: 6 } });
      await page.waitForTimeout(300);
      say(
        await $(() => {
          const cur = document.querySelector('.blk[data-here="1"]');
          const other = [...document.querySelectorAll(".blk")].find((b) => b !== cur);
          const op = (b) => (b ? getComputedStyle(b.querySelector(".blk-actions")).opacity : null);
          return !!cur && op(cur) === "1" && op(other) === "0";
        }),
        "the verbs appear on the line you are on, and nowhere else",
      );
    }

    /* And striking still works here, which is the whole point of keeping the
       dom the same — this is the block view's own assertion, on the other
       reading. */
    const was = await $(() => document.querySelector("#cut-runtime").textContent.trim());
    const target = await $(() => {
      const b = [...document.querySelectorAll('.blk[data-struck="0"]')][0];
      return b ? b.getAttribute("data-block") : null;
    });
    if (target) {
      await page.click('.blk[data-block="' + target + '"] .blk-strike');
      await page.waitForTimeout(900);
      const now = await $(() => document.querySelector("#cut-runtime").textContent.trim());
      say(now !== was, "striking a line works in the script view too", was + " -> " + now);
      const undo = page.locator('#toasts [role="button"]', { hasText: "Undo" }).first();
      if (await undo.count()) {
        await undo.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(800);
      }
    }

    await page.goto(BASE + "/p/" + project.id + "/cut", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    say(
      await $(() => document.querySelectorAll(".blk-play").length > 0
        && document.querySelector("#blocks").getAttribute("data-view") === "blocks"),
      "and the block view is untouched by any of it",
    );
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
      const asst = document.querySelector(".asst");
      const form = asst && asst.querySelector(".pass-form");
      return !!form && form.getBoundingClientRect().height > 0;
    }),
    "the composer survives a narrow window",
  );

  for (const e of [...new Set(errs)]) bad.push(e);

  await browser.close();

  if (bad.length) {
    console.log("\n✘ editor — it renders, but it does not do what it says.");
    console.log(bad.map((b) => "    " + b).join("\n"));
    process.exit(1);
  }
  console.log("✔ editor — the assistant reads as one, find finds, and striking undoes");
}

main()
  .then(() => {
    /*
     * 78 MEANS "PASSED, BUT SOMETHING WENT UNCHECKED".
     *
     * This used to return 0 on a skip, and so did the string rule in
     * check-fidelity.cjs — so `scripts/check.sh` could print ALL CHECKS
     * PASSED having rendered no HTML and driven no editor. The skip itself
     * is right (a check that goes red for an absent server teaches people
     * to ignore red); what was wrong is that the skip was invisible to the
     * one command whose exit code is supposed to be the answer.
     *
     * So: 0 means checked and fine, 1 means checked and wrong, 78 means not
     * checked. check.sh names every 78 in its summary and fails on one
     * under --strict, which is what CI runs. 78 is EX_CONFIG from sysexits,
     * which is close enough to "your environment, not your code".
     */
    if (SKIPS.length) process.exit(78);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
