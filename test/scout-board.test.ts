/**
 * THE SCOUT BOARD, built against the rendered prototype.
 *
 * `docs/labs/Scout.dc.html`, driven to its populated state and looked at,
 * because CLAUDE.md's precedence order puts the rendered thing above the
 * handoff — and this is the surface where that mattered most. The handoff
 * says the board has "VERIFIED / CROWD / TRACE rows". The rendered board has
 * six row chips, two meters, and a gap block the handoff never describes the
 * shape of.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCENT, C } from "../src/ui/tokens.ts";
import {
  ACQ_CHIP,
  ACQ_STATES,
  CROWD_CHIP,
  ROLE_CHIP,
  ROUTE_CHIP,
  atTime,
  balanceMeter,
  beatStatus,
  gapsOf,
  renderBoard,
  sourcedMeter,
  type BoardBeat,
  type BoardData,
  type BoardRow,
} from "../src/ui/pages/board.ts";

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  kind: "verified",
  acq: "owned",
  route: "yours",
  text: "I know the door is there. I have eyes. stop",
  tS: 13275,
  sourceName: "Your capture",
  host: "You",
  credit: "no credit needed — your own capture",
  ...over,
});

const beat = (over: Partial<BoardBeat> = {}): BoardBeat => ({
  id: "B1",
  name: "The pattern",
  role: "subject",
  behaviour: "Berates live chat during streams; addresses chat as an adversary",
  needMin: 2,
  rows: [row(), row({ text: "you people are the reason I don't read chat anymore" })],
  queriesTried: 12,
  ...over,
});

const board = (over: Partial<BoardData> = {}): BoardData => ({
  verifiedMoments: 8,
  crowdRows: 4,
  beats: [beat()],
  stopped: true,
  sourcesRead: 2,
  sourcesLinkOnly: 4,
  candidatesScanned: 10,
  ...over,
});

/* ── What the handoff gets wrong ────────────────────────────────────────── */

test("ACCEPTANCE: a verified row's chip is its acquisition state, not the word VERIFIED", () => {
  /*
   * THE FINDING FROM RENDERING IT. The handoff says "VERIFIED / CROWD / TRACE
   * rows" and the board has six acquisition chips, because the difference
   * between a row you can cut today and a row that needs twenty minutes of
   * your time is the only thing a person is deciding between. One word on all
   * six hides exactly that.
   */
  assert.deepEqual([...ACQ_STATES], ["owned", "scouted", "mission", "fetching", "matching", "verified"]);
  assert.equal(ACQ_CHIP.owned.label, "YOURS");
  assert.equal(ACQ_CHIP.scouted.label, "SCOUTED");
  assert.equal(ACQ_CHIP.mission.label, "MISSION");
  assert.equal(ACQ_CHIP.verified.label, "ACQUIRED · VERIFIED");

  /* No chip anywhere is the bare word. */
  const every = [...Object.values(ACQ_CHIP), ...Object.values(CROWD_CHIP), ...Object.values(ROUTE_CHIP)];
  assert.ok(!every.some((c) => c.label === "VERIFIED"), JSON.stringify(every.map((c) => c.label)));

  /* And the colours carry the meaning the design system gives them: green is
     in hand, gold is something for you to do, cyan is in flight. */
  assert.equal(ACQ_CHIP.owned.color, ACCENT.green);
  assert.equal(ACQ_CHIP.verified.color, ACCENT.green);
  assert.equal(ACQ_CHIP.mission.color, ACCENT.gold);
  assert.equal(ACQ_CHIP.fetching.color, ACCENT.cyan);
  assert.equal(ACQ_CHIP.matching.color, ACCENT.cyan);
  /* Scouted is ink, not an accent: nothing has happened yet, and a colour
     would say something had. */
  assert.equal(ACQ_CHIP.scouted.color, C.ink45);
});

test("the route is a different question from the state, and has its own chip", () => {
  /*
   * Where the footage IS, against how it would ARRIVE. A scouted row on a
   * podcast feed and a scouted row on YouTube are the same state and
   * completely different asks — one is a fetch, the other is twenty minutes
   * of the user's afternoon.
   */
  assert.equal(ROUTE_CHIP.yours.label, "ALREADY YOURS");
  assert.equal(ROUTE_CHIP.feed.label, "AUTO · open feed");
  assert.equal(ROUTE_CHIP.mission.label, "MISSION · you grab it");
  assert.equal(ROUTE_CHIP.mission.color, ACCENT.gold, "the one that costs the user time is the gold one");
  assert.equal(ROUTE_CHIP.feed.color, ACCENT.green);
});

test("TRACE and CROWD are the two unreadable kinds, and they are not the same", () => {
  /* A crowd row is a place fans point at. A trace is a compilation whose
     original has not been found — a hole in the provenance chain rather than
     an unread source. */
  assert.equal(CROWD_CHIP.crowd.label, "CROWD");
  assert.equal(CROWD_CHIP.crowd.color, ACCENT.cyan);
  assert.equal(CROWD_CHIP.trace.label, "TRACE");
  assert.equal(CROWD_CHIP.trace.color, ACCENT.gold);
});

test("the roles are the prototype's three, with COUNTERPOINT spelt out", () => {
  assert.equal(ROLE_CHIP.subject.label, "SUBJECT");
  assert.equal(ROLE_CHIP.counter.label, "COUNTERPOINT");
  assert.equal(ROLE_CHIP.context.label, "CONTEXT");
});

/* ── The two meters ─────────────────────────────────────────────────────── */

test("ACCEPTANCE: there are two meters, and they answer different questions", () => {
  /*
   * The handoff names one. SOURCED says how much of what was found can
   * actually be read — the number that decides whether a run produced
   * evidence or a reading list. BALANCE says subject against counter. A board
   * with one of them answers half.
   */
  /*
   * SOURCED IS OVER ROWS, NOT OVER SOURCES, and it took reading the
   * prototype's source rather than its screenshot to get that right: the
   * first version here compared verified MOMENTS against sources FOUND,
   * which are different units. Crowd rows are in the denominator because a
   * board counting only what it could read would score full marks having
   * read one thing and linked forty.
   */
  const mixed = [
    beat({
      rows: [
        row({ acq: "owned" }),
        row({ acq: "verified" }),
        row({ kind: "crowd", acq: "mission", route: "mission" }),
        row({ kind: "crowd", acq: "scouted", route: "mission" }),
      ],
    }),
  ];
  const sourced = sourcedMeter(mixed);
  assert.equal(sourced.label, "SOURCED");
  assert.equal(sourced.text, "2 of 4 verified");
  assert.equal(sourced.pct, 50);
  /* And the second, dimmer segment is the one out on a mission — neither in
     hand nor a dead end, which a single bar would have to call one or other. */
  assert.equal(sourced.pending, 25);

  const balance = balanceMeter([
    beat({ id: "B1", role: "subject", rows: [row(), row(), row(), row()] }),
    beat({ id: "C1", role: "counter", rows: [row(), row(), row()] }),
  ]);
  assert.equal(balance.label, "BALANCE");
  assert.equal(balance.text, "4 · 3");
});

test("ACCEPTANCE: no percentage about somebody's footage reaches a person", () => {
  /*
   * Invariant 3. The bar has a width because something has to be drawn; the
   * TEXT is counts of things. "42% sourced" is a number about a person's
   * conduct and is exactly what the invariant forbids.
   */
  const sourced = sourcedMeter([beat()]);
  const balance = balanceMeter([beat({ role: "subject" }), beat({ id: "C1", role: "counter", rows: [row()] })]);
  for (const m of [sourced, balance]) {
    assert.ok(!/%/.test(m.text), m.text);
    assert.ok(!/\d+\.\d/.test(m.text), m.text);
  }
  const html = renderBoard(board());
  assert.ok(!/>\s*\d+%\s*</.test(html), "a percentage is rendered as text somewhere");
});

test("a run with nothing found shows a dash, not a zero", () => {
  /* "0 of 0 verified" reads as a failure; a dash reads as not yet. */
  assert.equal(sourcedMeter([]).text, "—");
  assert.equal(balanceMeter([]).text, "—");
  assert.equal(sourcedMeter([]).pct, 0);
  assert.equal(sourcedMeter([beat({ rows: [] })]).text, "—");
});

test("ACCEPTANCE: a case with no other side turns the balance meter gold", () => {
  /*
   * Green would say it was fine. An argument with no counterpoint is the one
   * thing on this board a person most needs to see, and the accent that means
   * "something for you to do" is gold.
   */
  const oneSided = balanceMeter([beat({ role: "subject", rows: [row(), row(), row()] })]);
  assert.equal(oneSided.text, "3 · 0");
  assert.equal(oneSided.color, ACCENT.gold);

  const balanced = balanceMeter([beat({ role: "subject" }), beat({ id: "C1", role: "counter", rows: [row()] })]);
  assert.equal(balanced.color, ACCENT.green);
});

test("crowd rows do not count towards the balance", () => {
  /* They are places nobody has read. Counting them would let a run claim an
     other side it never verified. */
  const m = balanceMeter([
    beat({ role: "subject", rows: [row()] }),
    beat({ id: "C1", role: "counter", rows: [row({ kind: "crowd", acq: "scouted", route: "mission" })] }),
  ]);
  assert.equal(m.text, "1 · 0");
  assert.equal(m.color, ACCENT.gold);
});

/* ── Gaps ───────────────────────────────────────────────────────────────── */

test("ACCEPTANCE: a gap is only a gap once the run has stopped", () => {
  /*
   * The prototype gates it on the run reaching its last step. A beat that is
   * short mid-run is still being worked, and calling it a gap tells the user
   * something is missing when nobody has finished looking — the same
   * confusion between the stopping rule and the completion invariant that
   * src/scout-run.ts exists to keep apart.
   */
  const short = board({ beats: [beat({ rows: [row()] })], stopped: false });
  assert.deepEqual(gapsOf(short), []);
  assert.deepEqual(gapsOf({ ...short, stopped: true }).map((g) => g.beatId), ["B1"]);
});

test("ACCEPTANCE: a gap says what was tried, so you can tell the two cases apart", () => {
  /*
   * The prototype's own line: "Each says what was tried, so you can tell
   * 'doesn't exist' from 'not found yet'." A gap with no query count is a
   * complaint.
   */
  const [short] = gapsOf(board({ beats: [beat({ rows: [row()], queriesTried: 12 })] }));
  assert.match(short.why, /Only 1 verified; wanted 2/);
  assert.match(short.why, /12 queries tried/);

  const [nothing] = gapsOf(board({ beats: [beat({ rows: [], queriesTried: 9 })] }));
  assert.match(nothing.why, /9 queries tried, nothing verified/);
  assert.match(nothing.why, /doesn't exist or it isn't where these families look/);
});

test("a beat the crowd points at reads differently from one nobody found", () => {
  /*
   * Because what the user does next differs: bring the capture, or try an
   * interview. One sentence for both would make the board's three action
   * buttons arbitrary.
   */
  const [crowdy] = gapsOf(
    board({
      beats: [beat({ rows: [row({ kind: "crowd", acq: "scouted", route: "mission" })] })],
    }),
  );
  assert.match(crowdy.why, /the crowd points at 1 stretch on sources Scout can't read/);
  assert.match(crowdy.why, /Bring the capture and it'll verify them/);
});

test("the gap block carries the prototype's own explanation", () => {
  const html = renderBoard(board({ beats: [beat({ rows: [] })] }));
  assert.match(html, /GAPS · 1/);
  /* Literal apostrophes: this sentence is the product's own copy, not
     anything a user typed, so it is not run through `esc`. */
  assert.match(html, /what's missing comes first/);
  assert.match(html, /&ldquo;doesn't exist&rdquo;/);
  assert.match(html, /&ldquo;not found yet&rdquo;/);
  /* And the three things a person can do about a hole. */
  for (const action of ["Try an interview", "Bring the capture", "Your voice"]) {
    assert.ok(html.includes(action), action);
  }
});

test("ACCEPTANCE: beats with a gap come first", () => {
  /*
   * The prototype's order, and not a choice: a board in beat order opens on
   * whatever the first beat happened to be, and the thing a person has to act
   * on is forty rows down.
   */
  const html = renderBoard(
    board({
      beats: [
        beat({ id: "B1", name: "Covered beat" }),
        beat({ id: "B2", name: "Empty beat", rows: [] }),
        beat({ id: "B3", name: "Another covered" }),
      ],
    }),
  );
  /* The gap block is above every beat. */
  assert.ok(html.indexOf("GAPS ·") < html.indexOf("Covered beat"));

  /*
   * AND AMONG THE BEATS — measured AFTER the gap block, which also contains
   * the short beat's name. An earlier version searched the whole document, so
   * the gap block satisfied the assertion on its own and the beat order was
   * never tested at all.
   */
  const beatsOnly = html.slice(html.indexOf("Covered beat") > -1 ? html.indexOf("</section>") : 0);
  const afterGaps = html.slice(html.indexOf("GAPS ·") >= 0 ? html.indexOf("</section>") + 10 : 0);
  assert.ok(
    afterGaps.indexOf("Empty beat") < afterGaps.indexOf("Covered beat"),
    "the beat with a gap must come before the covered ones",
  );
  assert.ok(beatsOnly.length > 0);
});

test("a gap is repeated under its own beat", () => {
  /* The block at the top is the list of what to do next; this is the
     explanation where the evidence is thin, and a reader scrolling the beats
     should not have to go back up for it. */
  const html = renderBoard(board({ beats: [beat({ rows: [row()] })] }));
  assert.ok((html.match(/Only 1 verified; wanted 2/g) ?? []).length >= 2);
  assert.match(html, />GAP</);
});

/* ── The per-beat count ─────────────────────────────────────────────────── */

test("ACCEPTANCE: a short beat counts in red, a covered one in green", () => {
  /* Mid-run it says what is happening instead, in grey — because "0 of 2" in
     red on a run still searching is an alarm about nothing. */
  assert.deepEqual(beatStatus(beat(), true), { text: "2 verified", color: ACCENT.green });
  assert.deepEqual(beatStatus(beat({ rows: [row()] }), true), { text: "1 of 2", color: ACCENT.red });

  assert.deepEqual(beatStatus(beat({ rows: [] }), false), { text: "searching", color: C.ink45 });
  assert.deepEqual(
    beatStatus(beat({ rows: [row({ kind: "crowd", acq: "scouted", route: "mission" })] }), false),
    { text: "1 crowd", color: C.ink45 },
  );
});

/* ── Rows ───────────────────────────────────────────────────────────────── */

test("a verified row is quoted; a crowd row is described", () => {
  /*
   * A quote is words somebody said, checked against the recording. A crowd
   * row is a description of a place — putting quotation marks round it would
   * present an unverified note as evidence.
   */
  const html = renderBoard(
    board({
      beats: [
        beat({
          rows: [
            row({ text: "get out of my chat" }),
            row({
              kind: "crowd",
              acq: "scouted",
              route: "mission",
              text: "3 comments cite this timestamp for “he reads the hate thread live”",
            }),
          ],
        }),
      ],
    }),
  );
  assert.match(html, /&ldquo;get out of my chat&rdquo;/);
  assert.match(html, /font-style:italic/);
  /*
   * AND THE CROWD ROW IS NOT IN QUOTATION MARKS. An earlier version checked
   * only that the verified quote was quoted and that italics existed
   * somewhere, which is satisfied with the crowd row quoted too — and a
   * quoted description presents an unverified note as evidence.
   */
  assert.ok(
    !/&ldquo;3 comments cite this timestamp/.test(html),
    "a crowd row must not be presented in quotation marks",
  );
});

test("ACCEPTANCE: a verified row carries its context, which is what makes it checkable", () => {
  /*
   * Spec 3.6 step 4, and its parenthesis says why: "the provocation before
   * the outburst". A quote can be accurate and unfair, and a board that
   * showed the quote alone would be the accurate half.
   */
  const html = renderBoard(
    board({
      beats: [
        beat({
          rows: [row({ before: "three viewers type the door in a row", after: "he finds the door thirty seconds later" })],
        }),
      ],
    }),
  );
  assert.match(html, /−30 s/);
  assert.match(html, /\+30 s/);
  assert.match(html, /three viewers type the door in a row/);
  assert.match(html, /he finds the door thirty seconds later/);
});

test("every row says where it came from, and what credit it needs", () => {
  /* Invariant 4: every claim keeps its receipt. A row with no source is a
     quote with nothing behind it. */
  const html = renderBoard(
    board({
      beats: [
        beat({
          rows: [
            row({
              sourceName: "The Backseat Show",
              host: "Podcast RSS",
              tS: 1868,
              credit: "Source: The Backseat Show · Podcast RSS · Mar 2024",
            }),
          ],
        }),
      ],
    }),
  );
  /*
   * THE SOURCE LINE AND THE CREDIT ARE TWO DIFFERENT LINES. An earlier
   * version asserted only that "The Backseat Show" appeared somewhere, which
   * the credit satisfies on its own — so deleting the source-and-time line
   * changed nothing.
   */
  assert.match(html, /The Backseat Show · 31:08 &nbsp;Podcast RSS/);
  assert.match(html, /Source: The Backseat Show · Podcast RSS · Mar 2024/);
});

test("a crowd row offers a mission, not an attach", () => {
  /* There is nothing to attach — nobody has read it. Offering Attach would
     put an unverified note into a cut. */
  const crowdOnly = renderBoard(
    board({ beats: [beat({ rows: [row({ kind: "crowd", acq: "scouted", route: "mission" })] })] }),
  );
  assert.match(crowdOnly, /Make it a mission/);
  assert.ok(!/>Attach</.test(crowdOnly), "a crowd row must not offer Attach");

  const verified = renderBoard(board());
  assert.match(verified, />Attach</);
});

test("a deep link says the time it opens at", () => {
  /* "Open" alone is a link to a three-hour stream. The time is what makes it
     a citation. */
  assert.equal(atTime(13275), "3:41:15");
  assert.equal(atTime(400), "6:40");
  assert.equal(atTime(0), "0:00");
  assert.equal(atTime(-5), "0:00");
  assert.equal(atTime(59.6), "1:00");
  assert.match(renderBoard(board()), /Open at 3:41:15/);
});

/* ── The whole thing ────────────────────────────────────────────────────── */

test("the empty board explains what Scout does, and promises no diagnosis", () => {
  /*
   * The prototype's own copy. "never a diagnosis" is on the empty state
   * because it is the thing a person is most likely to type and the thing
   * decompose will refuse.
   */
  const html = renderBoard(board({ beats: [], verifiedMoments: 0, crowdRows: 0 }));
  assert.match(html, /no brief run yet/);
  assert.match(html, /things a viewer could point to on camera/);
  assert.match(html, /never a diagnosis/);
  /* And no gap block on an empty board: nothing has been tried. */
  assert.ok(!/GAPS ·/.test(html));
});

test("the footer is the diligence line", () => {
  /*
   * Spec section 4: "A diligence log export: queries run, sources examined,
   * counterpoints sought, rejections. Part of the dispute file." This is its
   * summary, and it is the sentence that says a gap was looked for.
   */
  const html = renderBoard(board());
  assert.match(html, /Searched: 2 sources read/);
  assert.match(html, /4 link only/);
  assert.match(html, /10 candidates scanned, 8 verified/);
  assert.match(html, /the ledger/);
});

test("the header counts what is on the board, and says whether it stopped", () => {
  const working = renderBoard(board({ stopped: false }));
  assert.match(working, /8 verified moments · 4 crowd-indexed, link only · 1 beat · working/);

  const done = renderBoard(board());
  assert.match(done, /stopped at saturation/);
});

test("nothing a user typed is rendered unescaped", () => {
  /* A beat's name and a quote both come from a model reading somebody else's
     footage. */
  const html = renderBoard(
    board({
      beats: [
        beat({
          name: "<script>alert(1)</script>",
          behaviour: "a & b",
          rows: [row({ text: "</div><img onerror=alert(1)>", sourceName: "a<b" })],
        }),
      ],
    }),
  );
  assert.ok(!/<script>/.test(html));
  assert.ok(!/<img onerror/.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

/* ── The ghosts in this cut ─────────────────────────────────────────────── */

const ghost = (over: Partial<NonNullable<BoardData["ghosts"]>[number]> = {}) => ({
  ledgerId: "L1",
  quote: "give me five dollars",
  inS: 754,
  url: "https://www.youtube.com/watch?v=v1&t=754s",
  state: "scouted",
  ...over,
});

test("the board says what this cut is carrying that is not footage", () => {
  const html = renderBoard(board({ ghosts: [ghost()] }));
  assert.match(html, /1 ghost in this cut/);
  /* The link at the in-point IS the product here: invariant 9 means we do
     not fetch it, so the only move available is the place and the time. */
  assert.match(html, /open at 12:34/);
  assert.match(html, /t=754s/);
});

test("a ghost that has been grabbed is not still owed", () => {
  const html = renderBoard(board({ ghosts: [ghost({ state: "matched" })] }));
  assert.doesNotMatch(html, /ghost in this cut/, "match-back is what closes it");
});

test("a cut with no ghosts says nothing about ghosts", () => {
  assert.doesNotMatch(renderBoard(board()), /ghost/);
  assert.doesNotMatch(renderBoard(board({ ghosts: [] })), /ghost/);
});

test("a find with no link says so rather than offering a dead one", () => {
  const html = renderBoard(board({ ghosts: [ghost({ url: null })] }));
  assert.match(html, /no link/);
  assert.doesNotMatch(html, /open at/);
});

test("over an hour in, the clock keeps its hours", () => {
  const html = renderBoard(board({ ghosts: [ghost({ inS: 7_438 })] }));
  /* 2:03:58 — a Twitch VOD timestamp, which 123:58 would be read as wrong. */
  assert.match(html, /open at 2:03:58/);
});
