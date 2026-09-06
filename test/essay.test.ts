/**
 * "Every claim is backed by a real clip or an honestly-marked gap."
 *
 * That is the acceptance criterion for essays, and groundOutline is the only
 * thing enforcing it. A model citing a plausible-looking clip id that does not
 * exist is the exact failure this has to catch — the user would read a claim
 * as evidenced when it is not.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { actProgress, groundOutline, ACTS } from "../src/essay.ts";

const MENU = [
  { id: "clip_real_1", quote: "the algorithm knows me better than my wife", source_title: "Kino #372" },
  { id: "clip_real_2", quote: "gamers are the most persecuted minority", source_title: "Kino #372" },
];

const wrap = (beats: unknown[]) => ({ choices: [{ message: { content: JSON.stringify({ beats }) } }] });

test("a short menu id resolves to the real clip", () => {
  // The menu shows c1/c2 rather than 26-character ULIDs, because the model
  // reliably describes the right clip and mistypes a long random id.
  const { beats, rejected } = groundOutline(
    wrap([{ act: "Setup", kind: "clip", clip_id: "c1", text: "Opens the argument" }]),
    MENU,
  );
  assert.equal(rejected, 0);
  assert.equal(beats[0].kind, "clip");
  assert.equal(beats[0].clip_id, "clip_real_1");
});

test("the real id is accepted too, if the model quotes it", () => {
  const { beats } = groundOutline(
    wrap([{ act: "Setup", kind: "clip", clip_id: "clip_real_2", text: "Backs the turn" }]),
    MENU,
  );
  assert.equal(beats[0].clip_id, "clip_real_2");
});

test("short-id resolution is case-insensitive", () => {
  const { beats } = groundOutline(wrap([{ act: "Setup", kind: "clip", clip_id: "C2", text: "ok then" }]), MENU);
  assert.equal(beats[0].clip_id, "clip_real_2");
});

test("a beat citing a clip that does not exist becomes a visible gap", () => {
  // The model wanted to make this point but could not back it. Dropping the
  // beat would hide the gap; keeping the citation would be a lie.
  const { beats, rejected } = groundOutline(
    wrap([{ act: "Turn", kind: "clip", clip_id: "clip_invented", text: "He admits it outright" }]),
    MENU,
  );
  assert.equal(rejected, 1);
  assert.equal(beats[0].kind, "stock");
  assert.equal(beats[0].clip_id, undefined);
  assert.equal(beats[0].text, "He admits it outright", "the point survives, the false citation does not");
});

test("a clip beat with no citation at all is also a gap", () => {
  const { beats, rejected } = groundOutline(
    wrap([{ act: "Setup", kind: "clip", text: "Something supports this, honest" }]),
    MENU,
  );
  assert.equal(rejected, 1);
  assert.equal(beats[0].kind, "stock");
});

test("vo, stock and generated beats pass through as themselves", () => {
  const { beats } = groundOutline(
    wrap([
      { act: "Setup", kind: "vo", text: "Here is the argument" },
      { act: "Turn", kind: "stock", text: "A city at night" },
      { act: "Resolution", kind: "generated", text: "An empty studio" },
    ]),
    MENU,
  );
  assert.deepEqual(beats.map((b) => b.kind), ["vo", "stock", "generated"]);
});

test("an unknown kind falls back to the creator's own voice, never to a citation", () => {
  const { beats } = groundOutline(wrap([{ act: "Setup", kind: "nonsense", text: "x marks it" }]), MENU);
  assert.equal(beats[0].kind, "vo");
  assert.equal(beats[0].clip_id, undefined);
});

test("beats come back in act order, not the order the model emitted", () => {
  const { beats } = groundOutline(
    wrap([
      { act: "Resolution", kind: "vo", text: "last" },
      { act: "Setup", kind: "vo", text: "first" },
      { act: "Turn", kind: "vo", text: "third" },
      { act: "Development", kind: "vo", text: "second" },
    ]),
    MENU,
  );
  assert.deepEqual(beats.map((b) => b.text), ["first", "second", "third", "last"]);
});

test("an unrecognised act is placed rather than dropped", () => {
  const { beats } = groundOutline(wrap([{ act: "Interlude", kind: "vo", text: "somewhere" }]), MENU);
  assert.equal(beats.length, 1);
  assert.ok(ACTS.includes(beats[0].act));
});

test("empty text is dropped — a beat with nothing to say is not a beat", () => {
  const { beats } = groundOutline(wrap([{ act: "Setup", kind: "vo", text: "   " }]), MENU);
  assert.deepEqual(beats, []);
});

test("garbage produces no beats rather than throwing", () => {
  assert.deepEqual(groundOutline("not json", MENU), { beats: [], rejected: 0 });
  assert.deepEqual(groundOutline({ choices: [{ message: { content: "{}" } }] }, MENU).beats, []);
});

test("a fenced code block is still read", () => {
  const res = { choices: [{ message: { content: '```json\n{"beats":[{"act":"Setup","kind":"vo","text":"hi there"}]}\n```' } }] };
  assert.equal(groundOutline(res, MENU).beats.length, 1);
});

test("act progress counts what is genuinely backed", () => {
  const { beats } = groundOutline(
    wrap([
      { act: "Setup", kind: "clip", clip_id: "c1", text: "backed" },
      { act: "Setup", kind: "stock", text: "a gap" },
      { act: "Turn", kind: "clip", clip_id: "clip_invented", text: "not really backed" },
    ]),
    MENU,
  );
  const progress = actProgress(beats);
  const setup = progress.find((p) => p.act === "Setup")!;
  const turn = progress.find((p) => p.act === "Turn")!;
  assert.deepEqual([setup.total, setup.backed], [2, 1]);
  // The invented citation must NOT count as backing.
  assert.deepEqual([turn.total, turn.backed], [1, 0]);
});
