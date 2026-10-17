/**
 * REDUCE: order what was verified, and refuse to let the model touch it.
 *
 * The last model call in a run and the only one that sees evidence, which
 * makes it the one place a quote or a timestamp could acquire a new author.
 * Spec 3.7 puts it in bold: "The model **may not** add rows, change quotes or
 * change times." This file is what makes that true rather than asked for —
 * the model is sent short ids and returns short ids, and there is no field it
 * could put a quote or a time in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMPT_CONTEXT_S,
  ROW_TOKENS,
  WHY_CHARS,
  fallbackOrder,
  orientDuplicate,
  parseReduction,
  reduce,
  renderRow,
  shortIds,
  usableWhy,
  type LedgerRow,
} from "../src/scout-reduce.ts";

let n = 0;
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "01JABCDEFGHJKMNPQRSTVWXYZ" + ++n,
  beatId: "B1",
  verify: "verified",
  quoteExact: "get out of my chat and do not come back",
  tStartS: 5070.4,
  tEndS: 5074.9,
  contextBefore: "somebody asked why the run was taking so long",
  contextAfter: "and then he moved on to the next game",
  sourceId: "s1",
  sourceTitle: "Stream of the 14th",
  sourceChannel: "The Channel",
  sourceKind: "vod",
  publishedAt: Date.parse("2026-03-14T00:00:00Z"),
  crowdSignals: 4,
  ...over,
});

const answer = (body: unknown) => JSON.stringify(body);

/* ── What the model is shown ────────────────────────────────────────────── */

test("ACCEPTANCE: the times are not in the prompt at all", () => {
  /*
   * NOT BECAUSE THEY WOULD BE UNHELPFUL. A model ranking two moments might
   * reasonably want to know one is forty minutes in. But a model that has
   * seen a timestamp can return one, and a timestamp that came back from a
   * model is a timestamp somebody will eventually believe. Invariant 2 is
   * cheaper to keep than to check.
   */
  const r = row();
  const rendered = renderRow(r, "r1");

  assert.ok(!/5070/.test(rendered), rendered);
  assert.ok(!/1:24/.test(rendered), rendered);
  assert.ok(!/\b\d{1,3}:\d{2}\b/.test(rendered), rendered);
  /* The date IS there — a date is a fact about the source, not a position
     inside it, and ranking by proximity to an incident needs it. */
  assert.match(rendered, /2026-03-14/);
  assert.match(rendered, /\[r1\]/);
  assert.match(rendered, /get out of my chat/);
});

test("a paraphrase row says so, where the model can see it", () => {
  /* It has to rank below an exact row showing the same thing, and it cannot
     do that without being told which is which. */
  assert.match(renderRow(row({ verify: "paraphrase" }), "r1"), /NOT WORD FOR WORD/);
  assert.ok(!/NOT WORD FOR WORD/.test(renderRow(row(), "r1")));
});

test("a row fits its token budget, and the quote is what survives", () => {
  /*
   * Spec 3.7: at most three hundred tokens a row. Thirty rows at a thousand
   * tokens each is a prompt nobody budgeted for. The quote is the evidence,
   * so the context is what gives way.
   */
  const long = row({
    /* Two thousand characters of quote. An earlier version used six hundred,
       which is under the quote's own half-share of the budget — so the clip
       never fired and the test measured nothing. */
    quoteExact: "q ".repeat(1000).trim(),
    contextBefore: "before ".repeat(500).trim(),
    contextAfter: "after ".repeat(500).trim(),
  });
  const rendered = renderRow(long, "r1");
  /* Roughly four characters a token. */
  assert.ok(rendered.length <= ROW_TOKENS * 4 + 200, `${rendered.length} characters`);
  assert.match(rendered, /^\[r1\]/);
  assert.match(rendered, /quote: "q q q/);
  assert.ok(rendered.includes("…"), "and it says it was trimmed");
  assert.equal(PROMPT_CONTEXT_S, 20);
});

test("a row with no context or no source still renders", () => {
  /* A find in a source whose feed gave no title. The row is still evidence. */
  const bare = renderRow(
    row({ contextBefore: undefined, contextAfter: undefined, sourceTitle: undefined, sourceChannel: undefined, publishedAt: undefined, crowdSignals: 0 }),
    "r1",
  );
  assert.match(bare, /unknown source/);
  assert.match(bare, /date unknown/);
  assert.match(bare, /get out of my chat/);
  assert.ok(!/before:/.test(bare));
});

test("short ids are short, because a long one gets mistyped", () => {
  /*
   * Measured in this codebase on this problem: asked to copy a 26-character
   * ULID, a model describes the right row and mistypes the reference. r1, r2,
   * r3 come back correct.
   */
  const rows = [row(), row(), row()];
  assert.deepEqual([...shortIds(rows).values()], ["r1", "r2", "r3"]);
  for (const short of shortIds(rows).values()) assert.ok(short.length <= 4, short);
});

/* ── What the model may return ──────────────────────────────────────────── */

test("ACCEPTANCE: an invented row id is dropped and reported", () => {
  /*
   * "The model may not add rows." The schema gives it nowhere to put a quote,
   * so the only way to add one is to name an id that was never sent — and
   * then the board would show a row with no evidence behind it.
   */
  const rows = [row(), row()];
  const ids = shortIds(rows);
  const { ranked, invented } = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1", "r9", "r2"] }],
      why: [{ row: "r9", line: "the strongest one" }],
      duplicates: [],
    }),
    rows,
    ids,
  );

  assert.deepEqual(ranked.map((r) => r.rowId), [rows[0].id, rows[1].id]);
  assert.deepEqual(invented, ["r9"]);
  /* And nothing carries the invented row's line. */
  for (const r of ranked) assert.notEqual(r.why, "the strongest one");

  /*
   * REPORTED FROM THE ORDER ITSELF, not only from the `why` list. An earlier
   * version of this test named the invented id in both places, so deleting
   * the report inside the ranking loop changed nothing — the `why` loop was
   * still finding it, and the one place a phantom row actually gets onto a
   * board is the ranking.
   */
  const bare = parseReduction(
    answer({ beats: [{ beat_id: "B1", order: ["r1", "r9"] }], why: [], duplicates: [] }),
    rows,
    ids,
  );
  assert.deepEqual(bare.invented, ["r9"]);
  assert.equal(bare.ranked.length, 2);
});

test("ACCEPTANCE: a row the model forgot goes on the end, not away", () => {
  /*
   * Twelve verified moments ranked as eight is a run that found twelve and
   * reported eight — the silent partial failure invariant 7 calls a P1,
   * arriving as a shorter list rather than as an error.
   */
  const rows = [row(), row(), row(), row()];
  const { ranked, forgotten } = parseReduction(
    answer({ beats: [{ beat_id: "B1", order: ["r3", "r1"] }], why: [], duplicates: [] }),
    rows,
    shortIds(rows),
  );

  assert.equal(ranked.length, 4);
  assert.deepEqual(ranked.map((r) => r.rowId), [rows[2].id, rows[0].id, rows[1].id, rows[3].id]);
  assert.deepEqual(forgotten, [rows[1].id, rows[3].id]);
  /* Ranks run 1..4, so "strongest" means something. */
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
});

test("ranks restart at one within each beat", () => {
  /* "Strongest" is per beat. A single run of ranks across six beats makes
     beat six's best row look like its worst. */
  const rows = [row({ beatId: "B1" }), row({ beatId: "C1" }), row({ beatId: "B1" })];
  const { ranked } = parseReduction(
    answer({
      beats: [
        { beat_id: "B1", order: ["r3", "r1"] },
        { beat_id: "C1", order: ["r2"] },
      ],
      why: [],
      duplicates: [],
    }),
    rows,
    shortIds(rows),
  );
  assert.deepEqual(
    ranked.map((r) => [r.beatId, r.rank]),
    [["B1", 1], ["B1", 2], ["C1", 1]],
  );
});

test("a row listed under two beats is placed once", () => {
  /* A row belongs to the beat it was found for. Listed twice it would be two
     pieces of evidence on the board and one in the ledger. */
  const rows = [row({ beatId: "B1" })];
  const { ranked } = parseReduction(
    answer({
      beats: [
        { beat_id: "B1", order: ["r1"] },
        { beat_id: "C1", order: ["r1"] },
      ],
      why: [],
      duplicates: [],
    }),
    rows,
    shortIds(rows),
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].beatId, "B1");
});

test("prose instead of JSON keeps the evidence and loses only the opinion", () => {
  /*
   * Everything here was verified before the call. What a failed ranking costs
   * is an order, which is worth much less than the twelve rows it would take
   * with it.
   */
  const rows = [row(), row()];
  const { ranked } = parseReduction("I'd rank the first one highest!", rows, shortIds(rows));
  assert.deepEqual(ranked.map((r) => r.rowId), [rows[0].id, rows[1].id]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  for (const r of ranked) assert.equal(r.why, null);
});

/* ── The why line ───────────────────────────────────────────────────────── */

test("ACCEPTANCE: a why line may not quote the row back", () => {
  /*
   * A restated quote is a quote that no longer came from the verifier — the
   * one place in this pipeline a quote is allowed to come from. It would read
   * identically on the board and have a model as its author.
   */
  const r = row();
  assert.equal(usableWhy("The clearest instance, and nobody is provoking him", r), true);
  assert.equal(usableWhy('He says "get out of my chat and do not come back"', r), false);
  assert.equal(usableWhy("get out of my chat and do not come back is the line", r), false);
  /* A few words in common is a reference, not a quotation. */
  assert.equal(usableWhy("It is about his chat, not about the game", r), true);
});

test("ACCEPTANCE: a why line may not write a timecode", () => {
  /*
   * Invariant 2 at the level of prose. A time in a sentence is a time the
   * board will show, and it did not come from a word id.
   */
  const r = row();
  assert.equal(usableWhy("At 1:24:30 he loses it", r), false);
  assert.equal(usableWhy("At 84:30 he loses it", r), false);
  assert.equal(usableWhy("Thirty seconds in he loses it", r), true);
  assert.equal(usableWhy("30 seconds in he loses it", r), false);
  assert.equal(usableWhy("It runs 45s", r), false);
  /* A year is not a timecode. */
  assert.equal(usableWhy("The 2026 incident, not the earlier one", r), true);
});

test("a why line that is a paragraph is not a line", () => {
  const r = row();
  assert.equal(usableWhy("x".repeat(WHY_CHARS), r), true);
  assert.equal(usableWhy("x".repeat(WHY_CHARS + 1), r), false);
  assert.equal(usableWhy("   ", r), false);
  assert.equal(usableWhy("", r), false);
});

test("an unusable why line is dropped, and the row is kept", () => {
  /* The row is evidence; the line is a convenience. Losing the row over a bad
     sentence would be the wrong way round. */
  const rows = [row()];
  const { ranked } = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1"] }],
      why: [{ row: "r1", line: "At 1:24:30 he says get out of my chat and do not come back" }],
      duplicates: [],
    }),
    rows,
    shortIds(rows),
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].why, null);
});

/* ── Duplicates ─────────────────────────────────────────────────────────── */

test("ACCEPTANCE: which of two rows is the copy is decided here, not by the model", () => {
  /*
   * A compilation is a copy of a stream and a reupload is a copy of anything
   * that is not one. Letting the model choose the direction means a
   * compilation can be recorded as the original of the stream it was cut
   * from, and then the board offers the compilation as the source and the
   * attribution chain points the wrong way.
   */
  const vod = row({ sourceKind: "vod", publishedAt: Date.parse("2026-03-14T00:00:00Z") });
  const comp = row({ sourceKind: "compilation", publishedAt: Date.parse("2026-03-20T00:00:00Z") });
  const reup = row({ sourceKind: "reupload", publishedAt: Date.parse("2026-03-16T00:00:00Z") });

  assert.deepEqual(orientDuplicate(comp, vod), [comp, vod]);
  /* And the same answer with the arguments the other way round. */
  assert.deepEqual(orientDuplicate(vod, comp), [comp, vod]);
  /* A reupload is a copy even of a compilation. */
  assert.deepEqual(orientDuplicate(comp, reup), [reup, comp]);

  /*
   * THE KIND DECIDES IT WITH NO DATES TO FALL BACK ON, which is the case that
   * proves the kind is deciding at all. In the three above, the copy also
   * happens to be the later upload, so the date rule reaches the same answer
   * and the kind rule could have been deleted unnoticed. A compilation of old
   * clips uploaded BEFORE the stream it quotes is still the copy.
   */
  const oldComp = row({ sourceKind: "compilation", publishedAt: undefined });
  const newVod = row({ sourceKind: "vod", publishedAt: undefined });
  assert.deepEqual(orientDuplicate(oldComp, newVod), [oldComp, newVod]);
  assert.deepEqual(orientDuplicate(newVod, oldComp), [oldComp, newVod]);

  const earlyComp = row({ sourceKind: "compilation", publishedAt: Date.parse("2026-01-01T00:00:00Z") });
  const laterVod = row({ sourceKind: "vod", publishedAt: Date.parse("2026-06-01T00:00:00Z") });
  assert.deepEqual(orientDuplicate(earlyComp, laterVod), [earlyComp, laterVod]);

  const earlyReup = row({ sourceKind: "reupload", publishedAt: Date.parse("2026-01-01T00:00:00Z") });
  assert.deepEqual(orientDuplicate(earlyReup, laterVod), [earlyReup, laterVod]);
});

test("where the kinds do not settle it, the later publication is the copy", () => {
  /* A copy cannot predate the thing it copies. */
  const early = row({ sourceKind: "vod", publishedAt: Date.parse("2026-03-14T00:00:00Z") });
  const late = row({ sourceKind: "vod", publishedAt: Date.parse("2026-04-01T00:00:00Z") });
  assert.deepEqual(orientDuplicate(late, early), [late, early]);
  assert.deepEqual(orientDuplicate(early, late), [late, early]);
});

test("the model's direction is only used when nothing else can decide", () => {
  /* Same kind, same date or no date. By then it is a guess either way, and
     the model has at least read both rows. */
  const a = row({ sourceKind: "vod", publishedAt: undefined });
  const b = row({ sourceKind: "vod", publishedAt: undefined });
  assert.deepEqual(orientDuplicate(a, b), [a, b]);
  assert.deepEqual(orientDuplicate(b, a), [b, a]);
});

test("a duplicate link is written onto the row as original_of", () => {
  const vod = row({ sourceKind: "vod", publishedAt: Date.parse("2026-03-14T00:00:00Z") });
  const comp = row({ sourceKind: "compilation", publishedAt: Date.parse("2026-03-20T00:00:00Z") });
  const rows = [vod, comp];
  const { ranked } = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1", "r2"] }],
      why: [],
      /* The model has it backwards, and it does not matter. */
      duplicates: [{ copy: "r1", original: "r2" }],
      }),
    rows,
    shortIds(rows),
  );
  assert.equal(ranked.find((r) => r.rowId === comp.id)!.originalOf, vod.id);
  assert.equal(ranked.find((r) => r.rowId === vod.id)!.originalOf, null);
});

test("a row cannot be a copy of itself, and two rows cannot each be the copy", () => {
  /* Either is a cycle, and a cycle in original_of is a board that cannot
     render — or a chain walk that never ends. */
  const rows = [row(), row()];
  const { ranked } = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1", "r2"] }],
      why: [],
      duplicates: [
        { copy: "r1", original: "r1" },
        { copy: "r1", original: "r2" },
        { copy: "r2", original: "r1" },
      ],
    }),
    rows,
    shortIds(rows),
  );
  const links = ranked.filter((r) => r.originalOf);
  assert.equal(links.length, 1, JSON.stringify(ranked.map((r) => [r.rowId, r.originalOf])));
  assert.notEqual(links[0].originalOf, links[0].rowId);

  /*
   * THE SELF-LINK ON ITS OWN, which is the case that proves it is refused. In
   * the three above it was overwritten by the next link in the list, so
   * deleting the refusal changed nothing.
   */
  const alone = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1", "r2"] }],
      why: [],
      duplicates: [{ copy: "r1", original: "r1" }],
    }),
    rows,
    shortIds(rows),
  );
  assert.deepEqual(alone.ranked.map((r) => r.originalOf), [null, null]);
});

test("a duplicate naming a row that was never sent is dropped and reported", () => {
  const rows = [row()];
  const { ranked, invented } = parseReduction(
    answer({
      beats: [{ beat_id: "B1", order: ["r1"] }],
      why: [],
      duplicates: [{ copy: "r1", original: "r7" }],
    }),
    rows,
    shortIds(rows),
  );
  assert.equal(ranked[0].originalOf, null);
  assert.deepEqual(invented, ["r7"]);
});

test("a link already traced survives a reduction that says nothing about it", () => {
  /* original_of is written by the snowball step too. A ranking pass is not a
     licence to forget what was already worked out. */
  const rows = [row({ originalOf: "an-earlier-row" })];
  const { ranked } = parseReduction(
    answer({ beats: [{ beat_id: "B1", order: ["r1"] }], why: [], duplicates: [] }),
    rows,
    shortIds(rows),
  );
  assert.equal(ranked[0].originalOf, "an-earlier-row");

  /*
   * AND ON A ROW THE MODEL FORGOT, which goes through the other branch.
   * Appended rows are assembled separately from ranked ones, so the link has
   * to be carried in two places and an earlier version of this test only
   * covered the first.
   */
  const two = [row({ originalOf: "an-earlier-row" }), row()];
  const appended = parseReduction(
    answer({ beats: [{ beat_id: "B1", order: ["r2"] }], why: [], duplicates: [] }),
    two,
    shortIds(two),
  );
  assert.deepEqual(appended.forgotten, [two[0].id]);
  assert.equal(appended.ranked.find((r) => r.rowId === two[0].id)!.originalOf, "an-earlier-row");
});

/* ── The call ───────────────────────────────────────────────────────────── */

function fakeAI(answerBody: unknown) {
  const asked: Array<Array<{ role: string; content: string }>> = [];
  const env = {
    AI: {
      run: async (_m: string, i: { messages: Array<{ role: string; content: string }> }) => {
        asked.push(i.messages.map((m) => ({ ...m })));
        return { response: JSON.stringify(answerBody), usage: { prompt_tokens: 900, completion_tokens: 120 } };
      },
    },
  } as unknown as Parameters<typeof reduce>[0];
  return { env, asked };
}

test("ACCEPTANCE: a rejected row never reaches the model", async () => {
  /*
   * Spec 3.7's input is "verified and paraphrase rows". A rejected row is a
   * quote that is not in the source, and putting it in front of a frontier
   * model asking which is strongest is asking it to rank a fabrication —
   * which it will do, convincingly.
   */
  const good = row({ quoteExact: "the words that are really there" });
  const bad = row({ verify: "rejected", quoteExact: "the words he never said at all" });
  const { env, asked } = fakeAI({ beats: [{ beat_id: "B1", order: ["r1"] }], why: [], duplicates: [] });

  const out = await reduce(env, [good, bad]);

  const prompt = asked[0][1].content;
  assert.match(prompt, /the words that are really there/);
  assert.ok(!/never said at all/.test(prompt), "a rejected quote reached the model");
  assert.deepEqual(out.ranked.map((r) => r.rowId), [good.id]);
});

test("nothing verified is no call at all", async () => {
  /* A frontier call over an empty list is a frontier call for nothing, and a
     run that found nothing is a common outcome rather than an error. */
  const { env, asked } = fakeAI({ beats: [], why: [], duplicates: [] });
  const out = await reduce(env, [row({ verify: "rejected" })]);
  assert.equal(asked.length, 0);
  assert.deepEqual(out.ranked, []);
  assert.equal(out.tokensIn, 0);
});

test("the prompt forbids the three things the spec puts in bold", async () => {
  /*
   * The validator catches each of them, and the validator catching something
   * means a round where the model did the wrong thing. Telling it plainly is
   * the cheap half, and it is the half that gets tidied away.
   */
  const { env, asked } = fakeAI({ beats: [], why: [], duplicates: [] });
  await reduce(env, [row()]);
  const system = asked[0][0].content;

  assert.match(system, /EVERY ROW YOU WERE GIVEN GOES IN AN ORDER/);
  assert.match(system, /Do not leave it out and do not invent an id/);
  assert.match(system, /DO NOT QUOTE THE ROW BACK and do not write a timecode/);
  /* And the example of a good line beside the bad one, because "say what it
     is for" without an example gets a summary of the quote. */
  assert.match(system, /nobody is provoking him/);
  assert.match(system, /get out of my chat/);
  /* And what strongest MEANS, or it ranks by how bad the words sound. */
  assert.match(system, /the fifteen seconds before them explain why is NOT a strong/);
});

test("the ranking carries the tokens it cost", async () => {
  const { env } = fakeAI({ beats: [{ beat_id: "B1", order: ["r1"] }], why: [], duplicates: [] });
  const out = await reduce(env, [row()]);
  assert.equal(out.tokensIn, 900);
  assert.equal(out.tokensOut, 120);
  assert.ok(out.model.length > 0);
});

test("the fallback order is the order rows were found in", () => {
  const rows = [row({ beatId: "B1" }), row({ beatId: "C1" }), row({ beatId: "B1" })];
  assert.deepEqual(
    fallbackOrder(rows).map((r) => [r.beatId, r.rank]),
    [["B1", 1], ["C1", 1], ["B1", 2]],
  );
});
