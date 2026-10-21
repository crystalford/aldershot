/**
 * BEFORE YOU POST.
 *
 * Doc 09: "It is where the system says what it knows and what it can't know."
 * Most of these are about the second half of that sentence. A checklist that
 * cannot say "nobody looked" is a checklist that lies by omission on exactly
 * the lines where it matters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { beforePost, summarise, tally, type Checked } from "../src/beforepost.ts";
import { commentary, disputeEntries, type DisputeClip } from "../src/dispute.ts";
import { cueSheet } from "../src/cuesheet.ts";
import { loudnessVerdict } from "../src/loudness.ts";

const clip = (over: Partial<DisputeClip> = {}): DisputeClip => ({
  ledgerId: "l1",
  channel: "Council Live",
  sourceTitle: "Full council meeting",
  platform: "youtube",
  url: "https://example.org/a",
  inS: 1200,
  outS: 1214,
  originalS: 4800,
  credit: "Source: Council Live · youtube · Mar 2026",
  creditRemoved: false,
  quote: "We moved the launch before the review came in.",
  ...over,
});

const checked = (over: Partial<Checked> = {}): Checked => ({
  external: [],
  commentary: commentary(600, 0),
  pictures: [],
  loudness: loudnessVerdict({ lufs: -14.1, truePeak: -4.9, lra: 3 }),
  tooFast: [],
  sidecar: true,
  cueCount: 12,
  everRendered: true,
  ...over,
});

const line = (c: Checked, key: string) => {
  const l = beforePost(c).find((x) => x.key === key);
  assert.ok(l, `no ${key} line`);
  return l;
};

test("doc 09's seven lines, in doc 09's order", () => {
  /* Not sorted by severity: sorting would move the line nobody checked to the
     bottom of a clean cut, which is exactly where it should not be. */
  assert.deepEqual(
    beforePost(checked()).map((l) => l.key),
    ["footage", "music", "faces", "pictures", "credits", "sound", "provenance"],
  );
});

test("ACCEPTANCE: a line nothing has checked never reads as clear", () => {
  /*
   * There is no music detection and no face detection in this product. A tick
   * beside either would tell somebody their video is clear when all it means
   * is that nobody looked — and they would believe it, because everything
   * else on the page is true.
   */
  const lines = beforePost(checked());
  for (const key of ["music", "faces"]) {
    const l = lines.find((x) => x.key === key)!;
    assert.equal(l.state, "unchecked", `${key} claims to have been checked`);
    assert.match(l.says, /Nothing in Aldershot checks this yet/);
  }
  /* And on a cut with nothing wrong anywhere, they are still unchecked. */
  assert.equal(tally(lines).attention, 0);
  assert.ok(tally(lines).unchecked >= 2);
});

test("the summary never says ready to post", () => {
  /*
   * Three of the seven lines are things no software here has looked at. A
   * cheerful all-clear over them is the product claiming something it has no
   * basis for.
   */
  const clean = summarise(beforePost(checked()));
  assert.match(clean, /Nothing to flag in what Aldershot can check/);
  assert.match(clean, /nothing here has checked at all/);
  assert.doesNotMatch(clean, /ready|good to go|all clear/i);
});

test("your own uploads are taken at your word, and the line says so", () => {
  /*
   * Doc 09 asks for a fingerprint match against sources marked as someone
   * else's. There is no fingerprinting here. "Every clip in this cut is
   * yours" means "every clip we know about", and a person reading a clear
   * line has to be told what clear means.
   */
  const l = line(checked(), "footage");
  assert.equal(l.state, "ok");
  assert.match(l.detail.join(" "), /taken at your word/);
  assert.match(l.detail.join(" "), /nothing here fingerprints it/);
  assert.match(l.detail.join(" "), /cannot tell you what is fair use/);
});

test("external clips are reported, and a thin cut is flagged", () => {
  const few = checked({ external: disputeEntries([clip()]), commentary: commentary(600, 14) });
  assert.equal(line(few, "footage").state, "ok");
  assert.match(line(few, "footage").says, /1 clip came from somebody else/);

  const thin = checked({ external: disputeEntries([clip()]), commentary: commentary(20, 14) });
  assert.equal(line(thin, "footage").state, "attention");
  assert.match(line(thin, "footage").detail.join(" "), /More of this cut is theirs than yours/);
});

test("a removed credit and a missing one are different sentences", () => {
  /* Only one of them is a defence — src/scout-credit.ts at editCredit. */
  const removed = checked({ external: disputeEntries([clip({ creditRemoved: true })]) });
  const missing = checked({ external: disputeEntries([clip({ credit: null })]) });

  assert.equal(line(removed, "credits").state, "attention");
  assert.match(line(removed, "credits").detail.join(" "), /taken off/);
  assert.equal(line(missing, "credits").state, "attention");
  assert.match(line(missing, "credits").detail.join(" "), /No credit written/);
  assert.notEqual(line(removed, "credits").says, line(missing, "credits").says);
});

test("credits are clear only when every clip has one", () => {
  const all = checked({ external: disputeEntries([clip(), clip({ ledgerId: "l2" })]) });
  assert.equal(line(all, "credits").state, "ok");
  assert.equal(line(all, "credits").detail.length, 2, "and it lists them");
});

test("labelled pictures pass, and an unlabelled one is a fault", () => {
  const labelled = checked({
    pictures: cueSheet([{ id: "b", kind: "generated", text: "A map of the two streets" }]),
  });
  assert.equal(line(labelled, "pictures").state, "ok");
  assert.match(line(labelled, "pictures").says, /labelled on screen/);

  /* Not reachable through the product — the label comes off the beat's kind —
     so if it ever happens, something upstream is broken and a tick would hide
     it. */
  const broken = checked({
    pictures: [{ beatId: "b", label: "", what: "A map", how: "Generated", when: null }],
  });
  assert.equal(line(broken, "pictures").state, "attention");
  assert.match(line(broken, "pictures").says, /should not be possible/);
});

test("sound reports the last render's loudness, or that there was not one", () => {
  const fine = line(checked(), "sound");
  assert.equal(fine.state, "ok");
  assert.match(fine.says, /-14\.1 LUFS/);

  /* A cut that has never been exported has no loudness: the number is a
     property of a finished file, not of a plan. */
  const never = line(
    checked({ loudness: loudnessVerdict({ lufs: null, truePeak: null, lra: null }) }),
    "sound",
  );
  assert.equal(never.state, "attention");
  assert.match(never.detail.join(" "), /could not be measured/);
});

test("captions too fast are named, and nothing offers to rewrite them", () => {
  const l = line(
    checked({ tooFast: [{ start_ms: 0, end_ms: 500, text: "far too much to read" }] }),
    "sound",
  );
  assert.equal(l.state, "attention");
  assert.match(l.detail.join(" "), /17 characters a second/);
  assert.match(l.detail.join(" "), /they are your words/);
});

test("the sidecar line says which way round it is", () => {
  assert.match(line(checked({ sidecar: true }), "sound").detail.join(" "), /subtitle file goes out/);
  assert.match(
    line(checked({ sidecar: false }), "sound").detail.join(" "),
    /burned into the picture.*no subtitle file/s,
  );
});

test("a cut with no words says so rather than reporting perfect captions", () => {
  const l = line(checked({ cueCount: 0 }), "sound");
  assert.match(l.detail.join(" "), /no captions, because nothing in this cut has words/);
});

test("provenance admits the manifest is not built", () => {
  const l = line(checked(), "provenance");
  assert.equal(l.state, "unchecked");
  assert.match(l.detail.join(" "), /not built/);
});

test("every line is a sentence somebody would say", () => {
  /* 15-DESIGN-LANGUAGE.md. No field names, no jargon, and never a bare count
     standing on its own as a whole line. */
  for (const l of beforePost(checked({ external: disputeEntries([clip()]) }))) {
    assert.ok(l.says.length > 12, `"${l.says}" is not a sentence`);
    assert.match(l.says, /[.!?]$/, `"${l.says}" does not end like one`);
    assert.doesNotMatch(l.says, /_|LUFS\b.*dBTP.*LRA|undefined|null/);
  }
});

test("the document marks the three states in words, not in colours", async () => {
  /*
   * A tick and a cross put "nobody looked" and "nothing is wrong" in the same
   * visual family, and the whole point of the third state is that it is
   * neither of them. It also has to survive being printed in black and white,
   * which is what somebody does with a document like this.
   */
  const { checklistText } = await import("../src/beforepost.ts");
  const text = checklistText(beforePost(checked()), "Whether to leave");
  assert.match(text, /BEFORE YOU POST — Whether to leave/);
  assert.match(text, /\[  \? {2}\]  Music/);
  assert.match(text, /\[ ok \]  Other people's footage/);
  assert.match(text, /nothing in Aldershot has looked at this at all/);
  /* Every one of the seven is in it. */
  for (const t of ["Other people's footage", "Music", "Faces", "Generated segments", "Attributions", "Sound and captions", "Provenance record"]) {
    assert.ok(text.includes(t), `the document left out ${t}`);
  }
});

test("before the first export there is no sound to measure, and that is not a fault", () => {
  /*
   * Loudness is a property of a finished file. Before one exists, "we could
   * not measure it" is nagging about something nobody could know — and the
   * same missing number after an export is a real failure. Same absence,
   * different fact, so they get different states.
   */
  const never = checked({
    everRendered: false,
    loudness: loudnessVerdict({ lufs: null, truePeak: null, lra: null }),
  });
  const l = line(never, "sound");
  assert.equal(l.state, "unchecked");
  assert.match(l.says, /Nothing has been exported yet/);
  assert.doesNotMatch(l.detail.join(" "), /could not be measured/);

  /* After an export, the same nulls are a problem. */
  const after = checked({
    everRendered: true,
    loudness: loudnessVerdict({ lufs: null, truePeak: null, lra: null }),
  });
  assert.equal(line(after, "sound").state, "attention");
});
