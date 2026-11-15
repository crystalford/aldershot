/**
 * THE WAY BACK IN SURVIVES A PHONE.
 *
 * The signed-out page had no sign-in affordance at all: the header was the
 * wordmark, three section anchors and "Start free", and every CTA pointed at
 * the same signup form. A returning visitor had nothing to look for.
 *
 * The fix is one header link, and the whole design decision is in what class
 * it does NOT have. `.nav-anchor` is `display:none` under 640px — the comment
 * beside that media query says the anchors are "what a phone needs least" and
 * that "Start free is the only thing anyone taps up here" — so giving the new
 * link that class would hide the one control a returning visitor needs most,
 * on the devices most people arrive on.
 *
 * NOTHING CAUGHT THAT. Adding the class and running the whole suite plus every
 * fidelity rule produced no failure at all, which is how this file came to
 * exist. It does not special-case `.nav-anchor`: it reads the stylesheet for
 * ANY class a max-width query hides, so the next such class is covered too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLanding, renderSignIn } from "../src/ui/pages/landing.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every class name that some max-width media query sets `display:none` on. */
function hiddenOnNarrow(html: string): Set<string> {
  const out = new Set<string>();
  for (let i = html.indexOf("@media"); i >= 0; i = html.indexOf("@media", i + 1)) {
    const open = html.indexOf("{", i);
    if (open < 0) continue;
    const head = html.slice(i, open);
    if (!/max-width/.test(head)) continue;

    /* Walk to the matching close brace rather than regexing it: a media
       block contains rules, which contain braces of their own. */
    let depth = 0;
    let end = open;
    for (; end < html.length; end++) {
      if (html[end] === "{") depth += 1;
      else if (html[end] === "}" && --depth === 0) break;
    }
    const body = html.slice(open + 1, end);

    for (const rule of body.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
      if (/display\s*:\s*none/.test(rule[2])) out.add(rule[1]);
    }
  }
  return out;
}

const landing = (google: boolean) =>
  renderLanding({ google, error: null, sentTo: null, devLink: null });

test("the stylesheet really does hide something on a phone", () => {
  /* If this is empty the test below proves nothing, so it is asserted first.
     nav-anchor is the known one; the point is that the parser finds it. */
  const hidden = hiddenOnNarrow(landing(false));
  assert.ok(hidden.size > 0, "no class is hidden at narrow widths — has the media query gone?");
  assert.ok(hidden.has("nav-anchor"), `expected nav-anchor among ${[...hidden].join(", ")}`);
});

test("the Sign in link exists and is not one of the things a phone hides", () => {
  for (const google of [false, true]) {
    const html = landing(google);
    const hidden = hiddenOnNarrow(html);

    const link = /<a([^>]*)>Sign in<\/a>/.exec(html);
    assert.ok(link, `google=${google}: there is no Sign in link on the signed-out page`);

    const classes = (/class="([^"]*)"/.exec(link[1])?.[1] ?? "").split(/\s+/).filter(Boolean);
    for (const c of classes) {
      assert.ok(
        !hidden.has(c),
        `google=${google}: the Sign in link carries "${c}", which a max-width query sets display:none — ` +
          "a returning visitor on a phone would have nothing to tap",
      );
    }
  }
});

/*
 * AND THE FORM SAYS IT TOO, because the header link only helps somebody who
 * thinks to look up there. The button reads "Start free" whenever Google is
 * unconfigured — which is how the live site is deployed — so the box itself
 * has to say it is also the way back.
 */
test("the form says the same box signs you in, in both states", () => {
  for (const google of [false, true]) {
    assert.match(
      landing(google),
      /Already have an account\? Same box/,
      `google=${google}: the form does not say it is also how you come back`,
    );
  }
});

/* ---- and it goes to a page, not down the page ---- */

/*
 * THE COMPLAINT THAT CAUSED THIS.
 *
 * "i tried clicking sign in it just takes me to down the page to signup" —
 * which it did. The link was href="#start", the signup form, under a button
 * reading "Start free". The plumbing is the same either way, which is why it
 * was built as an anchor; the person is not.
 */
test("the header's Sign in goes to a page, not to an anchor on this one", () => {
  for (const google of [false, true]) {
    const html = landing(google);
    const link = /<a([^>]*)>Sign in<\/a>/.exec(html);
    assert.ok(link, `google=${google}: no Sign in link`);
    const href = /href="([^"]*)"/.exec(link[1])?.[1];
    assert.equal(href, "/signin", `google=${google}: Sign in points at ${href}`);
  }
});

test("the sign-in page stands up in the state the live site is in", () => {
  /* google:false is production — the two Google secrets are unset. */
  const page = renderSignIn({ google: false, error: null, sentTo: null, devLink: null });
  assert.match(page, />Sign in<\/h1>/, "no heading");
  assert.match(page, /action="\/auth\/start"/, "no email form — the only way in");
  assert.match(page, /name="from" value="signin"/, "no from field, so a failure would answer on /");
  assert.ok(!/Continue with Google/.test(page), "a Google button rendered with Google unconfigured");
  assert.match(page, /No account yet\?/, "it does not say the box also makes an account");
  assert.ok(
    !/Already have an account/.test(page),
    "the sign-in page tells a signed-out visitor they might already have an account, " +
      "which is the landing's line on the wrong page",
  );
});

/*
 * THE REFUSAL LANDS WHERE IT WAS ASKED FOR.
 *
 * MAIL_FROM is unset in production, so this is the page a real person meets.
 * Before /signin existed every outcome of /auth/start redirected to "/", which
 * meant being told on the marketing page that sign-in is not switched on.
 */
test("a failure is explained on the sign-in page itself", () => {
  const nomail = renderSignIn({ google: false, error: "nomail", sentTo: null, devLink: null });
  assert.match(nomail, /email delivery isn't configured/);

  const sent = renderSignIn({ google: false, error: null, sentTo: "someone@example.com", devLink: null });
  assert.match(sent, /someone@example\.com/);
  assert.match(sent, /expires in 20 minutes/);
});

/*
 * AND THE ROUTE SENDS IT BACK HERE. Read out of src/index.ts rather than
 * asserted about a string: the five redirects used to be literal "/" and the
 * regression is one of them reverting.
 */
test("every outcome of /auth/start returns to the page it was submitted from", () => {
  const src = readFileSync(join(ROOT, "src", "index.ts"), "utf8");
  const start = src.indexOf('app.post("/auth/start"');
  const body = src.slice(start, src.indexOf("\n});", start));

  assert.match(body, /const back = String\(form\.from \?\? ""\) === "signin" \? "\/signin" : "\/"/);
  const literal = [...body.matchAll(/c\.redirect\(\s*[`"]\//g)];
  assert.equal(
    literal.length,
    0,
    `${literal.length} outcome(s) still redirect to "/" literally, so a sign-in failure ` +
      "would be explained on the marketing page",
  );
});
