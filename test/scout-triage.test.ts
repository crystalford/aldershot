/**
 * TRIAGE: which of these thirty sources is worth reading?
 *
 * Reading costs money — thirty sources is most of a run's budget — so the
 * order they are read in decides what the run finds before the budget ends.
 * Everything here happens on metadata that came back with the search for
 * nothing, before any transcript is touched.
 *
 * And invariant 3 is easy to break in this file: "Reasons, not scores. No
 * percentage reaches a user." The number exists because something has to sort
 * thirty rows. What a person sees is the line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceCandidate } from "../src/scout-adapters.ts";
import {
  CHAT_LAG_S,
  CLUSTER_S,
  CROWD_SATURATES_AT,
  KEEP_PER_BEAT,
  WEIGHTS,
  WINDOW_LEAD_S,
  crowdFit,
  durationFit,
  originality,
  overlap,
  parseCrowdTimestamps,
  recencyFit,
  scanWindowStart,
  topPerBeat,
  triage,
  triageLine,
  viewsFit,
  type Component,
  type CrowdSignals,
} from "../src/scout-triage.ts";

let n = 0;
const src = (over: Partial<SourceCandidate> = {}): SourceCandidate => ({
  adapter: "youtube",
  externalId: "v" + String(++n).padStart(3, "0"),
  url: "https://example.test/v",
  title: "a video",
  ...over,
});

const BEHAVIOUR = "Berates live chat during streams; addresses chat as an adversary";
const subject = { id: "B1", role: "subject" as const, behaviour: BEHAVIOUR };
const crowd = (over: Partial<CrowdSignals> = {}): CrowdSignals => ({
  commentTimestamps: 0,
  clipsPointingIn: 0,
  citations: 0,
  ...over,
});

/* ── The weights ────────────────────────────────────────────────────────── */

test("the weights are the spec's, and they add to one", () => {
  /* Six components that sum to anything else makes the score incomparable
     between runs, which is the one thing it is for. */
  assert.deepEqual(WEIGHTS, {
    overlap: 0.3,
    durationFit: 0.2,
    views: 0.15,
    crowd: 0.15,
    originality: 0.1,
    recency: 0.1,
  });
  const total = (Object.keys(WEIGHTS) as Component[]).reduce((s, k) => s + WEIGHTS[k], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `the weights add to ${total}`);
});

/* ── Overlap ────────────────────────────────────────────────────────────── */

test("overlap counts the beat's words found, not the description's length", () => {
  /*
   * Measured against the BEAT's words rather than symmetrically. A long
   * description that happens to contain all of them is a good sign, and
   * dividing by its length would punish it for being long.
   */
  const short = src({ title: "berates live chat as an adversary during streams; addresses chat" });
  const padded = src({
    title: "berates live chat as an adversary during streams; addresses chat",
    description: "and then a great deal more about completely unrelated subjects at length",
  });
  assert.equal(overlap(short, BEHAVIOUR), overlap(padded, BEHAVIOUR));
  assert.equal(overlap(short, BEHAVIOUR), 1);
});

test("harvested terms count towards overlap", () => {
  /* The community's words are the words people put in titles, which is the
     whole reason they were harvested. */
  const c = src({ title: "the khan compilation" });
  assert.equal(overlap(c, BEHAVIOUR), 0);
  assert.ok(overlap(c, BEHAVIOUR, [{ term: "khan compilation", kind: "meme", sourceCount: 4 }]) > 0);
});

test("no metadata and no beat words are both zero, not a crash", () => {
  assert.equal(overlap(src({ title: "" }), BEHAVIOUR), 0);
  assert.equal(overlap(src({ title: "anything" }), ""), 0);
});

/* ── Duration fit ───────────────────────────────────────────────────────── */

test("a subject beat wants the stream it happened in, or the clip of it", () => {
  /*
   * The spec's note: "long VOD for behaviour beats". A behaviour happens in
   * the middle of three hours of streaming, and the three hours is where it
   * is. A clip is that moment with the stream cut away, which is better still.
   */
  assert.equal(durationFit(src({ kind: "clip", durationS: 45 }), "subject"), 1);
  assert.equal(durationFit(src({ kind: "vod", durationS: 4 * 3600 }), "subject"), 1);
  assert.ok(durationFit(src({ kind: "vod", durationS: 30 * 60 }), "subject") < 1);
  assert.ok(durationFit(src({ kind: "interview", durationS: 20 * 60 }), "subject") < 0.5);
});

test("a counter beat wants somebody explaining themselves", () => {
  /* "Short interview for counter beats" — an explanation or an apology is
     given deliberately, to camera, in something short. */
  assert.equal(durationFit(src({ kind: "interview", durationS: 25 * 60 }), "counter"), 1);
  assert.ok(durationFit(src({ kind: "vod", durationS: 25 * 60 }), "counter") > 0.8);
  assert.ok(durationFit(src({ kind: "vod", durationS: 4 * 3600 }), "counter") < 0.5);
  /* A compilation is the opposite of somebody explaining themselves. */
  assert.ok(durationFit(src({ kind: "compilation", durationS: 20 * 60 }), "counter") < 0.5);
});

test("an unknown duration is neither good nor bad", () => {
  /* Twitch clips and some RSS entries arrive without one. Guessing against
     them would bury a whole adapter's results. */
  assert.equal(durationFit(src({ kind: "podcast" }), "subject"), 0.5);
  assert.equal(durationFit(src({ kind: "reupload" }), "subject"), 0.5);
  /* A podcast is short by nature, so a counter beat takes it on the kind
     alone. A VOD of unknown length is the case that has to fall through to
     the neither-good-nor-bad answer — an earlier version of this test only
     used the podcast, which never reaches that line. */
  assert.equal(durationFit(src({ kind: "podcast" }), "counter"), 1);
  assert.equal(durationFit(src({ kind: "vod" }), "counter"), 0.5);
});

/* ── Views ──────────────────────────────────────────────────────────────── */

test("views are normalised within the set, because platforms disagree about popular", () => {
  /*
   * A figure that means "popular" differs by three orders of magnitude
   * between a Twitch clip and a YouTube VOD. A fixed ceiling would rank every
   * clip last whatever the clip was.
   */
  const all = [src({ views: 10 }), src({ views: 1000 }), src({ views: 100_000 })];
  assert.equal(viewsFit(all[0], all), 0);
  assert.equal(viewsFit(all[2], all), 1);
  /* Log scale: the middle of 10 and 100,000 is 1,000, not 50,005. */
  assert.ok(Math.abs(viewsFit(all[1], all) - 0.5) < 0.01);
});

test("ACCEPTANCE: a set that carries no information about views scores half, not full", () => {
  /*
   * One candidate, or ten with the same count. Returning 1 would let a
   * candidate score full marks on popularity for having been found, which is
   * 0.15 of the total handed out for nothing.
   */
  const one = [src({ views: 500 })];
  assert.equal(viewsFit(one[0], one), 0.5);

  const same = [src({ views: 7 }), src({ views: 7 }), src({ views: 7 })];
  for (const c of same) assert.equal(viewsFit(c, same), 0.5);

  /* And a set where nobody reports views at all. */
  const none = [src({}), src({})];
  assert.equal(viewsFit(none[0], none), 0.5);
});

/* ── Crowd ──────────────────────────────────────────────────────────────── */

test("the crowd saturates — ten signals is the crowd having spoken", () => {
  assert.equal(crowdFit(crowd()), 0);
  assert.equal(crowdFit(crowd({ commentTimestamps: 5 })), 0.5);
  assert.equal(crowdFit(crowd({ commentTimestamps: 10 })), 1);
  assert.equal(crowdFit(crowd({ commentTimestamps: 500 })), 1);
  /* The three kinds add: a clip, a thread and a timestamp are three people. */
  assert.equal(crowdFit(crowd({ commentTimestamps: 4, clipsPointingIn: 3, citations: 3 })), 1);
  assert.equal(CROWD_SATURATES_AT, 10);
});

test("a negative count cannot subtract from the crowd", () => {
  /* An adapter that reports -1 for "unknown" would otherwise cancel real
     signals out. */
  assert.equal(crowdFit(crowd({ commentTimestamps: 5, clipsPointingIn: -50 })), 0.5);
});

/* ── Originality ────────────────────────────────────────────────────────── */

test("the original, the reupload, and the compilation before and after tracing", () => {
  assert.equal(originality(src({ kind: "vod" })), 1);
  assert.equal(originality(src({ kind: "reupload" })), 0.4);
  assert.equal(originality(src({ kind: "compilation" })), 0.6);
  /* Traced, a compilation is paying to read the same moment again with
     somebody else's commentary over it. */
  assert.equal(originality(src({ kind: "compilation" }), true), 0.3);
  assert.equal(originality(src({ kind: "reupload" }), true), 0.4);
});

/* ── The date, either way round ─────────────────────────────────────────── */

const day = 24 * 60 * 60 * 1000;
const march = Date.parse("2026-03-14T00:00:00Z");

test("when the beat names a date, the newest video is the worst candidate", () => {
  /*
   * THE "OR" IN recency_or_date_match IS DOING THE WORK. A beat about one
   * afternoon in March wants that afternoon; ranked by recency, the newest
   * upload on the channel would come first and the afternoon in question
   * would be near the bottom.
   */
  const now = Date.parse("2026-10-17T00:00:00Z");
  const onTheDay = src({ publishedAt: march + day });
  const newest = src({ publishedAt: now - day });

  assert.equal(recencyFit(onTheDay, [march], now), 1);
  assert.ok(recencyFit(newest, [march], now) < 0.1);

  /* With no dates named, the same two swap round. */
  assert.ok(recencyFit(newest, [], now) > 0.9);
  assert.ok(recencyFit(onTheDay, [], now) < 0.5);
});

test("a date a week out is worth less than a date on the day, and a year out is nothing", () => {
  const now = Date.parse("2026-10-17T00:00:00Z");
  const week = recencyFit(src({ publishedAt: march + 7 * day }), [march], now);
  assert.ok(week > 0 && week < 1, `a week out scored ${week}`);
  assert.equal(recencyFit(src({ publishedAt: march + 300 * day }), [march], now), 0);
});

test("no publication date is neither good nor bad", () => {
  assert.equal(recencyFit(src({}), []), 0.5);
  assert.equal(recencyFit(src({}), [march]), 0.5);
});

/* ── The score ──────────────────────────────────────────────────────────── */

test("the score is the weighted sum of its six parts", () => {
  const all = [src({ views: 100 }), src({ views: 10_000 })];
  const t = triage({
    candidate: all[1],
    all,
    beat: subject,
    crowd: crowd({ commentTimestamps: 10 }),
    now: Date.now(),
  });
  let expected = 0;
  for (const k of Object.keys(WEIGHTS) as Component[]) expected += WEIGHTS[k] * t.parts[k];
  assert.ok(Math.abs(t.score - expected) < 1e-4);
  assert.equal(t.beatId, "B1");
});

test("ACCEPTANCE: a source with no readable transcript is not scored down for it", () => {
  /*
   * The spec is explicit that it is still useful — its crowd signals become
   * CROWD rows and its clips can become missions. Penalising it would hide
   * the half of YouTube we are not allowed to read, which is most of it.
   */
  const readable = src({ title: "berates live chat", transcript: "native", views: 100 });
  const unreadable = { ...readable, externalId: "v999", transcript: "none" as const };
  const all = [readable, unreadable];
  const a = triage({ candidate: readable, all, beat: subject });
  const b = triage({ candidate: unreadable, all, beat: subject });
  assert.equal(a.score, b.score);
});

/* ── Reasons, not scores ────────────────────────────────────────────────── */

test("ACCEPTANCE: the line a person sees has no number about a video in it", () => {
  /*
   * Invariant 3: "Reasons, not scores. No percentage reaches a user." Counts
   * of PEOPLE are allowed — "four places where somebody already pointed at
   * this" is a fact about the world. A score is a percentage about somebody's
   * video, and the one thing it is definitely not is a measurement of their
   * conduct.
   */
  const all = [src({ views: 10 }), src({ views: 1_000_000, title: "berates live chat", kind: "vod", durationS: 7200 })];
  const t = triage({ candidate: all[1], all, beat: subject, crowd: crowd({ commentTimestamps: 9 }) });

  assert.ok(t.line.length > 10);
  assert.ok(!/%/.test(t.line), t.line);
  assert.ok(!/\b0\.\d/.test(t.line), t.line);
  assert.ok(!/score/i.test(t.line), t.line);
  /* The number itself is still there, for sorting, and is not the line. */
  assert.ok(t.score > 0);
  assert.notEqual(String(t.score), t.line);
});

test("the strongest component speaks, because six half-reasons is not a reason", () => {
  const parts: Record<Component, number> = {
    overlap: 0.1,
    durationFit: 0.1,
    views: 0.1,
    crowd: 1,
    originality: 0.1,
    recency: 0.1,
  };
  assert.match(triageLine(src({}), parts, crowd({ commentTimestamps: 4 })), /4 places/);

  const words: Record<Component, number> = { ...parts, crowd: 0, overlap: 1 };
  assert.match(triageLine(src({}), words, crowd()), /use the words this beat is about/);
});

test("clips cut out of a VOD say so, rather than being counted as comments", () => {
  const parts: Record<Component, number> = {
    overlap: 0,
    durationFit: 0,
    views: 0,
    crowd: 1,
    originality: 0,
    recency: 0,
  };
  assert.match(triageLine(src({}), parts, crowd({ clipsPointingIn: 3 })), /3 clips cut out of this one/);
  assert.match(triageLine(src({}), parts, crowd({ clipsPointingIn: 1 })), /1 clip cut out of this one/);
});

test("nothing pointing either way is itself the reason, honestly", () => {
  const zero: Record<Component, number> = {
    overlap: 0,
    durationFit: 0,
    views: 0,
    crowd: 0,
    originality: 0,
    recency: 0,
  };
  assert.match(triageLine(src({}), zero, crowd()), /came back on the search and that is all/);
});

test("a compilation says the original has not been found yet", () => {
  const parts: Record<Component, number> = {
    overlap: 0,
    durationFit: 0,
    views: 0,
    crowd: 0,
    originality: 1,
    recency: 0,
  };
  assert.match(triageLine(src({ kind: "compilation" }), parts, crowd()), /the original has not been found/);
  assert.match(triageLine(src({ kind: "reupload" }), parts, crowd()), /the original is somewhere else/);
  assert.match(triageLine(src({ kind: "vod" }), parts, crowd()), /the original, not a reupload/);
});

/* ── Keeping the top few ────────────────────────────────────────────────── */

test("ACCEPTANCE: the top few PER BEAT, so one popular beat cannot eat the budget", () => {
  /*
   * A run with one well-documented beat would otherwise spend its whole
   * reading budget there and report the other five as gaps having read
   * nothing for them. The spec's 5-to-10 is a per-beat number for exactly
   * this.
   */
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      beatId: "B1",
      candidate: src({ externalId: "popular" + i }),
      score: 0.9 - i * 0.01,
      parts: {} as Record<Component, number>,
      line: "x",
    });
  }
  for (let i = 0; i < 3; i++) {
    rows.push({
      beatId: "C1",
      candidate: src({ externalId: "quiet" + i }),
      score: 0.2,
      parts: {} as Record<Component, number>,
      line: "x",
    });
  }
  const kept = topPerBeat(rows);
  assert.equal(kept.filter((r) => r.beatId === "B1").length, KEEP_PER_BEAT);
  assert.equal(kept.filter((r) => r.beatId === "C1").length, 3, "the quiet beat keeps all three it had");
  /* And the ones kept for B1 are the best ones. */
  assert.equal(kept.find((r) => r.beatId === "B1")!.candidate.externalId, "popular0");
});

test("the same source is not read twice for one beat, and ties are reproducible", () => {
  /*
   * A source found by the direct family and again by the crowd family arrives
   * twice. Reading it twice is paying twice. And two platforms answering in a
   * different order must not change which eight are kept, or the same run
   * gives different answers.
   */
  const dup = src({ externalId: "same" });
  const rows = [
    { beatId: "B1", candidate: dup, score: 0.5, parts: {} as Record<Component, number>, line: "a" },
    { beatId: "B1", candidate: { ...dup }, score: 0.5, parts: {} as Record<Component, number>, line: "b" },
    { beatId: "B1", candidate: src({ externalId: "bbb" }), score: 0.5, parts: {} as Record<Component, number>, line: "c" },
    { beatId: "B1", candidate: src({ externalId: "aaa" }), score: 0.5, parts: {} as Record<Component, number>, line: "d" },
  ];
  const kept = topPerBeat(rows);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map((r) => r.candidate.externalId), ["aaa", "bbb", "same"]);
  /* Shuffled in, the same three in the same order. */
  assert.deepEqual(topPerBeat([...rows].reverse()).map((r) => r.candidate.externalId), ["aaa", "bbb", "same"]);
});

test("one source can be evidence for two beats", () => {
  /*
   * A three-hour stream can hold the outburst AND the apology. Keyed on the
   * source alone, the second beat's row would be thrown away as a duplicate
   * and that beat would be read as having found nothing — a gap caused by
   * the stream being too useful. An earlier version of the test above had
   * only one beat in it, so dropping the beat from the key changed nothing.
   */
  const shared = src({ externalId: "both" });
  const kept = topPerBeat([
    { beatId: "B1", candidate: shared, score: 0.6, parts: {} as Record<Component, number>, line: "a" },
    { beatId: "C1", candidate: shared, score: 0.6, parts: {} as Record<Component, number>, line: "b" },
  ]);
  assert.deepEqual(kept.map((r) => r.beatId), ["B1", "C1"]);
});

/* ── Crowd timestamps ───────────────────────────────────────────────────── */

test("ACCEPTANCE: a timestamp past the end of the video is not a timestamp", () => {
  /*
   * "2:30:00" under a forty-minute upload is a reference to a different
   * video, a reply to another comment, or a score line. Kept, it sends a scan
   * window past the end of the transcript and the beat comes back empty.
   */
  const out = parseCrowdTimestamps(
    [{ text: "10:30 this bit" }, { text: "2:30:00 best part" }, { text: "39:59 and here" }],
    40 * 60,
  );
  assert.deepEqual(out.map((t) => t.tS), [630, 2399]);
});

test("a score line is not a timestamp", () => {
  /* "1:75" and "12:61" are not times, and "3 : 1" is a result. */
  const out = parseCrowdTimestamps([{ text: "ended 1:75" }, { text: "he went 12:61 on it" }, { text: "4:20 here" }]);
  assert.deepEqual(out.map((t) => t.tS), [260]);
});

test("ACCEPTANCE: forty people timestamping one outburst is one moment", () => {
  /*
   * Unclustered, the crowd component saturates on a single incident and the
   * board shows forty rows pointing at the same second.
   */
  const comments = Array.from({ length: 40 }, (_, i) => ({ text: `${10}:${String(30 + (i % 15)).padStart(2, "0")} this` }));
  const out = parseCrowdTimestamps(comments, 3600);
  assert.equal(out.length, 1);
  assert.equal(out[0].weight, 40);
  assert.equal(CLUSTER_S, 20);
});

test("two moments a minute apart stay two moments", () => {
  const out = parseCrowdTimestamps([{ text: "10:00" }, { text: "11:00" }, { text: "11:05" }], 3600);
  assert.deepEqual(out.map((t) => [t.tS, t.weight]), [[600, 1], [660, 2]]);
});

test("comments arrive in whatever order, and cluster by time", () => {
  /*
   * COMMENTS DO NOT ARRIVE IN TIMESTAMP ORDER. They arrive newest first, or
   * by votes. Clustering them as they arrive would make "11:05, 10:00, 11:00"
   * into three separate moments and the two at eleven minutes would never
   * meet. An earlier version of the test above fed them already sorted, so
   * deleting the sort changed nothing.
   */
  const out = parseCrowdTimestamps([{ text: "11:05" }, { text: "10:00" }, { text: "11:00" }], 3600);
  assert.deepEqual(out.map((t) => [t.tS, t.weight]), [[600, 1], [660, 2]]);
});

test("ACCEPTANCE: chat lags the moment, so the corrected time is earlier", () => {
  /*
   * A viewer types the time they NOTICED, which is after it happened — about
   * twenty seconds after. A scan window opened at the typed time starts after
   * the thing it is looking for.
   */
  const [t] = parseCrowdTimestamps([{ text: "10:00 he snapped" }], 3600);
  assert.equal(t.tS, 600);
  assert.equal(t.lagCorrectedTS, 580);
  assert.equal(CHAT_LAG_S, 20);

  /* And the window opens before that, because the provocation is what makes
     the moment legible. */
  assert.equal(scanWindowStart(t), 580 - WINDOW_LEAD_S);
  assert.ok(WINDOW_LEAD_S >= 30 && WINDOW_LEAD_S <= 60, "the spec's 30-to-60");
});

test("a timestamp in the first seconds does not correct to a negative time", () => {
  const [t] = parseCrowdTimestamps([{ text: "0:05 right at the start" }], 3600);
  assert.equal(t.lagCorrectedTS, 0);
  assert.equal(scanWindowStart(t), 0);
});

test("several timestamps in one comment all count", () => {
  /* A chapter comment is one comment and twelve timestamps, and it is the
     single most useful comment on the video. */
  const out = parseCrowdTimestamps([{ text: "0:00 intro\n5:00 the game\n30:00 the chat thing" }], 3600);
  assert.deepEqual(out.map((t) => t.tS), [0, 300, 1800]);
  /* And they keep the comment they came from, which is what the board shows
     beside the row. Asserting only that the three are EQUAL passed when all
     three were empty. */
  for (const t of out) assert.match(t.text, /0:00 intro/);
  assert.match(out[2].text, /the chat thing/);
});

test("no duration means nothing is filtered, rather than everything", () => {
  /* Twitch clips arrive without one. Filtering everything out would lose the
     adapter's crowd signals entirely. */
  const out = parseCrowdTimestamps([{ text: "2:30:00 the bit" }]);
  assert.deepEqual(out.map((t) => t.tS), [9000]);
});

test("a comment with no timestamp in it contributes nothing", () => {
  assert.deepEqual(parseCrowdTimestamps([{ text: "first" }, { text: "" }], 3600), []);
});
