/**
 * EXPAND: one behaviour becomes queries in four different languages.
 *
 * A beat says what a viewer would see. A search box wants the words people
 * actually typed. Those are rarely the same words, and the gap is most of why
 * a naive search finds the obvious clip and nothing else.
 *
 * The expensive failure here is specific. Asked for "the community's own
 * terms", a model invents plausible ones — "the meltdown compilation", "rage
 * moments" — fluent, confident, and nobody has ever typed them. Each costs
 * quota, returns nothing, and the beat then reads as a subject nobody has
 * discussed. A term two different uploaders chose is the community's; a term
 * a model produced is nobody's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceCandidate } from "../src/scout-adapters.ts";
import {
  MIN_SOURCES,
  crowdQueries,
  expandQueries,
  harvestVocabulary,
  mergeLexicon,
  parseExpansion,
  usesHarvestedTerm,
  type ExpandInput,
  type LexiconRow,
  type Term,
} from "../src/scout-expand.ts";

let n = 0;
const src = (over: Partial<SourceCandidate> = {}): SourceCandidate => ({
  adapter: "youtube",
  externalId: "v" + ++n,
  url: "https://example.test/v",
  title: "a video",
  ...over,
});

const BEHAVIOUR = "Berates live chat during streams; addresses chat as an adversary";

/* ── Harvesting ─────────────────────────────────────────────────────────── */

test("a term two different uploaders used is the community's; one uploader's is not", () => {
  /*
   * COUNTED BY DISTINCT SOURCE, NEVER BY OCCURRENCE. One uploader who repeats
   * a phrase in a title, a description and six chapter names is one person's
   * phrasing. Counting occurrences would rank the most verbose channel's
   * house style as the community's vocabulary.
   */
  const candidates = [
    src({ title: "The Khan Compilation", channel: "clipsRus" }),
    src({ title: "khan compilation reaction", channel: "otherGuy" }),
    /* No stopwords in this phrase on purpose: with one in it, the n-grams
       that begin on the stopword are dropped for a different reason and the
       distinct-source rule is not what the test would be measuring. */
    src({
      title: "signature gremlin energy",
      description: "signature gremlin energy, signature gremlin energy",
      chapters: ["signature gremlin energy", "signature gremlin energy"],
      channel: "oneUploader",
    }),
  ];
  const terms = harvestVocabulary(candidates, BEHAVIOUR);
  const found = terms.map((t) => t.term);

  assert.ok(found.includes("khan compilation"), JSON.stringify(found));
  assert.ok(!found.includes("signature gremlin energy"), "one uploader saying it six times is still one uploader");
  assert.ok(!found.includes("gremlin energy"), "nor any part of it");
  assert.equal(terms.find((t) => t.term === "khan compilation")!.sourceCount, 2);
  assert.equal(MIN_SOURCES, 2);
});

test("the beat's own words are not vocabulary", () => {
  /* A vocab query that restates the behaviour is a direct query spending
     quota under a second name. */
  const candidates = [
    src({ title: "berates live chat" }),
    src({ title: "berates live chat again" }),
    src({ title: "the chat gremlin strikes" }),
    src({ title: "chat gremlin returns" }),
  ];
  const found = harvestVocabulary(candidates, BEHAVIOUR).map((t) => t.term);
  assert.ok(!found.includes("berates live chat"));
  assert.ok(found.includes("chat gremlin"), JSON.stringify(found));
});

test("a phrase never starts or ends on a stopword, and may contain one", () => {
  /*
   * A fragment beginning "and the" is a piece of a sentence, not a name for
   * something. But "best of the worst" is a title, and a stopword list that
   * refused it would remove the single most useful phrase in the crowd
   * family.
   */
  const candidates = [
    src({ title: "Best of the Worst moments and the rest" }),
    src({ title: "best of the worst 2026 and the rest" }),
  ];
  const found = harvestVocabulary(candidates, BEHAVIOUR).map((t) => t.term);
  assert.ok(found.includes("best of the worst"), JSON.stringify(found));
  assert.ok(!found.some((t) => t.startsWith("and ")), JSON.stringify(found));
  assert.ok(!found.some((t) => t.endsWith(" and")), JSON.stringify(found));
  assert.ok(!found.some((t) => t.endsWith(" the")), JSON.stringify(found));
});

test("an n-gram does not cross a full stop", () => {
  /* Two halves of two different thoughts joined by punctuation is not a
     phrase anybody said. */
  const candidates = [
    src({ title: "chat drama", description: "He lost it. Totally normal stream otherwise." }),
    src({ title: "chat drama two", description: "He lost it. Totally normal stream otherwise." }),
  ];
  const found = harvestVocabulary(candidates, BEHAVIOUR).map((t) => t.term);
  assert.ok(!found.some((t) => t.includes("it totally")), JSON.stringify(found));
  assert.ok(found.includes("chat drama"));
});

test("a channel that keeps turning up is a place to search, not a phrase", () => {
  const candidates = [
    src({ title: "one", channel: "DSPGaming Critiques" }),
    src({ title: "two", channel: "DSPGaming Critiques" }),
    src({ title: "three", channel: "SomeoneElse" }),
  ];
  const terms = harvestVocabulary(candidates, BEHAVIOUR);
  const critic = terms.find((t) => t.term === "dspgaming critiques");
  assert.ok(critic, JSON.stringify(terms.map((t) => t.term)));
  assert.equal(critic.kind, "critic_channel");
  assert.ok(!terms.some((t) => t.term === "someoneelse"), "one video is not a pattern");
});

test("the longer phrase wins when the shorter is only ever inside it", () => {
  /* "the khan compilation" and "khan compilation" are one phrase said once.
     Keeping both doubles the queries and finds the same page twice. */
  const candidates = [
    src({ title: "watching The Khan Compilation" }),
    src({ title: "reacting to The Khan Compilation" }),
  ];
  const found = harvestVocabulary(candidates, BEHAVIOUR).map((t) => t.term);
  assert.ok(found.includes("khan compilation"));
  assert.ok(!found.includes("khan"), JSON.stringify(found));
});

test("a bare number is not a term", () => {
  const candidates = [src({ title: "stream 2026 highlights" }), src({ title: "2026 stream review" })];
  const found = harvestVocabulary(candidates, BEHAVIOUR).map((t) => t.term);
  assert.ok(!found.includes("2026"), JSON.stringify(found));
});

test("what was already known is carried in and kept", () => {
  /* The lexicon persists across projects, so a term learned last month is
     available to this round even if nothing this round repeated it. */
  const known: Term[] = [{ term: "the khan incident", kind: "meme", sourceCount: 9 }];
  const found = harvestVocabulary([src({ title: "nothing useful" })], BEHAVIOUR, { known });
  assert.deepEqual(found, known);
});

/* ── The lexicon ────────────────────────────────────────────────────────── */

test("counts add across runs and first_seen never moves", () => {
  /*
   * A term seen by two sources in each of three runs is better attested than
   * one seen by two sources once. first_seen stays put so a term that stopped
   * being used can be aged out rather than searched forever.
   */
  const monday = Date.parse("2026-10-12T00:00:00Z");
  const friday = Date.parse("2026-10-16T00:00:00Z");

  const first = mergeLexicon([], "dsp", [{ term: "khan compilation", kind: "meme", sourceCount: 2 }], monday);
  assert.equal(first[0].sourceCount, 2);
  assert.equal(first[0].firstSeen, monday);

  const second = mergeLexicon(first, "dsp", [{ term: "khan compilation", kind: "meme", sourceCount: 3 }], friday);
  assert.equal(second[0].sourceCount, 5);
  assert.equal(second[0].firstSeen, monday, "first_seen is a fact about the past");
  assert.equal(second[0].lastSeen, friday);
});

test("another entity's terms are left alone", () => {
  /* The lexicon is per entity. Merging one subject's nicknames into another's
     would send a run after the wrong person's community. */
  const rows: LexiconRow[] = [
    { entity: "someone else", term: "their phrase", kind: "meme", sourceCount: 4, firstSeen: 1, lastSeen: 1 },
  ];
  const out = mergeLexicon(rows, "dsp", [{ term: "khan compilation", kind: "meme", sourceCount: 2 }], 2);
  assert.deepEqual(out.map((r) => r.term), ["khan compilation"]);
  assert.equal(out.length, 1, "the other entity's row is not returned as this entity's");
});

test("a term recognised later as a channel becomes a channel", () => {
  const rows = mergeLexicon([], "dsp", [{ term: "clipsrus", kind: "catchphrase", sourceCount: 2 }], 1);
  const after = mergeLexicon(rows, "dsp", [{ term: "clipsrus", kind: "critic_channel", sourceCount: 3 }], 2);
  assert.equal(after[0].kind, "critic_channel");
});

/* ── The crowd family ───────────────────────────────────────────────────── */

test("the crowd family is templates, not a model call", () => {
  /*
   * The spec names the places fans index things, and they are the same places
   * for every subject. Paying a frontier model each round to recall a fixed
   * list gets a different subset of it every time — which is exactly why the
   * whole list is pinned here rather than spot-checked for the word "reddit".
   * An earlier version did that, and any one of the seven could have been
   * replaced with something else without the test noticing.
   */
  assert.deepEqual(crowdQueries("DarksidePhil"), [
    "DarksidePhil best of",
    "DarksidePhil compilation",
    "DarksidePhil timestamps",
    "DarksidePhil incident list",
    "reddit DarksidePhil timestamp thread",
    "DarksidePhil wiki incidents",
    "DarksidePhil clips most viewed",
  ]);
});

test("a harvested term that is already a template does not double the query", () => {
  /* "best of" turns up as community vocabulary constantly, and paying for the
     same page twice in one round is the cheapest mistake to make here. */
  const qs = crowdQueries("DSP", ["best of", "khan compilation"]);
  assert.equal(new Set(qs).size, qs.length, JSON.stringify(qs));
  assert.equal(qs.filter((q) => q === "DSP best of").length, 1);
  assert.ok(qs.includes("DSP khan compilation"));
});

test("no subject means no crowd queries", () => {
  assert.deepEqual(crowdQueries(""), []);
  assert.deepEqual(crowdQueries("   "), []);
});

/* ── Refusing invented vocabulary ───────────────────────────────────────── */

test("a term is used when its words appear in order, not as a substring", () => {
  const vocab: Term[] = [
    { term: "khan compilation", kind: "meme", sourceCount: 3 },
    { term: "rage", kind: "catchphrase", sourceCount: 2 },
  ];
  assert.equal(usesHarvestedTerm("the khan compilation full", vocab), true);
  assert.equal(usesHarvestedTerm("khan compilation", vocab), true);
  /* Over an article the raw strings differ and the tokens do not. */
  assert.equal(usesHarvestedTerm("watching the khan compilation again", vocab), true);
  /* A single-word term has to be a word. */
  assert.equal(usesHarvestedTerm("outrageous moments", vocab), false);
  assert.equal(usesHarvestedTerm("his rage at chat", vocab), true);
  /* Out of order is a different phrase. */
  assert.equal(usesHarvestedTerm("compilation khan", vocab), false);
});

const input = (over: Partial<ExpandInput> = {}): ExpandInput => ({
  subject: "DarksidePhil",
  beats: [
    { id: "B1", role: "subject", behaviour: BEHAVIOUR },
    { id: "C1", role: "counter", behaviour: "Reads out his own chat rules on stream" },
  ],
  vocabulary: [{ term: "khan compilation", kind: "meme", sourceCount: 4 }],
  ...over,
});

const q = (beat: string, family: string, query: string, hyde = "I said the thing.") => ({
  beat_id: beat,
  family,
  query,
  hyde,
});

test("ACCEPTANCE: an invented community term is dropped and reported", () => {
  /*
   * The whole reason the vocabulary is harvested rather than asked for. Both
   * of these read identically on the page; one of them is a phrase four
   * uploaders used and the other is a phrase a model produced, and only the
   * second costs a search to find out.
   */
  const i = input();
  const { queries, invented } = parseExpansion(
    JSON.stringify({
      queries: [
        q("B1", "direct", "DarksidePhil bans viewer live"),
        q("B1", "vocab", "the khan compilation ban"),
        q("B1", "vocab", "DSP meltdown compilation"),
        q("C1", "direct", "DarksidePhil explains chat rules"),
        q("C1", "counter", "DarksidePhil apology stream"),
        q("C1", "vocab", "khan compilation apology"),
      ],
    }),
    i,
  );

  assert.deepEqual(
    queries.map((x) => x.query),
    [
      "DarksidePhil bans viewer live",
      "the khan compilation ban",
      "DarksidePhil explains chat rules",
      "DarksidePhil apology stream",
      "khan compilation apology",
    ],
  );
  assert.deepEqual(invented, [{ beatId: "B1", query: "DSP meltdown compilation" }]);
});

test("with no vocabulary, no vocab query survives and none is expected", () => {
  /*
   * Round one has nothing harvested yet, so an empty vocab family is correct
   * rather than a failure — and anything the model wrote for it is, by
   * definition, invented.
   */
  const i = input({ vocabulary: [] });
  const { queries, invented, missing } = parseExpansion(
    JSON.stringify({
      queries: [
        q("B1", "direct", "DarksidePhil bans viewer live"),
        q("B1", "vocab", "the famous chat meltdown"),
        q("C1", "direct", "DarksidePhil chat rules"),
        q("C1", "counter", "DarksidePhil apology"),
      ],
    }),
    i,
  );
  assert.equal(queries.filter((x) => x.family === "vocab").length, 0);
  assert.equal(invented.length, 1);
  assert.deepEqual(missing, [], "an empty vocab family in round one is not missing");
});

test("a beat with no direct query is reported missing", () => {
  const { missing } = parseExpansion(
    JSON.stringify({ queries: [q("B1", "direct", "DarksidePhil bans viewer live")] }),
    input(),
  );
  /* C1 got nothing at all; B1 got no vocab query although there was
     vocabulary to use. */
  assert.deepEqual(missing, [
    { beatId: "B1", family: "vocab" },
    { beatId: "C1", family: "direct" },
    { beatId: "C1", family: "counter" },
    { beatId: "C1", family: "vocab" },
  ]);
});

test("a counter family is only expected of a counter beat", () => {
  /*
   * A subject beat's counter queries belong to the counter beat that inverts
   * it, or they are filed under the case they are arguing against — and the
   * balance meter then reports the other side as the user's own.
   */
  const { missing } = parseExpansion(
    JSON.stringify({
      queries: [
        q("B1", "direct", "a"),
        q("B1", "vocab", "khan compilation a"),
        q("C1", "direct", "b"),
        q("C1", "counter", "c"),
        q("C1", "vocab", "khan compilation b"),
      ],
    }),
    input(),
  );
  assert.deepEqual(missing, []);
});

test("a query with no beat belongs to nobody and is charged to everybody", () => {
  const { queries } = parseExpansion(
    JSON.stringify({
      queries: [
        q("", "direct", "orphan"),
        q("B9", "direct", "a beat that is not in this run"),
        q("B1", "nonsense", "an unknown family"),
        q("B1", "crowd", "the crowd family is not the model's to write"),
        q("B1", "direct", "   "),
        q("B1", "direct", "the one good one"),
      ],
    }),
    input(),
  );
  assert.deepEqual(queries.map((x) => x.query), ["the one good one"]);
});

test("a query already tried is not bought again", () => {
  const i = input({ alreadyTried: ["DarksidePhil Bans Viewer Live!"] });
  const { queries } = parseExpansion(
    JSON.stringify({
      queries: [
        q("B1", "direct", "darksidephil bans viewer live"),
        q("B1", "direct", "DarksidePhil bans a moderator"),
        q("C1", "direct", "DarksidePhil bans a moderator"),
      ],
    }),
    i,
  );
  /* Normalised, so punctuation and case do not buy the same page twice — and
     the same words for a second beat are still the same page. */
  assert.deepEqual(queries.map((x) => x.query), ["DarksidePhil bans a moderator"]);
});

test("prose instead of JSON returns nothing rather than half a round", () => {
  assert.deepEqual(parseExpansion("Here are some great search ideas!", input()), {
    queries: [],
    invented: [],
    missing: [],
  });
});

/* ── The call ───────────────────────────────────────────────────────────── */

function fakeAI(answer: unknown) {
  const asked: Array<Array<{ role: string; content: string }>> = [];
  const env = {
    AI: {
      run: async (_m: string, i: { messages: Array<{ role: string; content: string }> }) => {
        asked.push(i.messages.map((m) => ({ ...m })));
        return { response: JSON.stringify(answer), usage: { prompt_tokens: 80, completion_tokens: 40 } };
      },
    },
  } as unknown as Parameters<typeof expandQueries>[0];
  return { env, asked };
}

test("the crowd family is added without being asked for, and hangs off a subject beat", async () => {
  const { env } = fakeAI({
    queries: [q("B1", "direct", "DarksidePhil bans viewer live"), q("C1", "counter", "DarksidePhil apology")],
  });
  const out = await expandQueries(env, input());

  const crowd = out.queries.filter((x) => x.family === "crowd");
  assert.ok(crowd.length >= 7, `${crowd.length} crowd queries`);
  for (const c of crowd) assert.equal(c.beatId, "B1");
  /* And the harvested terms go into it: "best of" finds the general
     compilation, the term finds the specific one. */
  assert.ok(out.queries.some((x) => x.query === "DarksidePhil khan compilation"));
  assert.equal(out.tokensIn, 80);
});

test("an all-counter run still gets its crowd queries", () => {
  /* A run whose beats are all counter beats has no subject beat to hang them
     on, and dropping them would lose the whole family. */
  const { env } = fakeAI({ queries: [q("C1", "counter", "DarksidePhil apology")] });
  return expandQueries(env, input({ beats: [{ id: "C1", role: "counter", behaviour: "Apologises" }] })).then((out) => {
    assert.ok(out.queries.some((x) => x.family === "crowd"));
    for (const c of out.queries.filter((x) => x.family === "crowd")) assert.equal(c.beatId, "C1");
  });
});

test("the prompt hands over the terms, the counts, and the refusal", async () => {
  /*
   * The validator drops an invented term, and a dropped vocab query is a
   * query the round did not get. Telling the model plainly is the cheap half
   * of the fix, and it is the half that gets tidied away.
   */
  const { env, asked } = fakeAI({ queries: [] });
  await expandQueries(
    env,
    input({
      vocabulary: [{ term: "khan compilation", kind: "meme", sourceCount: 4 }],
      personas: [{ name: "his own moderator", queries: [] }],
      alreadyTried: ["DarksidePhil best of"],
    }),
  );

  const system = asked[0][0].content;
  assert.match(system, /USE ONLY THOSE/);
  assert.match(system, /Do not invent a nickname/);
  assert.match(system, /If no term fits a beat, write no vocab query for it/);
  /*
   * The HyDE instruction AND BOTH HALVES OF ITS EXAMPLE, because "a clip
   * where he complains about chat" is exactly what a model writes without
   * one. An earlier version asserted only /AS IF/ and /is not\./, which
   * survive deleting the example itself.
   */
  assert.match(system, /AS IF/);
  assert.match(system, /they were the transcript of the moment/);
  assert.match(system, /I am not reading chat tonight/);
  assert.match(system, /A clip where he complains about chat\u201d is not/);

  const user = asked[0][1].content;
  assert.match(user, /"khan compilation" \(meme, 4 sources\)/);
  assert.match(user, /his own moderator/);
  assert.match(user, /Already tried/);
  assert.match(user, /DarksidePhil best of/);
});

test("with nothing harvested the prompt says so rather than leaving a blank", async () => {
  /* An empty list under a heading reads as an omission, and a model fills
     omissions in. */
  const { env, asked } = fakeAI({ queries: [] });
  await expandQueries(env, input({ vocabulary: [] }));
  assert.match(asked[0][1].content, /none yet\. Write no vocab queries this round/);
});

test("a crowd query already tried is not re-issued", async () => {
  const { env } = fakeAI({ queries: [] });
  const out = await expandQueries(env, input({ alreadyTried: ["darksidephil BEST OF"] }));
  assert.ok(!out.queries.some((x) => x.query === "DarksidePhil best of"));
  assert.ok(out.queries.some((x) => x.query === "DarksidePhil compilation"));
});
