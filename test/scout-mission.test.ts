/**
 * MISSIONS AND MATCH-BACK: a ghost becomes footage you can cut.
 *
 * Invariant 9 says Scout finds and links, so for every platform that forbids
 * a server fetching its media there is one way the footage arrives: the user
 * goes and gets it.
 *
 * THE MISSION IS NOT THE POINT — the match-back is. Anyone can ask somebody
 * to download a file. What makes it worth twenty minutes of their afternoon
 * is that when it comes back, the product finds the scouted words INSIDE it
 * and says what it found. Without that the user has moved a file and
 * re-acquired nothing: the moment is still unverified, it just LOOKS verified
 * because there is now a video sitting next to it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IndexedWord } from "../src/align.ts";
import {
  COVERAGE_MISMATCH,
  COVERAGE_VERIFIED,
  EXPIRY_WARN_MS,
  GHOST_CHOICES,
  OFFSET_TOLERANCE_S,
  acceptable,
  deepLink,
  expiryLine,
  ghostsAtRender,
  matchByTranscript,
  missionsFromCut,
  type Ghost,
} from "../src/scout-mission.ts";

const day = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-17T00:00:00Z");

const ghost = (over: Partial<Ghost> = {}): Ghost => ({
  ledgerId: "l1",
  timelineMs: 0,
  quote: "get out of my chat and do not come back",
  sourceUrl: "https://www.youtube.com/watch?v=abc12345678",
  inS: 5070,
  outS: 5078,
  why: "the clearest instance, and nobody is provoking him",
  route: "mission",
  ...over,
});

/** An upload transcribed into words, 400ms each from `fromMs`. */
function upload(text: string, fromMs = 0, stepMs = 400): IndexedWord[] {
  return text.split(/\s+/).filter(Boolean).map((w, i) => ({
    index: i,
    text: w,
    startMs: fromMs + i * stepMs,
    endMs: fromMs + i * stepMs + stepMs - 1,
  }));
}

/* ── Which finds become missions ────────────────────────────────────────── */

test("ACCEPTANCE: a mission is only for what we may not fetch ourselves", () => {
  /*
   * A podcast enclosure is fetched by the product and the user's own footage
   * is already here. Asking for either is asking somebody to do work the
   * machine has already done — and it is the fastest way to make the mission
   * list something a person stops reading.
   */
  const missions = missionsFromCut(
    [
      ghost({ ledgerId: "needs-grabbing", route: "mission" }),
      ghost({ ledgerId: "podcast", route: "feed" }),
      ghost({ ledgerId: "already-mine", route: "yours" }),
    ],
    NOW,
  );
  assert.deepEqual(missions.map((m) => m.ledgerId), ["needs-grabbing"]);
});

test("ACCEPTANCE: expiring sources come first, then the timeline", () => {
  /*
   * A Twitch VOD with four days left is the only mission on the list that can
   * stop being possible. Everything else is still there next week, so it
   * waits its turn — and within the rest, timeline order, because a person
   * doing several in a row is working through their own video.
   */
  const missions = missionsFromCut(
    [
      ghost({ ledgerId: "late-in-cut", timelineMs: 900_000 }),
      ghost({ ledgerId: "expiring", timelineMs: 600_000, expiresAt: NOW + 4 * day }),
      ghost({ ledgerId: "early-in-cut", timelineMs: 10_000 }),
      ghost({ ledgerId: "expiring-sooner", timelineMs: 800_000, expiresAt: NOW + 1 * day }),
    ],
    NOW,
  );
  assert.deepEqual(missions.map((m) => m.ledgerId), [
    "expiring-sooner",
    "expiring",
    "early-in-cut",
    "late-in-cut",
  ]);
});

test("ACCEPTANCE: an expiry a year out does not jump the queue", () => {
  /*
   * Only an expiry inside the warning window is urgent. Sorting on a far-off
   * date would reorder the whole list for nothing and put the user's last
   * beat first.
   */
  const missions = missionsFromCut(
    [
      ghost({ ledgerId: "first-in-cut", timelineMs: 1000 }),
      ghost({ ledgerId: "expires-next-year", timelineMs: 900_000, expiresAt: NOW + 365 * day }),
    ],
    NOW,
  );
  assert.deepEqual(missions.map((m) => m.ledgerId), ["first-in-cut", "expires-next-year"]);
  assert.equal(EXPIRY_WARN_MS, 30 * day);
});

test("a mission says how long the grab is", () => {
  /* The length is what the user is actually agreeing to. "Go and get this" is
     a different ask at eight seconds and at three hours. */
  const [m] = missionsFromCut([ghost({ inS: 5070.2, outS: 5078.9 })], NOW);
  assert.equal(m.lengthS, 9);
  assert.equal(m.inS, 5070.2);
  assert.equal(m.outS, 5078.9);
  assert.equal(m.quote, "get out of my chat and do not come back");
  assert.match(m.why, /nobody is provoking him/);
});

test("the expiry reads as a sentence, or says nothing at all", () => {
  assert.equal(expiryLine(undefined, NOW), null);
  assert.equal(expiryLine(NOW + 365 * day, NOW), null, "a year out is not news");
  assert.equal(expiryLine(NOW + 7 * day, NOW), "7 days left");
  assert.equal(expiryLine(NOW + 1.5 * day, NOW), "expires tomorrow");
  assert.equal(expiryLine(NOW + 3600_000, NOW), "expires today");
  assert.equal(expiryLine(NOW - day, NOW), "gone — the source has expired");
});

/* ── The deep link ──────────────────────────────────────────────────────── */

test("ACCEPTANCE: the link opens at the in-point, per platform", () => {
  /*
   * Opening it is the whole first step of a mission, and a link to the top of
   * a three-hour stream is a link to nothing. This is also the one thing
   * invariant 9 positively REQUIRES Scout to produce: it finds and it links.
   */
  assert.equal(
    deepLink("https://www.youtube.com/watch?v=abc12345678", 5070),
    "https://www.youtube.com/watch?v=abc12345678&t=5070s",
  );
  assert.equal(deepLink("https://youtu.be/abc12345678", 90), "https://youtu.be/abc12345678?t=90s");
  assert.equal(
    deepLink("https://www.twitch.tv/videos/12345", 5070),
    "https://www.twitch.tv/videos/12345?t=1h24m30s",
  );
  /* Everything else gets the media fragment, which costs nothing where it is
     not honoured. */
  assert.equal(deepLink("https://example.test/a.mp3", 120), "https://example.test/a.mp3#t=120");
});

test("nothing in a link is a media URL", () => {
  /* Invariant 9. A deep link is a page a person opens, never a file. */
  for (const url of [
    "https://www.youtube.com/watch?v=abc12345678",
    "https://www.twitch.tv/videos/12345",
  ]) {
    const link = deepLink(url, 100);
    assert.ok(!/googlevideo|ytimg|\.m3u8|ttvnw/.test(link), link);
  }
});

test("a URL we cannot parse is still a URL a person can open", () => {
  /* Returning nothing would lose the only thing the mission is for. */
  assert.equal(deepLink("not a url", 10), "not a url");
  assert.equal(deepLink("", 10), "");
});

test("a negative or fractional in-point is floored, not passed through", () => {
  assert.match(deepLink("https://www.youtube.com/watch?v=a", -5), /t=0s/);
  assert.match(deepLink("https://www.youtube.com/watch?v=a", 90.7), /t=90s/);
});

/* ── Match-back ─────────────────────────────────────────────────────────── */

const QUOTE = "get out of my chat and do not come back";

test("ACCEPTANCE: the right words in the right place are verified, with the offset named", () => {
  /*
   * The whole reason a mission is worth doing: not "thanks, attached", but
   * "the words match, 0.4 s from where the mission said".
   */
  const file = upload(`some preamble here ${QUOTE} and then he moved on`, 0);
  const m = matchByTranscript(QUOTE, file, 1.2);

  assert.equal(m.verdict, "verified");
  assert.equal(m.method, "transcript");
  assert.ok(m.coverage >= COVERAGE_VERIFIED, `${m.coverage}`);
  assert.equal(m.atS, 1.2, "three words in at 400ms each");
  assert.equal(m.offsetS, 0);
  assert.match(m.why, /the words match/);
  assert.equal(acceptable(m), true);
});

test("ACCEPTANCE: a near-miss is never silently accepted", () => {
  /*
   * The spec's one bold rule in this section. A 60% match is not a match, and
   * it is easy to accept — the user has just spent twenty minutes and the
   * kind thing is to say yes. Saying yes puts a quote on screen that is not
   * in the footage underneath it.
   */
  const file = upload("get out of my chat and never speak to me again about this");
  const m = matchByTranscript(QUOTE, file, 0);

  assert.equal(m.verdict, "partial");
  assert.ok(m.coverage < COVERAGE_VERIFIED, `${m.coverage}`);
  assert.equal(acceptable(m), false, "a partial must not make a ghost into footage");
});

test("ACCEPTANCE: a partial says WHICH words are missing", () => {
  /*
   * "92% coverage" does not tell a person whether the missing 8% is "um" or
   * the name of the person being accused. The words go on the screen beside
   * the verdict.
   */
  const file = upload("get out of my chat and do not");
  const m = matchByTranscript(QUOTE, file, 0);
  assert.equal(m.verdict, "partial");
  assert.ok(m.missing.includes("come"), JSON.stringify(m.missing));
  assert.ok(m.missing.includes("back"), JSON.stringify(m.missing));
  assert.match(m.why, /are not:/);
});

test("ACCEPTANCE: the right words in the wrong place is a partial, not a pass", () => {
  /*
   * A stream re-uploaded with a different start, or a grab from the wrong day
   * of a show that says the same thing every week. The words are there, so it
   * is not a mismatch; the TIME is not, and the in and out points we are
   * about to cut on come from that time. Accepting it puts the wrong seconds
   * on screen under the right quote.
   */
  const file = upload(`${QUOTE} and then he moved on`, 0);
  const m = matchByTranscript(QUOTE, file, 40);

  assert.ok(m.coverage >= COVERAGE_VERIFIED, "the words are all there");
  assert.equal(m.verdict, "partial", "and the verdict is still not verified");
  assert.equal(m.offsetS, -40);
  assert.match(m.why, /40 s from where the mission said/);
  assert.match(m.why, /check it is the same recording/);
  assert.equal(acceptable(m), false);
});

test("a second either way is inside tolerance", () => {
  /* The spec's "±1 s offset". A user grabbing by hand is never frame-exact,
     and refusing them for half a second would refuse every real mission. */
  const file = upload(`one two ${QUOTE}`, 0);
  const at = matchByTranscript(QUOTE, file, 0.8);
  assert.equal(at.verdict, "verified", `offset ${at.offsetS}`);
  assert.equal(OFFSET_TOLERANCE_S, 1);

  const far = matchByTranscript(QUOTE, file, 3.5);
  assert.equal(far.verdict, "partial");
});

test("ACCEPTANCE: a file of the wrong thing is a mismatch, said plainly", () => {
  const file = upload("a completely different conversation about strawberries and the weather");
  const m = matchByTranscript(QUOTE, file, 0);
  assert.equal(m.verdict, "mismatch");
  assert.equal(m.atS, null);
  assert.equal(m.offsetS, null);
  assert.ok(m.coverage < COVERAGE_MISMATCH);
  assert.match(m.why, /not in this file/);
  assert.match(m.why, /right source\?/);
  assert.equal(acceptable(m), false);
});

test("ACCEPTANCE: coverage is over the quote, not over the upload", () => {
  /*
   * A user who grabs twenty minutes around the moment has given us MORE than
   * we asked for. Scoring that down would refuse a correct file for being
   * generous, which is the most demoralising way to fail a mission.
   */
  const padding = "filler ".repeat(300);
  const file = upload(`${padding} ${QUOTE} ${padding}`, 0);
  const m = matchByTranscript(QUOTE, file, 120);
  assert.equal(m.verdict, "verified", `coverage ${m.coverage}, offset ${m.offsetS}`);
  assert.equal(m.coverage, 1);
});

test("an empty quote and an empty upload are both mismatches, not crashes", () => {
  /*
   * A silent clip, or a transcription that failed. Both arrive inside a
   * workflow item, and an exception there is a run that stops rather than a
   * row that says no.
   */
  assert.equal(matchByTranscript("", upload("anything at all"), 0).verdict, "mismatch");
  assert.match(matchByTranscript("", upload("x"), 0).why, /no quote to look for/);

  const silent = matchByTranscript(QUOTE, [], 0);
  assert.equal(silent.verdict, "mismatch");
  assert.match(silent.why, /silent, or did the transcript fail/);
});

test("punctuation and case do not fail a mission", () => {
  /* The upload is transcribed afresh by a different recogniser from the one
     that read the source. Holding it to the source's punctuation would fail
     correct grabs. */
  const file = upload("GET OUT, of my chat — and do NOT come back!");
  const m = matchByTranscript(QUOTE, file, 0);
  assert.equal(m.verdict, "verified", `coverage ${m.coverage}`);
});

test("a match with no expected in-point reports no offset, and still verifies", () => {
  /* A file dropped in without a mission attached. The words are checkable;
     where it was supposed to start is not. */
  const m = matchByTranscript(QUOTE, upload(`x y ${QUOTE}`), null);
  assert.equal(m.verdict, "verified");
  assert.equal(m.offsetS, null);
  assert.ok(m.atS !== null);
  assert.ok(!/from where the mission said/.test(m.why));
});

/* ── The last ghost ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: the video never ships with a silent hole", () => {
  /*
   * The spec's sentence. A render that quietly dropped unacquired moments
   * would produce a video missing an argument nobody was told about; one that
   * quietly held would produce a video that never renders. So every remaining
   * ghost asks, and there is no default.
   */
  const [g] = ghostsAtRender([{ ledgerId: "l1", quote: QUOTE, why: "the clearest instance" }]);
  assert.equal(g.ledgerId, "l1");
  assert.deepEqual(g.choices.map((c) => c.choice), [...GHOST_CHOICES]);
  assert.deepEqual([...GHOST_CHOICES], ["hold", "drop", "quote_card"]);

  /* Each says what it would DO, not just what it is called. */
  for (const c of g.choices) {
    assert.ok(c.label.length > 4, c.label);
    assert.ok(c.what.length > 20, c.what);
  }
});

test("the third choice is why a failed grab is not a lost point", () => {
  /*
   * "I could not get the footage" does not have to mean "I lose the
   * argument". The words are attributable even when the picture is not
   * available — and the card says so rather than implying footage exists.
   */
  const [g] = ghostsAtRender([{ ledgerId: "l1", quote: QUOTE, why: "x" }]);
  const card = g.choices.find((c) => c.choice === "quote_card")!;
  assert.match(card.what, /attributed/);
  assert.match(card.what, /no footage claimed/);

  const drop = g.choices.find((c) => c.choice === "drop")!;
  assert.match(drop.what, /re-produced without it/, "invariant 1: a cut comes back from its rules");
  assert.match(drop.what, /the rules say why/);
});

test("no ghosts is no questions", () => {
  assert.deepEqual(ghostsAtRender([]), []);
});
