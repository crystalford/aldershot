/**
 * SNOWBALL: what was verified decides what to look for next.
 *
 * The step that makes a run compound instead of repeating itself. Round one
 * can only ask what the brief already knew to ask; round two can ask about the
 * phrase four verified clips share, the channel that keeps appearing, the date
 * three finds cluster on, and the compilation that has to have come from
 * somewhere.
 *
 * And it is where a run goes in circles if nobody stops it: a seed derived
 * from a find, searched, returning the same find, seeding again. That loop
 * spends a whole budget on one incident, and the thresholds in here are the
 * difference between snowballing and rolling downhill.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LedgerRow } from "../src/scout-reduce.ts";
import {
  INCIDENT_WINDOW_MS,
  MAX_SEEDS,
  MIN_SUPPORT,
  PHRASE_MIN,
  TRACE_MIN_WORDS,
  criticSeeds,
  dateSeeds,
  dropSwallowed,
  phraseSeeds,
  seedKey,
  snowball,
  topicSeeds,
  traceSeeds,
} from "../src/scout-snowball.ts";

const SUBJECT = "DarksidePhil";
let n = 0;
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "r" + ++n,
  beatId: "B1",
  verify: "verified",
  quoteExact: "I am not reading the chat tonight",
  tStartS: 10,
  tEndS: 14,
  sourceId: "s" + n,
  sourceTitle: "Stream highlights",
  sourceChannel: "Clips Channel",
  sourceKind: "vod",
  publishedAt: Date.parse("2026-03-14T00:00:00Z"),
  ...over,
});

const day = 24 * 60 * 60 * 1000;

/* ── Phrases ────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a phrase in two separate finds is how he talks; in one it is a sentence", () => {
  /*
   * One of anything is the find we already have, and seeding from it sends a
   * query after the thing it came from — which returns it, and seeds again.
   */
  const rows = [
    row({ quoteExact: "this is why I do not read chat any more" }),
    row({ quoteExact: "and that is why I do not read chat, honestly" }),
    row({ quoteExact: "a completely unrelated thing about strawberries" }),
  ];
  const seeds = phraseSeeds(rows, SUBJECT);
  const values = seeds.map((s) => s.value);

  assert.ok(values.some((v) => v.includes("read chat")), JSON.stringify(values));
  assert.ok(!values.some((v) => v.includes("strawberries")), "a phrase said once is not a pattern");
  assert.equal(MIN_SUPPORT, 2);
});

test("a phrase repeated six times inside one outburst is one outburst", () => {
  /*
   * Counted by ROW, not by occurrence — harvestVocabulary's rule for the same
   * reason. Counting occurrences would make the loudest single find look like
   * a pattern and send three searches after it.
   */
  const rows = [row({ quoteExact: "get out get out get out get out get out" })];
  assert.deepEqual(phraseSeeds(rows, SUBJECT), []);
});

test("a phrase of nothing but common words is not a phrase", () => {
  /* "i do not think" recurs in everything and finds everything. */
  const rows = [
    row({ quoteExact: "well I do not think so" }),
    row({ quoteExact: "no I do not think that is it" }),
  ];
  const values = phraseSeeds(rows, SUBJECT).map((s) => s.value);
  assert.deepEqual(values, [], JSON.stringify(values));
});

test("a phrase with one distinctive word in it survives", () => {
  const rows = [
    row({ quoteExact: "this is the gremlin thing again" }),
    row({ quoteExact: "and there is the gremlin thing" }),
  ];
  const values = phraseSeeds(rows, SUBJECT).map((s) => s.value);
  assert.ok(values.some((v) => v.includes("gremlin")), JSON.stringify(values));

  /*
   * AND NEVER A SINGLE WORD. "gremlin" on its own is a word, and a search for
   * a word returns a category. An earlier version of this test only asked
   * that the phrase CONTAIN "gremlin", which a one-word seed satisfies — so
   * dropping the two-word floor changed nothing.
   */
  for (const v of values) {
    assert.ok(v.split(" ").length >= PHRASE_MIN, `"${v}" is ${v.split(" ").length} word(s)`);
  }
  assert.equal(PHRASE_MIN, 2);
});

test("ACCEPTANCE: a phrase may not begin and end on filler", () => {
  /*
   * "the gremlin is" is not all filler — "gremlin" is the distinctive word —
   * and it is still a fragment of a sentence rather than a name for anything.
   * This is the case the all-filler test cannot reach, and the one that
   * proves the rule is about the ENDS rather than about the whole phrase.
   */
  const rows = [
    row({ quoteExact: "and the gremlin is back, obviously" }),
    row({ quoteExact: "so the gremlin is here again" }),
  ];
  const values = phraseSeeds(rows, SUBJECT).map((s) => s.value);

  /* "the gremlin is" has filler at both ends and is gone. "the gremlin" and
     "gremlin is" have filler at one end, which the rule allows on purpose:
     "the gremlin" is a thing people type and a rule strict enough to refuse
     it would refuse most of how anybody talks. */
  assert.ok(!values.includes("the gremlin is"), JSON.stringify(values));
  assert.ok(values.includes("the gremlin"), JSON.stringify(values));
  /* Filler in the MIDDLE is fine, and necessary — it is how people talk. */
  const spoken = [
    row({ quoteExact: "honestly I do not read chat, ever" }),
    row({ quoteExact: "look, I do not read chat any more" }),
  ];
  const said = phraseSeeds(spoken, SUBJECT).map((x) => x.value);
  assert.ok(said.some((v) => /do not read chat/.test(v)), JSON.stringify(said));
});

test("the longer phrase wins when the shorter is only ever inside it", () => {
  /* Keeping both spends two searches on one phrase and returns the same page. */
  const seeds = dropSwallowed([
    { kind: "phrase", value: "read the chat", support: 3, why: "", queries: ["a"] },
    { kind: "phrase", value: "read the chat tonight", support: 3, why: "", queries: ["b"] },
    { kind: "phrase", value: "something else", support: 3, why: "", queries: ["c"] },
  ]);
  assert.deepEqual(seeds.map((s) => s.value).sort(), ["read the chat tonight", "something else"]);
});

test("a shorter phrase with more support is kept, because it is a different fact", () => {
  /* Said in five finds where the longer is said in two: the short one is the
     catchphrase and the long one is one occasion. */
  const seeds = dropSwallowed([
    { kind: "phrase", value: "read the chat", support: 5, why: "", queries: ["a"] },
    { kind: "phrase", value: "read the chat tonight", support: 2, why: "", queries: ["b"] },
  ]);
  assert.equal(seeds.length, 2);
});

/* ── Critics ────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: two separate SOURCES make a critic channel, not two rows", () => {
  /*
   * Two finds in one video is one video by somebody who may never mention the
   * subject again. Two videos is a channel that covers them, and their back
   * catalogue is the highest-yield place left to look.
   */
  const oneVideoTwice = [
    row({ sourceId: "same", sourceChannel: "Critique Central" }),
    row({ sourceId: "same", sourceChannel: "Critique Central" }),
  ];
  assert.deepEqual(criticSeeds(oneVideoTwice, SUBJECT), []);

  const twoVideos = [
    row({ sourceId: "a", sourceChannel: "Critique Central" }),
    row({ sourceId: "b", sourceChannel: "Critique Central" }),
  ];
  const [seed] = criticSeeds(twoVideos, SUBJECT);
  assert.equal(seed.value, "Critique Central");
  assert.equal(seed.support, 2);
});

test("a critic query names the subject too, or it returns their whole output", () => {
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central" }),
    row({ sourceId: "b", sourceChannel: "Critique Central" }),
  ];
  for (const q of criticSeeds(rows, SUBJECT)[0].queries) {
    assert.match(q, /Critique Central/);
    assert.match(q, new RegExp(SUBJECT));
  }
});

test("a channel name differing only in case is one channel", () => {
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central" }),
    row({ sourceId: "b", sourceChannel: "critique central" }),
  ];
  assert.equal(criticSeeds(rows, SUBJECT).length, 1);
});

test("a row with no channel contributes nothing", () => {
  const rows = [row({ sourceChannel: undefined }), row({ sourceChannel: "" })];
  assert.deepEqual(criticSeeds(rows, SUBJECT), []);
});

/* ── Dates ──────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: finds clustering on a fortnight point at a stream nobody has", () => {
  /*
   * The spec's purpose for this seed is specific — to find the original VOD.
   * Three clippers reacting to one stream is three clips and one missing
   * source, so the queries ask for the stream rather than for more clips.
   */
  const base = Date.parse("2026-03-14T00:00:00Z");
  const rows = [
    row({ sourceId: "a", publishedAt: base }),
    row({ sourceId: "b", publishedAt: base + 2 * day }),
    row({ sourceId: "c", publishedAt: base + 5 * day }),
  ];
  const [seed] = dateSeeds(rows, SUBJECT);
  assert.equal(seed.kind, "date");
  assert.equal(seed.value, "2026-03-14");
  assert.equal(seed.support, 3);
  assert.ok(seed.queries.some((q) => /full stream|vod/i.test(q)), JSON.stringify(seed.queries));
  assert.match(seed.why, /there is probably a stream behind it/);
});

test("ACCEPTANCE: a cluster is measured from its first find, not its last", () => {
  /*
   * Measured from the LAST, a chain of finds thirteen days apart each joins
   * the one before and the cluster spans months — which is not an incident,
   * and the date it reports is not a day anything happened on. Measured from
   * the FIRST, a cluster can never be wider than the window.
   */
  const base = Date.parse("2026-03-01T00:00:00Z");
  const rows = [
    row({ sourceId: "a", publishedAt: base }),
    row({ sourceId: "b", publishedAt: base + 13 * day }),
    row({ sourceId: "c", publishedAt: base + 26 * day }),
  ];
  const seeds = dateSeeds(rows, SUBJECT);
  assert.equal(seeds.length, 1, JSON.stringify(seeds.map((s) => [s.value, s.support])));
  assert.equal(seeds[0].value, "2026-03-01");
  assert.equal(seeds[0].support, 2, "the third find is 26 days out and belongs to no incident");
});

test("ACCEPTANCE: the finds are sorted before they are clustered", () => {
  /*
   * Rows arrive in whatever order the workflow wrote them. Unsorted, the
   * cluster forms around whichever came back first and the date it reports is
   * that one's — so the seed names a day the incident did not happen on, and
   * the queries ask for a stream from the wrong fortnight.
   */
  const base = Date.parse("2026-03-01T00:00:00Z");
  const shuffled = [
    row({ sourceId: "c", publishedAt: base + 26 * day }),
    row({ sourceId: "a", publishedAt: base }),
    row({ sourceId: "b", publishedAt: base + 13 * day }),
  ];
  const seeds = dateSeeds(shuffled, SUBJECT);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].value, "2026-03-01", "the cluster takes the EARLIEST date in it");
});

test("finds a month apart are two incidents, or none", () => {
  const base = Date.parse("2026-03-14T00:00:00Z");
  const rows = [
    row({ sourceId: "a", publishedAt: base }),
    row({ sourceId: "b", publishedAt: base + 60 * day }),
  ];
  assert.deepEqual(dateSeeds(rows, SUBJECT), [], "two lone finds are not two incidents");
  assert.equal(INCIDENT_WINDOW_MS, 14 * day);
});

test("four clips from one uploader on one day is one uploader", () => {
  /* Counted by source: the incident it points at may not exist. */
  const base = Date.parse("2026-03-14T00:00:00Z");
  const rows = [0, 1, 2, 3].map((i) => row({ sourceId: "same", publishedAt: base + i * day }));
  assert.deepEqual(dateSeeds(rows, SUBJECT), []);
});

test("ACCEPTANCE: an undated row is left out, and does not split a real cluster", () => {
  /*
   * AND THE ORDER IT ARRIVES IN IS THE POINT. An undated row in the MIDDLE,
   * kept, becomes a cluster of its own whose date is NaN — and then the dated
   * find after it measures against NaN, fails to join, and the incident the
   * two dated finds point at disappears. An earlier version of this test put
   * the undated row last, where it does no harm either way.
   */
  const base = Date.parse("2026-03-14T00:00:00Z");
  const middle = [
    row({ sourceId: "a", publishedAt: base }),
    row({ sourceId: "undated", publishedAt: undefined }),
    row({ sourceId: "b", publishedAt: base + 2 * day }),
  ];
  const seeds = dateSeeds(middle, SUBJECT);
  assert.equal(seeds.length, 1, JSON.stringify(seeds));
  assert.equal(seeds[0].support, 2);
  assert.equal(seeds[0].value, "2026-03-14");

  /* And an undated row is never itself an incident. */
  const alone = [row({ sourceId: "x", publishedAt: undefined }), row({ sourceId: "y", publishedAt: undefined })];
  assert.deepEqual(dateSeeds(alone, SUBJECT), []);
});

/* ── Traces ─────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: one untraced compilation is a seed, because it is a hole not a pattern", () => {
  /*
   * Every other seed kind needs two. A compilation is evidence of an incident
   * and not evidence of a source: the moment happened in something, and until
   * that something is found the row is a TRACE on the board rather than a
   * citation.
   */
  const rows = [
    row({
      sourceKind: "compilation",
      sourceTitle: "The Khan Compilation",
      quoteExact: "get out of my chat and do not come back",
    }),
  ];
  const [seed] = traceSeeds(rows, SUBJECT);
  assert.equal(seed.kind, "trace");
  assert.equal(seed.support, 1);
  assert.match(seed.why, /the original has not been found/);
  /* The DISTINCTIVE words find the original; a compilation's own title is
     about the compilation. */
  assert.ok(seed.queries.some((q) => /chat/.test(q)), JSON.stringify(seed.queries));
  assert.ok(!seed.queries.some((q) => /Khan Compilation/.test(q)), JSON.stringify(seed.queries));
});

test("a compilation already traced is not chased again", () => {
  const rows = [row({ sourceKind: "compilation", originalOf: "the-original-row" })];
  assert.deepEqual(traceSeeds(rows, SUBJECT), []);
});

test("a reupload is traced too, and an ordinary VOD is not", () => {
  assert.equal(traceSeeds([row({ sourceKind: "reupload" })], SUBJECT).length, 1);
  assert.deepEqual(traceSeeds([row({ sourceKind: "vod" })], SUBJECT), []);
});

test("two finds in one compilation chase it once", () => {
  /* Two searches for the same missing original is one search twice. */
  const rows = [
    row({ sourceId: "comp", sourceKind: "compilation" }),
    row({ sourceId: "comp", sourceKind: "compilation" }),
  ];
  assert.equal(traceSeeds(rows, SUBJECT).length, 1);
});

test("a compilation whose quote cannot be searched for raises no query", () => {
  /*
   * THREE DISTINCTIVE WORDS AT LEAST. One is a word — "well" — and a search
   * for it returns the web. A seed that raises a query which cannot work is
   * worse than no seed: the board shows a search that was run and found
   * nothing, where the truth is that the quote was not searchable.
   */
  assert.deepEqual(traceSeeds([row({ sourceKind: "compilation", quoteExact: "well I do not think so" })], SUBJECT), []);
  assert.deepEqual(traceSeeds([row({ sourceKind: "compilation", quoteExact: "I do not think so" })], SUBJECT), []);
  assert.deepEqual(traceSeeds([row({ sourceKind: "compilation", quoteExact: "well, honestly" })], SUBJECT), []);
  assert.equal(TRACE_MIN_WORDS, 3);

  /* Three is enough. */
  const [seed] = traceSeeds(
    [row({ sourceKind: "compilation", quoteExact: "honestly the gremlin situation again" })],
    SUBJECT,
  );
  assert.ok(seed, "three distinctive words should be searchable");
  assert.ok(seed.queries.some((q) => /gremlin/.test(q)), JSON.stringify(seed.queries));
});

/* ── Topics ─────────────────────────────────────────────────────────────── */

test("what the behaviour keeps happening around, read off the titles", () => {
  /*
   * The spec's "games or topics that co-occur". Titles rather than quotes: a
   * title says what the stream WAS and a quote says what was said in it.
   */
  const rows = [
    row({ sourceId: "a", sourceTitle: "DarksidePhil plays Sekiro again" }),
    row({ sourceId: "b", sourceTitle: "Sekiro rage - DarksidePhil" }),
    row({ sourceId: "c", sourceTitle: "A completely different afternoon" }),
  ];
  const values = topicSeeds(rows, SUBJECT).map((s) => s.value);
  assert.ok(values.includes("sekiro"), JSON.stringify(values));
  assert.ok(!values.includes("darksidephil"), "the subject is not a topic about itself");
  assert.ok(!values.includes("afternoon"), "one source is not a pattern");
});

test("two finds in one video is one video, not a topic", () => {
  /*
   * Counted by SOURCE, like the critic and date seeds. Two finds in one stream
   * about one game says the game was on once; it does not say the behaviour
   * happens around it.
   */
  const sameVideo = [
    row({ sourceId: "same", sourceTitle: "DarksidePhil plays Sekiro" }),
    row({ sourceId: "same", sourceTitle: "DarksidePhil plays Sekiro" }),
  ];
  assert.deepEqual(topicSeeds(sameVideo, SUBJECT), []);

  const twoVideos = [
    row({ sourceId: "a", sourceTitle: "DarksidePhil plays Sekiro" }),
    row({ sourceId: "b", sourceTitle: "More Sekiro tonight" }),
  ];
  assert.ok(topicSeeds(twoVideos, SUBJECT).some((s) => s.value === "sekiro"));
});

test("a bare number and a tiny word are not topics", () => {
  const rows = [
    row({ sourceId: "a", sourceTitle: "stream 2026 ep 12" }),
    row({ sourceId: "b", sourceTitle: "stream 2026 ep 13" }),
  ];
  const values = topicSeeds(rows, SUBJECT).map((s) => s.value);
  assert.ok(!values.includes("2026"), JSON.stringify(values));
  assert.ok(!values.includes("ep"), JSON.stringify(values));
  assert.ok(values.includes("stream"));
});

/* ── Putting a round together ───────────────────────────────────────────── */

test("ACCEPTANCE: only verified rows seed", () => {
  /*
   * A paraphrase is a near-miss nobody has confirmed, and seeding from one
   * spends real searches on a phrase that may not have been said. A rejected
   * row is a quote that is not in the source — seeding from it sends the run
   * after a fabrication, verifies everything it finds against it, and records
   * the whole branch as a dead end.
   */
  const rows = [
    row({ verify: "paraphrase", quoteExact: "the gremlin thing happened again" }),
    row({ verify: "paraphrase", quoteExact: "the gremlin thing, again" }),
    row({ verify: "rejected", quoteExact: "the gremlin thing is his whole personality" }),
  ];
  const out = snowball({ rows, subject: SUBJECT });
  assert.deepEqual(out.seeds, []);
  assert.deepEqual(out.queries, []);
});

test("ACCEPTANCE: a seed raised last round is not raised again", () => {
  /*
   * THE CIRCLE. A run derives the same phrase every round, searches it, finds
   * the rows it came from, and spends the budget going nowhere. The skip is
   * recorded rather than silent, because queries_tried is what the diligence
   * log exports.
   */
  const rows = [
    row({ quoteExact: "this is the gremlin thing again" }),
    row({ quoteExact: "and there is the gremlin thing" }),
  ];
  const first = snowball({ rows, subject: SUBJECT });
  assert.ok(first.seeds.length > 0);

  const keys = first.seeds.map((s) => seedKey(s.kind, s.value));
  const second = snowball({ rows, subject: SUBJECT, alreadySeeded: keys });
  assert.deepEqual(second.seeds, []);
  assert.ok(second.skipped.length > 0);
  assert.match(second.skipped[0].why, /already seeded in an earlier round/);
});

test("a seed whose every query was already run is set aside, with the reason", () => {
  const rows = [
    row({ quoteExact: "this is the gremlin thing again" }),
    row({ quoteExact: "and there is the gremlin thing" }),
  ];
  const first = snowball({ rows, subject: SUBJECT });
  const everyQuery = first.queries.map((q) => q.query);

  const second = snowball({ rows, subject: SUBJECT, alreadyTried: everyQuery });
  assert.deepEqual(second.queries, []);
  assert.ok(second.skipped.some((s) => /every query it would raise/.test(s.why)));
});

test("a query already tried, differently punctuated, is still already tried", () => {
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central" }),
    row({ sourceId: "b", sourceChannel: "Critique Central" }),
  ];
  const out = snowball({
    rows,
    subject: SUBJECT,
    alreadyTried: ["critique central, DARKSIDEPHIL!"],
  });
  assert.ok(!out.queries.some((q) => /^Critique Central DarksidePhil$/.test(q.query)), JSON.stringify(out.queries));
});

test("a trace comes first at a support of one, because it is a hole", () => {
  /*
   * Ordering by support alone would let the cap cut it, and a board that cut
   * its traces ends up citing a compilation as a source.
   */
  const rows = [
    row({
      sourceId: "comp",
      sourceKind: "compilation",
      /* Long enough to be searchable — "get out of my chat" is two
         distinctive words and the trace rule now refuses it. */
      quoteExact: "get out of my chat, honestly, you absolute gremlin",
    }),
    ...[1, 2, 3, 4].map((i) =>
      row({ sourceId: "s" + i, sourceChannel: "Critique Central", quoteExact: "the gremlin thing again" }),
    ),
  ];
  const out = snowball({ rows, subject: SUBJECT, max: 1 });
  assert.equal(out.seeds.length, 1);
  assert.equal(out.seeds[0].kind, "trace");
  assert.ok(out.skipped.some((s) => /over the 1-seed cap/.test(s.why)));
});

test("seeds are capped, and the best-attested survive", () => {
  /* Each seed is one to three paid searches. Twenty seeds is a round nobody
     budgeted for. */
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push(row({ sourceId: "a" + i, sourceChannel: "Channel " + i, quoteExact: `the thing number ${i} happened` }));
    rows.push(row({ sourceId: "b" + i, sourceChannel: "Channel " + i, quoteExact: `and the thing number ${i}` }));
  }
  const out = snowball({ rows, subject: SUBJECT });
  assert.equal(out.seeds.length, MAX_SEEDS);
  assert.ok(out.skipped.some((s) => new RegExp(`over the ${MAX_SEEDS}-seed cap`).test(s.why)));
  /* Support never increases down the list. */
  for (let i = 1; i < out.seeds.length; i++) {
    if (out.seeds[i - 1].kind === "trace" || out.seeds[i].kind === "trace") continue;
    assert.ok(out.seeds[i - 1].support >= out.seeds[i].support, JSON.stringify(out.seeds.map((s) => s.support)));
  }
});

test("every query a round raises is tagged seed, and none repeats", () => {
  /* The family is what the diligence log groups by, and two seeds can want
     the same query. */
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central", quoteExact: "the gremlin thing again" }),
    row({ sourceId: "b", sourceChannel: "Critique Central", quoteExact: "and the gremlin thing" }),
  ];
  const out = snowball({ rows, subject: SUBJECT });
  assert.ok(out.queries.length > 0);
  for (const q of out.queries) {
    assert.equal(q.family, "seed");
    assert.ok(q.query.trim().length > 0);
  }
  assert.equal(new Set(out.queries.map((q) => q.query)).size, out.queries.length);
  /* And each query says which kind of seed asked for it, for the board. */
  assert.ok(out.queries.every((q) => q.seedKind));
});

test("no subject and no verified rows are both no seeds, not a crash", () => {
  /*
   * THE FIXTURE HAS TO BE ONE THAT WOULD OTHERWISE SEED. A single row seeds
   * nothing whatever the subject is — every kind but `trace` needs two — so
   * an earlier version of this test passed with the subject guard deleted,
   * having proved only that one row is not two.
   *
   * Without a subject every query is a bare phrase with no idea whose it is,
   * which searches the whole web for a sentence.
   */
  const wouldSeed = [
    row({ sourceId: "a", sourceChannel: "Critique Central", quoteExact: "honestly the gremlin situation again" }),
    row({ sourceId: "b", sourceChannel: "Critique Central", quoteExact: "look, the gremlin situation" }),
  ];
  assert.ok(snowball({ rows: wouldSeed, subject: SUBJECT }).seeds.length > 0, "the fixture must seed");

  assert.deepEqual(snowball({ rows: wouldSeed, subject: "" }).seeds, []);
  assert.deepEqual(snowball({ rows: wouldSeed, subject: "   " }).queries, []);
  assert.deepEqual(snowball({ rows: [], subject: SUBJECT }).seeds, []);
});

test("every seed raises one to three queries, which is the spec's own bound", () => {
  /*
   * Each query is a paid search, so a seed that raised six would make a round
   * twice the price nobody agreed to. No template produces more than three
   * today, so this is a property test rather than a trap being sprung — it is
   * what fails when a fourth is added.
   */
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central", sourceTitle: "Sekiro night", quoteExact: "honestly the gremlin situation again", publishedAt: Date.parse("2026-03-01T00:00:00Z") }),
    row({ sourceId: "b", sourceChannel: "Critique Central", sourceTitle: "More Sekiro", quoteExact: "look, the gremlin situation", publishedAt: Date.parse("2026-03-03T00:00:00Z") }),
    row({ sourceId: "c", sourceKind: "compilation", sourceTitle: "The best of it", quoteExact: "get out of my chat, honestly, you absolute gremlin" }),
  ];
  const out = snowball({ rows, subject: SUBJECT, max: 99 });
  assert.ok(out.seeds.length >= 4, `only ${out.seeds.length} kinds of seed in the fixture`);
  for (const s of out.seeds) {
    assert.ok(s.queries.length >= 1 && s.queries.length <= 3, `${s.kind} raised ${s.queries.length}`);
  }
});

test("a seed carries a line a person can read", () => {
  /* The board shows why a query was run. "seed" is not a reason. */
  const rows = [
    row({ sourceId: "a", sourceChannel: "Critique Central", quoteExact: "the gremlin thing again" }),
    row({ sourceId: "b", sourceChannel: "Critique Central", quoteExact: "and the gremlin thing" }),
  ];
  for (const s of snowball({ rows, subject: SUBJECT }).seeds) {
    assert.ok(s.why.length > 15, `${s.kind}: ${s.why}`);
    assert.ok(!/%/.test(s.why), s.why);
    assert.ok(s.support >= 1);
  }
});
