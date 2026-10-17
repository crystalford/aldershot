/**
 * DECOMPOSE: the brief becomes beats a camera could have filmed.
 *
 * The acceptance test is the spec's own: "a brief with 'he's narcissistic'
 * returns only observable beats and lists the diagnosis as rejected. Every
 * subject beat has a counter beat."
 *
 * The failure this is guarding against is not a crash. It is thirty searches
 * and twelve hours of scanning for narcissism, and a board full of evidence
 * for something nobody can point at. Everything here is a thing that would
 * otherwise go wrong in silence, with a bill attached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decompose,
  diagnosis,
  parseDecomposition,
  validateDecomposition,
  MAX_BEATS,
  STOPLIST,
  type Parsed,
} from "../src/scout-decompose.ts";

const answer = (body: unknown) => JSON.stringify(body);

const beat = (id: string, behaviour: string, extra: Record<string, unknown> = {}) => ({
  id,
  role: "subject",
  name: id,
  behaviour,
  need_min: 2,
  ...extra,
});

const counter = (id: string, inverts: string, behaviour = "Explains his chat rules on stream") => ({
  id,
  inverts,
  role: "counter",
  name: id,
  behaviour,
  need_min: 1,
});

/* ── The stoplist ───────────────────────────────────────────────────────── */

test("a diagnosis is not a behaviour", () => {
  /*
   * None of these happen at a timecode. A beat written this way sends real
   * searches after a verdict.
   */
  assert.equal(diagnosis("Establishes his narcissism"), "narcissis");
  assert.equal(diagnosis("He is narcissistic on stream"), "narcissis");
  assert.equal(diagnosis("Shows how insecure he is about the numbers"), "insecure");
  assert.equal(diagnosis("Being jealous of the other channel"), "jealous");
  assert.equal(diagnosis("His manipulative handling of the apology"), "manipulative");
});

test("a motive is not a behaviour either", () => {
  /* The second half of "lashes out because he can't handle criticism" is a
     guess about someone's head, and no amount of footage settles it. */
  assert.equal(diagnosis("Lashes out because he can't handle criticism"), "because he");
  assert.equal(diagnosis("Deliberately reads the worst message out"), "deliberately");
  assert.equal(diagnosis("Wants to be seen as the victim"), "wants to");
});

test("an attributed motive IS a behaviour — the words are in the audio", () => {
  /*
   * THIS IS THE TEST THAT KEEPS THE CHECK SWITCHED ON. "He wants to quit" is
   * a mind-read; "he says he wants to quit" is a sentence a viewer hears him
   * say. A stoplist that cannot tell them apart fires on correct beats, and
   * a check that fires on correct work gets deleted by whoever it annoys.
   */
  assert.equal(diagnosis("Says on stream that he wants to quit"), null);
  assert.equal(diagnosis("Admits he deliberately left the message up"), null);
  assert.equal(diagnosis("Told the moderator he doesn't care what chat thinks"), null);
  assert.equal(diagnosis("Explains that he can't handle doing two streams a day"), null);
});

test("the attribution has to come before the motive", () => {
  /*
   * "Wants to look calm on stream" has an attribution phrase in it and is
   * still a mind-read — the attribution lands on the wrong clause. Testing
   * for the phrase anywhere in the sentence would pass it, which is why the
   * check reads only the words BEFORE the motive.
   *
   * These two sentences put a listed attribution phrase after the motive on
   * purpose. An earlier version of this test used "wants to say" and "trying
   * to tell", which pin nothing: the list holds "says" and "tells", so a
   * check reading the whole sentence passed those too and the test stayed
   * green while the guarantee was gone.
   */
  assert.equal(diagnosis("Wants to look calm on stream"), "wants to");
  assert.equal(diagnosis("Trying to seem reasonable to camera"), "trying to");
  assert.equal(diagnosis("Wants to say that the ban was fair"), "wants to");
  assert.equal(diagnosis("Trying to tell chat it was a joke"), "trying to");
});

test("plain observable conduct passes clean", () => {
  const fine = [
    "Berates live chat during streams; addresses chat as an adversary",
    "Bans a viewer mid-sentence and names them",
    "Reads out a donation message, then stops reading donations for the rest of the stream",
    "Apologises at the top of the next stream",
    "Posts a screenshot of the DMs",
  ];
  for (const f of fine) assert.equal(diagnosis(f), null, f);
});

test("the stoplist separates its three kinds", () => {
  /* The prompt quotes these at the model and the regeneration quotes them
     back, so the three lists have to stay three lists. */
  assert.ok(STOPLIST.diagnosis.includes("narcissis"));
  assert.ok(STOPLIST.motive.includes("because he"));
  assert.ok(STOPLIST.attributed.includes("says"));
  for (const m of STOPLIST.motive) assert.ok(!STOPLIST.diagnosis.includes(m), m);
});

/* ── Reading the answer ─────────────────────────────────────────────────── */

test("a beat with no behaviour or no id is not a beat", () => {
  /*
   * No behaviour, nothing to search for. No id, and nothing can refer to it —
   * not a counter beat, not a search row, not a moment. Both would sit on the
   * board as permanent empty rows.
   */
  const { beats } = parseDecomposition(
    answer({
      beats: [
        beat("B1", "Bans a viewer mid-sentence"),
        beat("B2", "   "),
        beat("", "Reads the donation out"),
        { id: "B4", role: "subject", name: "", behaviour: "Shouts at the mods", need_min: 2 },
      ],
      counter: [],
      personas: [],
      rejected: [],
    }),
  );
  assert.deepEqual(beats.map((b) => b.id), ["B1"]);
});

test("a duplicate id is dropped, not carried twice", () => {
  /* Two beats with one id means a counter beat's `inverts` is ambiguous and
     every search row downstream attaches to whichever was written last. */
  const { beats } = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B1", "Shouts at the mods")],
      counter: [],
      personas: [],
      rejected: [],
    }),
  );
  assert.equal(beats.length, 1);
  assert.equal(beats[0].behaviour, "Bans a viewer mid-sentence");
});

test("need_min defaults by role and never runs away", () => {
  /* need_min is how much evidence the run goes looking for, so a missing one
     has to default and a silly one has to be capped — it is a budget. */
  const { beats } = parseDecomposition(
    answer({
      beats: [
        { id: "B1", role: "subject", name: "B1", behaviour: "Bans a viewer", need_min: "" },
        { id: "B2", role: "subject", name: "B2", behaviour: "Shouts at the mods", need_min: 400 },
      ],
      counter: [{ id: "C1", inverts: "B1", role: "counter", name: "C1", behaviour: "Apologises", need_min: 0 }],
      personas: [],
      rejected: [],
    }),
  );
  assert.equal(beats.find((b) => b.id === "B1")?.needMin, 2);
  assert.equal(beats.find((b) => b.id === "B2")?.needMin, 6);
  assert.equal(beats.find((b) => b.id === "C1")?.needMin, 1);
});

test("a counter beat stays a counter beat whatever its role field says", () => {
  /* It arrived in the `counter` array. A model that mislabels the role would
     otherwise put the other side on the board as the user's own case. */
  const { beats } = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence")],
      counter: [{ id: "C1", inverts: "B1", role: "subject", name: "C1", behaviour: "Apologises", need_min: 1 }],
      personas: [],
      rejected: [],
    }),
  );
  assert.equal(beats.find((b) => b.id === "C1")?.role, "counter");
});

test("prose instead of JSON returns nothing rather than half a plan", () => {
  assert.deepEqual(parseDecomposition("I'd be happy to help with that!"), {
    beats: [],
    personas: [],
    rejected: [],
  });
});

/* ── The acceptance test ────────────────────────────────────────────────── */

test("ACCEPTANCE: 'he's narcissistic' returns only observable beats, diagnosis rejected", () => {
  /*
   * The spec's own acceptance test for Scout v0, run against the validator
   * rather than the model: the model's output is the input here, so the
   * guarantee holds whatever the model does.
   */
  const parsed = parseDecomposition(
    answer({
      beats: [
        beat("B1", "Berates live chat during streams; addresses chat as an adversary"),
        beat("B2", "Establishes his underlying narcissism"),
        beat("B3", "Bans a viewer mid-sentence, then reads the ban out"),
      ],
      counter: [counter("C1", "B1"), counter("C2", "B3", "Reads out his own chat rules")],
      personas: [{ name: "his own moderator", queries: ["mod perspective"] }],
      rejected: [{ said: "he is narcissistic", why: "a diagnosis, not a behaviour" }],
    }),
  );

  const final = validateDecomposition(parsed, { final: true });

  /* Only observable beats survive. */
  for (const b of final.beats) assert.equal(diagnosis(b.behaviour), null, b.behaviour);
  assert.deepEqual(final.beats.map((b) => b.id), ["B1", "B3", "C1", "C2"]);

  /* The diagnosis is listed as rejected, in the user's words and the model's. */
  const said = final.rejected.map((r) => r.said);
  assert.ok(said.includes("he is narcissistic"));
  assert.ok(said.includes("Establishes his underlying narcissism"));
  assert.ok(final.rejected.some((r) => /diagnosis/.test(r.why)));

  /* Every subject beat has a counter beat. */
  const inverted = new Set(final.beats.filter((b) => b.role === "counter").map((b) => b.inverts));
  for (const b of final.beats.filter((b) => b.role === "subject")) {
    assert.ok(inverted.has(b.id), `${b.id} has nothing against it`);
    assert.ok(!b.counterGap);
  }
});

/* ── One regeneration, then a refusal ───────────────────────────────────── */

test("the first pass reports the offence and keeps the beat; the second drops it", () => {
  /*
   * The first pass has to KEEP the bad beat so the regeneration can quote it
   * back — "rewrite B2 without 'narcissism'" produces a behaviour, and
   * "rewrite B2, it was invalid" produces the same beat with a synonym.
   */
  const parsed: Parsed = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Establishes his narcissism")],
      counter: [counter("C1", "B1"), counter("C2", "B2")],
      personas: [],
      rejected: [],
    }),
  );

  const first = validateDecomposition(parsed);
  assert.deepEqual(first.offences, [{ beatId: "B2", phrase: "narcissis", kind: "diagnosis" }]);
  assert.ok(first.beats.some((b) => b.id === "B2"));
  assert.equal(first.rejected.length, 0);

  const second = validateDecomposition(parsed, { final: true });
  assert.ok(!second.beats.some((b) => b.id === "B2"));
  assert.equal(second.rejected.length, 1);
});

test("a counter beat whose subject beat was dropped goes with it", () => {
  /* C2 inverted B2. With B2 rejected, C2 is on the board arguing against an
     absence — and its searches are spent on nothing. */
  const parsed = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Establishes his narcissism")],
      counter: [counter("C1", "B1"), counter("C2", "B2")],
      personas: [],
      rejected: [],
    }),
  );
  const final = validateDecomposition(parsed, { final: true });
  assert.deepEqual(final.beats.map((b) => b.id), ["B1", "C1"]);
});

test("an uncountered subject beat is marked, never dropped", () => {
  /*
   * Dropping it would throw away the user's own case to satisfy a rule about
   * balance, which is backwards. The board shows that nothing was sought
   * against it, which is invariant 4 applied to the other side.
   */
  const parsed = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Shouts at the mods")],
      counter: [counter("C1", "B1")],
      personas: [],
      rejected: [],
    }),
  );

  const first = validateDecomposition(parsed);
  assert.deepEqual(first.offences, [{ beatId: "B2", phrase: "", kind: "uncountered" }]);

  const final = validateDecomposition(parsed, { final: true });
  assert.ok(final.beats.some((b) => b.id === "B2"));
  assert.equal(final.beats.find((b) => b.id === "B2")?.counterGap, true);
  assert.ok(!final.beats.find((b) => b.id === "B1")?.counterGap);
});

test("a counter beat that inverts nothing answers the whole brief", () => {
  /* "The other party's own conduct" is a required counter beat for a
     conflict and it does not invert one beat — it answers all of them. */
  const parsed = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Shouts at the mods")],
      counter: [
        { id: "C1", inverts: "", role: "counter", name: "C1", behaviour: "The other streamer's own conduct", need_min: 1 },
      ],
      personas: [],
      rejected: [],
    }),
  );
  const final = validateDecomposition(parsed, { final: true });
  assert.ok(final.beats.every((b) => !b.counterGap));
});

/* ── Four to eight ─────────────────────────────────────────────────────── */

test("over eight beats, the last uncountered subject beats go and say so", () => {
  /*
   * A cap, not a suggestion: every beat is its own round of four query
   * families. Counter beats cannot be dropped without breaking the counter
   * rule, so the cut comes off the end of the subject list — the model's own
   * order of importance.
   */
  const parsed = parseDecomposition(
    answer({
      beats: [1, 2, 3, 4, 5, 6, 7].map((n) => beat("B" + n, `Bans viewer number ${n} mid-sentence`)),
      counter: [counter("C1", "B1"), counter("C2", "B2"), counter("C3", "B3")],
      personas: [],
      rejected: [],
    }),
  );
  const final = validateDecomposition(parsed, { final: true });
  assert.equal(final.beats.length, MAX_BEATS);
  /* The three countered subject beats and the three counter beats are safe. */
  for (const id of ["B1", "B2", "B3", "C1", "C2", "C3"]) {
    assert.ok(final.beats.some((b) => b.id === id), id);
  }
  /* B7 was asked for last, so B7 goes — and the user is told. */
  assert.ok(!final.beats.some((b) => b.id === "B7"));
  assert.ok(final.rejected.some((r) => /over 8 beats/.test(r.why)));
});

test("fewer than four beats is narrow, not broken", () => {
  /* Some briefs are genuinely about one thing. Inventing beats to reach four
     would send real searches after padding. */
  const parsed = parseDecomposition(
    answer({
      beats: [beat("B1", "Bans a viewer mid-sentence")],
      counter: [counter("C1", "B1")],
      personas: [],
      rejected: [],
    }),
  );
  const final = validateDecomposition(parsed, { final: true });
  assert.equal(final.narrow, true);
  assert.equal(final.beats.length, 2);
});

/* ── The loop ───────────────────────────────────────────────────────────── */

/**
 * A stand-in for the model. Hands back the next prepared answer and records
 * what it was asked, so the regeneration can be inspected — the thing that
 * makes the second round worth paying for is whether it quotes the offending
 * phrase back, and nothing else here can see that.
 */
function fakeAI(answers: unknown[]) {
  const asked: Array<Array<{ role: string; content: string }>> = [];
  const env = {
    AI: {
      run: async (_m: string, input: { messages: Array<{ role: string; content: string }> }) => {
        asked.push(input.messages.map((m) => ({ ...m })));
        const next = answers.shift();
        return {
          response: typeof next === "string" ? next : JSON.stringify(next),
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        };
      },
    },
  } as unknown as Parameters<typeof decompose>[0];
  return { env, asked };
}

const clean = {
  beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Reads the donation out, then stops reading donations")],
  counter: [counter("C1", "B1"), counter("C2", "B2")],
  personas: [{ name: "his own moderator", queries: ["mod perspective on the ban"] }],
  rejected: [],
};

test("a clean first answer costs one call", () => {
  /* The regeneration is not a ritual. An answer that breaks no rule is not
     paid for twice — this is a frontier call per round. */
  const { env, asked } = fakeAI([clean]);
  return decompose(env, { claim: "He treats chat as an enemy." }).then((d) => {
    assert.equal(d.rounds, 1);
    assert.equal(asked.length, 1);
    assert.equal(d.beats.length, 4);
    assert.equal(d.rejected.length, 0);
    assert.equal(d.tokensIn, 100);
    assert.equal(d.tokensOut, 50);
  });
});

test("an offending answer is regenerated once, with the phrase quoted back", async () => {
  /*
   * "Rewrite B2 without 'narcissism'" produces a behaviour. "Rewrite B2, it
   * was invalid" produces the same beat with a synonym. The difference is
   * the whole value of the second call, so the second call's prompt is what
   * is asserted here, not just that there was one.
   */
  const dirty = {
    beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Establishes his narcissism")],
    counter: [counter("C1", "B1"), counter("C2", "B2")],
    personas: [],
    rejected: [],
  };
  const { env, asked } = fakeAI([dirty, clean]);
  const d = await decompose(env, { claim: "He treats chat as an enemy." });

  assert.equal(d.rounds, 2);
  assert.equal(asked.length, 2);

  const retry = asked[1][asked[1].length - 1].content;
  assert.match(retry, /B2/);
  assert.match(retry, /narcissis/);
  assert.match(retry, /Establishes his narcissism/);
  /* And the model is shown its own answer, or it is being asked to fix
     something it cannot see. */
  assert.equal(asked[1][2].role, "assistant");

  /* Both calls are billed. A run that hides the cost of its own retry is how
     a $0.40 run turns into a $0.80 one nobody can account for. */
  assert.equal(d.tokensIn, 200);
  assert.equal(d.tokensOut, 100);

  /* The fixed answer is what comes out. */
  assert.deepEqual(d.beats.map((b) => b.id), ["B1", "B2", "C1", "C2"]);
  for (const b of d.beats) assert.equal(diagnosis(b.behaviour), null, b.behaviour);
});

test("a second offending answer is not asked a third time — it is rejected", async () => {
  /*
   * The spec's rule, and the reason it is a rule: a loop here spends a
   * frontier call per turn arguing with a model about whether narcissism is
   * visible. What survives the second pass is dropped and SHOWN as dropped.
   */
  const dirty = {
    beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Establishes his narcissism")],
    counter: [counter("C1", "B1"), counter("C2", "B2")],
    personas: [],
    rejected: [],
  };
  const stillDirty = {
    ...dirty,
    beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Shows how insecure he is")],
  };
  const { env, asked } = fakeAI([dirty, stillDirty]);
  const d = await decompose(env, { claim: "He treats chat as an enemy." });

  assert.equal(d.rounds, 2);
  assert.equal(asked.length, 2);
  assert.ok(!d.beats.some((b) => b.id === "B2"));
  assert.ok(d.rejected.some((r) => /insecure/.test(r.said)));
  assert.ok(d.rejected.some((r) => /diagnosis/.test(r.why)));
  /* C2 inverted B2 and goes with it rather than arguing against an absence. */
  assert.deepEqual(d.beats.map((b) => b.id), ["B1", "C1"]);
});

test("an empty second answer keeps the first — a fixable list beats no list", async () => {
  /*
   * The regeneration can come back as prose, or as nothing. Taking it would
   * turn two good beats and one bad one into an empty board, which is worse
   * than the problem it was sent to fix.
   */
  const dirty = {
    beats: [beat("B1", "Bans a viewer mid-sentence"), beat("B2", "Establishes his narcissism")],
    counter: [counter("C1", "B1"), counter("C2", "B2")],
    personas: [],
    rejected: [],
  };
  const { env } = fakeAI([dirty, "Sorry, I can't help with that."]);
  const d = await decompose(env, { claim: "He treats chat as an enemy." });

  assert.equal(d.rounds, 2);
  assert.deepEqual(d.beats.map((b) => b.id), ["B1", "C1"]);
  assert.ok(d.rejected.some((r) => /narcissism/.test(r.said)));
});

test("the user's own words and the plan's own beats reach the prompt", async () => {
  /*
   * Invariant 10: the user's own words win where they exist. And the spec:
   * "A plan's existing beats are kept" — Scout does not rewrite what the
   * person already decided, so the model has to be shown it.
   */
  const { env, asked } = fakeAI([clean]);
  await decompose(env, {
    claim: "He treats chat as an enemy.",
    brief: "it's the way he says their names before he bans them",
    existing: [{ id: "B9", role: "subject", name: "The naming", behaviour: "Says the viewer's name, then bans them" }],
    archive: "Four streams of his, recorded off-screen, about eleven hours.",
  });

  const user = asked[0][1].content;
  assert.match(user, /the way he says their names/);
  assert.match(user, /B9 \(subject\) The naming/);
  assert.match(user, /eleven hours/);
  /* And the rule the model has to be told, or it rewrites them. */
  assert.match(user, /keep these, do not rewrite them/);
});

test("the prompt shows the model what a good beat and a bad beat look like", () => {
  /*
   * The validator catches a diagnosis; it cannot teach the model what to
   * write instead, and a rejected beat is a beat the run did not get. The
   * examples are the cheap half of the fix and they are easy to lose in a
   * tidy-up, which is what this pins.
   */
  const { env, asked } = fakeAI([clean]);
  return decompose(env, { claim: "He treats chat as an enemy." }).then(() => {
    const system = asked[0][0].content;
    /* Both halves of the pair. An earlier version of this asserted only the
       Bad example's explanation, so deleting a Good example — the half that
       shows what to write INSTEAD — left the test green. */
    assert.match(system, /Good:\s+\u201cBerates live chat/);
    assert.match(system, /Good:\s+\u201cSays on stream/);
    assert.match(system, /Bad:\s+\u201cEstablishes his narcissism\u201d/);
    assert.match(system, /narcissism is not a thing that\s*\n?\s*happens at a timecode/);
    assert.match(system, /the second is a guess about his head/);
    assert.match(system, /EVERY subject beat gets one/);
    assert.match(system, /Four to eight beats/);
    /* And the floor under invariant 2, one layer up from timestamps. */
    assert.match(system, /Do not name,\s*\n?quote, cite or invent any video, channel, timecode or clip/);
  });
});
