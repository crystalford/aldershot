// Four footage sets, same shape, chosen to be unlike each other.
// Each: sources, moments (tags drive the rules), seed rules, the Read, what the system noticed, and a note on what this set demands of the product.
export const SAMPLES = {
  move: {
    id: "move", name: "Working out whether to move", kind: "Three vlogs · one person, one question", who: "you",
    sources: { A: { name: "Tuesday · kitchen", secs: 2466, color: "#5EB8C9" }, B: { name: "Thursday · the drive", secs: 3150, color: "#5EC98F" }, C: { name: "Sunday · the house", secs: 3898, color: "#B08CD4" } },
    moments: [
      { id: 1, src: "A", ts: "0:00", dur: 38, tags: ["chat"], text: "Okay is this— yeah it's recording. Hi. Give me a second, where was I." },
      { id: 2, src: "A", ts: "6:40", dur: 44, tags: ["core", "strong"], thread: "why leave", text: "I think the honest version is I don't like who I am here. Not the city. Me, in it." },
      { id: 3, src: "A", ts: "14:12", dur: 31, tags: ["core"], thread: "why leave", text: "Every plan I make is a plan to be somewhere else in six months. That's been true for three years." },
      { id: 4, src: "A", ts: "22:15", dur: 36, tags: ["hedge"], thread: "why leave", text: "But I mean, maybe that's just, I don't know, maybe everyone feels like that and it's fine." },
      { id: 6, src: "B", ts: "11:48", dur: 47, tags: ["core"], thread: "what it costs", text: "If I leave, rent halves and I lose everyone I'd call at 2am. That's the actual trade." },
      { id: 7, src: "B", ts: "19:30", dur: 33, tags: ["core"], thread: "what it costs", text: "I keep pricing it in money because the other price is embarrassing to say out loud." },
      { id: 8, src: "B", ts: "27:52", dur: 40, tags: ["core", "house"], thread: "the house", text: "The house has a room that gets sun until four." },
      { id: 10, src: "C", ts: "8:20", dur: 42, tags: ["core"], thread: "what I'd miss", text: "Tuesday nights. Not the people exactly. The version of me that shows up on Tuesday nights." },
      { id: 12, src: "C", ts: "31:20", dur: 39, tags: ["core", "strong"], thread: "what I'd miss", text: "You can't keep a version of yourself alive by visiting it twice a year." },
      { id: 13, src: "C", ts: "44:02", dur: 46, tags: ["strong", "resolve"], thread: "landing it", text: "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made." },
      { id: 14, src: "C", ts: "58:30", dur: 28, tags: ["chat"], text: "Okay that's— I'll stop there. I need to eat something." },
    ],
    tagNames: { chat: "the hellos and mic checks", hedge: "the hedging", house: "the house thread", core: "where you're working it out", strong: "the hard lines", resolve: "where you land it" },
    rules: [
      { id: 1, kind: "keep", tag: "core", on: true, text: "Keep the parts where you're actually working something out." },
      { id: 2, kind: "drop", tag: "chat", on: true, text: "Take out the hellos, the mic checks, the where-was-I." },
      { id: 3, kind: "order", order: "thread", on: true, text: "Run it one thread at a time." },
      { id: 4, kind: "gap", on: true, text: "Leave me twelve seconds to camera at the end of each thread." },
    ],
    read: "You circle one question for two and a half hours — whether to leave — and only answer it once, on Sunday at 44:02.",
    noticed: ["A hum under the whole of Tuesday · kitchen — the fridge, probably. → Clean it up", "Music under Thursday · the drive, 11:48 to 19:30 — the car radio. → Duck it"],
    demands: ["Nothing new — this is the set the product was built on."],
  },

  council: {
    id: "council", name: "Planning committee — the Elm Street decision", kind: "Public meeting · 2h 50m · many speakers", who: "them",
    sources: { M: { name: "Committee meeting · 14 May", secs: 10200, color: "#D9B36A" } },
    moments: [
      { id: 1, src: "M", ts: "0:00", dur: 140, tags: ["procedure"], speaker: "Chair", text: "Good evening. Item one, apologies for absence. Item two, declarations of interest. Councillor Reyes." },
      { id: 2, src: "M", ts: "18:40", dur: 58, tags: ["core", "claim"], speaker: "Officer", text: "The application is for forty-two units, of which twelve would be affordable. That's 28 per cent against the policy requirement of 35." },
      { id: 3, src: "M", ts: "31:12", dur: 72, tags: ["core", "public"], speaker: "Resident, Elm St", text: "I've lived on that street for thirty-one years. The light study they submitted was done in June. Come and stand in my kitchen in December." },
      { id: 4, src: "M", ts: "44:05", dur: 49, tags: ["core", "claim"], speaker: "Applicant's agent", text: "Viability is marginal. At 35 per cent affordable the scheme does not come forward. That isn't a threat, it's arithmetic." },
      { id: 5, src: "M", ts: "58:30", dur: 35, tags: ["crosstalk"], speaker: "several", text: "[two councillors and the chair speaking over each other about whether the viability report was independently assessed]" },
      { id: 6, src: "M", ts: "1:04:10", dur: 64, tags: ["core", "strong"], speaker: "Cllr Okafor", text: "We've approved four schemes in this ward on the promise of affordable units that were renegotiated away within a year. I'd like someone to tell me why this one is different." },
      { id: 7, src: "M", ts: "1:22:48", dur: 41, tags: ["core", "claim"], speaker: "Officer", text: "The viability assessment was reviewed by an independent consultant appointed by the council, and they concurred with the applicant's figures." },
      { id: 8, src: "M", ts: "1:40:00", dur: 600, tags: ["procedure"], speaker: "Chair", text: "[recess — ten minutes]" },
      { id: 9, src: "M", ts: "2:11:30", dur: 55, tags: ["core", "strong"], speaker: "Cllr Reyes", text: "Then we are being asked to choose between forty-two homes with twelve affordable, and no homes. I don't accept that those are the only two options, and I don't think the officer does either." },
      { id: 10, src: "M", ts: "2:38:15", dur: 90, tags: ["core", "resolve"], speaker: "Chair", text: "Those in favour of the officer's recommendation to approve. Six. Against. Five. The application is approved, with the conditions as set out." },
      { id: 11, src: "M", ts: "2:41:00", dur: 30, tags: ["public", "aside"], speaker: "gallery", text: "[audible reaction from the public gallery; chair asks for order]" },
    ],
    tagNames: { procedure: "the procedure — apologies, items, the recess", crosstalk: "the crosstalk", public: "the public speakers", claim: "the claims about numbers", core: "the substance", strong: "the sharpest exchanges", resolve: "the vote", aside: "the gallery" },
    rules: [
      { id: 1, kind: "drop", tag: "procedure", on: true, text: "Take out the procedure — apologies, item numbers, the recess." },
      { id: 2, kind: "keep", tag: "claim", on: true, text: "Keep every claim about the numbers, and who made it." },
      { id: 3, kind: "order", order: "time", on: true, text: "Run it as it happened — this is a record." },
      { id: 4, kind: "label", on: true, text: "Name every speaker on screen the first time they talk." },
    ],
    read: "Eleven speakers, one decision. The argument is about one number — 28 against 35 — and the vote at 2:38 goes six to five.",
    noticed: ["Microphones are shared — three speakers are off-mic for part of what they say. → Lift them", "A 10-minute recess at 1:40 with the camera running. → Cut it", "Crosstalk at 58:30 — nobody is fully audible. → Keep as crosstalk, label it"],
    demands: [
      "Who is speaking. Every moment needs a speaker; the cut needs on-screen names; search needs 'everything Cllr Okafor said'.",
      "Fairness as a rule. 'Keep every claim and who made it' is a different kind of rule from 'drop the hedging' — it protects, it doesn't cut.",
      "Order is not negotiable. 'As it happened' is the only honest order for a record; 'sharpest line first' would be an editorial act and should say so.",
      "Long dead stretches (the recess) and crosstalk are real audio cases the Read must name.",
      "Claims want receipts: the 28% / 35% figures are checkable against a document. The Document block applies to footage you didn't shoot.",
    ],
  },

  stream: {
    id: "stream", name: "Kino Casino #372 — the apology segment", kind: "Someone else's 3h stream · you're reacting", who: "them, then you",
    sources: { K: { name: "Kino Casino #372", secs: 11040, color: "#E06A6A" } },
    moments: [
      { id: 1, src: "K", ts: "0:00", dur: 900, tags: ["dead"], speaker: "host", text: "[starting soon screen, music, chat scrolling — fifteen minutes]" },
      { id: 2, src: "K", ts: "15:20", dur: 120, tags: ["chat"], speaker: "host", text: "Okay we're live, we're live. Shout out to the mods. Let me pull up the thing." },
      { id: 3, src: "K", ts: "22:05", dur: 48, tags: ["core", "claim", "thirdparty"], speaker: "clip (DSP)", text: "[plays a clip of the subject's apology video — 48 seconds, his face, his audio]" },
      { id: 4, src: "K", ts: "22:53", dur: 66, tags: ["core", "strong"], speaker: "host", text: "He says 'if anyone was offended'. That's not an apology, that's a conditional. Count how many times he says 'if'." },
      { id: 5, src: "K", ts: "31:40", dur: 55, tags: ["core", "claim", "thirdparty"], speaker: "clip (DSP)", text: "[second clip — the 2019 stream where he said the opposite — 55 seconds]" },
      { id: 6, src: "K", ts: "32:35", dur: 72, tags: ["core", "strong"], speaker: "host", text: "Same guy. Four years apart. Nothing in between changed except the money ran out." },
      { id: 7, src: "K", ts: "48:10", dur: 420, tags: ["tangent"], speaker: "host", text: "[seven minutes on a different streamer's drama, reading chat]" },
      { id: 8, src: "K", ts: "1:12:00", dur: 40, tags: ["core", "resolve"], speaker: "host", text: "Look — I don't want him to fail. I want him to stop lying about why he's failing. That's the whole channel, honestly." },
      { id: 9, src: "K", ts: "1:30:00", dur: 1800, tags: ["dead"], speaker: "host", text: "[gameplay, no commentary on the subject — thirty minutes]" },
      { id: 10, src: "K", ts: "2:48:30", dur: 35, tags: ["chat", "aside"], speaker: "host", text: "Alright, raid time. Where are we going. Thanks for hanging out." },
    ],
    tagNames: { dead: "the dead air — starting-soon, gameplay", chat: "the hellos and raid-outs", tangent: "the tangents", thirdparty: "the clips that aren't yours", claim: "the clips being reacted to", core: "the substance", strong: "the hard lines", resolve: "where he lands it", aside: "the sign-off" },
    rules: [
      { id: 1, kind: "drop", tag: "dead", on: true, text: "Take out the dead air — the starting-soon screen and the gameplay." },
      { id: 2, kind: "drop", tag: "tangent", on: true, text: "Take out the tangents that aren't about the subject." },
      { id: 3, kind: "pair", on: true, text: "Keep each clip he reacts to together with the reaction — never one without the other." },
      { id: 4, kind: "order", order: "time", on: true, text: "Run it as it happened." },
    ],
    read: "Three hours of stream, eleven minutes about the subject. Two third-party clips, each answered. The line is at 1:12:00.",
    noticed: ["Two clips are someone else's footage — 48s and 55s with their original audio. → Attribute at first use, log for the dispute file", "Copyrighted music under the starting-soon screen. → It's in the dead air; cutting it removes the problem", "Chat overlay burned into the frame. → Crop it, or keep it as context"],
    demands: [
      "Pairing as a rule. Clip-plus-reaction is a unit; cutting one orphans the other. Shorts mode has to respect it too.",
      "Third-party footage is the point, not an exception. Before-you-post's 'third-party clips' check becomes the main event: attribution, duration-per-clip, the dispute file.",
      "Dead air at scale — 45 of 184 minutes is nothing. The Read should lead with that number, not with themes.",
      "The host's words are the narration already. No voiceover to record; the 'script' is his transcript, cut.",
      "Shorts here are pairs: 48s clip + 20s reaction = 68s — over any shorts length. The length rule needs to know about pairs or the whole set fails it.",
    ],
  },

  lecture: {
    id: "lecture", name: "Week 7 — Why the Weimar hyperinflation happened", kind: "One lecture · 1h 48m · slides + one voice", who: "you, teaching",
    sources: { L: { name: "Lecture 7 · recording", secs: 6480, color: "#5EB8C9" }, S: { name: "Lecture 7 · slides.pdf", secs: 0, color: "#B08CD4" } },
    moments: [
      { id: 1, src: "L", ts: "0:00", dur: 190, tags: ["chat", "admin"], text: "Can everyone hear me at the back? Good. Reminder: the essay is due Friday, not Monday. I know. I know." },
      { id: 2, src: "L", ts: "4:10", dur: 85, tags: ["core", "claim"], slide: 3, text: "The standard story is that Germany printed money to pay reparations. That story is about forty per cent right, and the forty per cent is the boring part." },
      { id: 3, src: "L", ts: "12:30", dur: 120, tags: ["core", "def"], slide: 5, text: "Let's define the thing. Hyperinflation, by the Cagan definition, is prices rising more than fifty per cent a month. Germany in October 1923: twenty-nine thousand per cent." },
      { id: 4, src: "L", ts: "26:00", dur: 60, tags: ["question"], text: "[student question, inaudible] — Yes. Good question. So the question is whether the Ruhr occupation was cause or trigger." },
      { id: 5, src: "L", ts: "27:00", dur: 140, tags: ["core", "strong"], slide: 9, text: "The Ruhr occupation is the trigger. The cause is older: a state that had decided in 1914 that it would pay for the war with victory, and then didn't win." },
      { id: 6, src: "L", ts: "45:20", dur: 300, tags: ["example"], slide: 12, text: "[the wheelbarrow photograph; the story of the woman whose basket was stolen and the money left behind; the price of a loaf by week]" },
      { id: 7, src: "L", ts: "58:00", dur: 45, tags: ["aside"], text: "Sorry — the slide's frozen. Give me a moment. There we go. Where was I. The loaf." },
      { id: 8, src: "L", ts: "1:10:00", dur: 160, tags: ["core", "claim"], slide: 15, text: "The Rentenmark worked not because it was backed by land — that was theatre — but because people decided to believe it. Which is the uncomfortable lesson about all money." },
      { id: 9, src: "L", ts: "1:38:00", dur: 110, tags: ["core", "resolve"], slide: 18, text: "So: printing was the mechanism, the war debt was the cause, the Ruhr was the trigger, and belief was the cure. Four different things. The exam will ask you to keep them apart." },
      { id: 10, src: "L", ts: "1:44:00", dur: 240, tags: ["admin", "chat"], text: "Reading for next week is on the portal. Friday. The essay is due Friday." },
    ],
    tagNames: { chat: "the hellos", admin: "the admin — deadlines, the portal", question: "the student questions", def: "the definitions", example: "the examples and stories", claim: "the claims", aside: "the frozen slide", core: "the teaching", strong: "the key lines", resolve: "the summary" },
    rules: [
      { id: 1, kind: "drop", tag: "admin", on: true, text: "Take out the admin — deadlines, the portal, the reminders." },
      { id: 2, kind: "keep", tag: "def", on: true, text: "Keep every definition in full." },
      { id: 3, kind: "order", order: "time", on: true, text: "Run it in order — the argument builds." },
      { id: 4, kind: "slide", on: true, text: "Show the slide I was on whenever I'm talking to it." },
      { id: 5, kind: "cap", secs: 1200, on: true, text: "Keep it under twenty minutes." },
    ],
    read: "One argument in four parts — mechanism, cause, trigger, cure — built over 108 minutes and summarised once at 1:38. Eighteen slides; you talk to eleven of them.",
    noticed: ["Student questions are inaudible — only your repeat of them survives. → Keep your repeat, drop the silence", "The slide froze at 58:00 for 45 seconds. → Cut it", "Room echo throughout. → Clean it"],
    demands: [
      "A second source that isn't video. Slides are a document with pages; 'show the slide I was on' needs a page-to-time map and a new block type.",
      "A hard length cap that forces a hierarchy: 108 → 20 minutes means choosing definitions and claims over examples. The rule engine needs 'keep in full' vs 'keep if room'.",
      "Inaudible questions are a common audio case: the repeat is the content.",
      "Chaptering, not shorts. A lecture wants chapters with titles (the four parts) more than vertical clips.",
      "This is the one set where the model writing the lines from your words is clearly right — a 20-minute version needs bridges you never said.",
    ],
  },
};

export const ORDERS = { thread: "one thread at a time", time: "as it happened", open: "sharpest line first" };

// The same rule engine the editor uses, reduced to what the four sets share.
export function compute(sample, rules) {
  const on = rules.filter(r => r.on);
  const hit = (r, c) => (r.tag && c.tags.indexOf(r.tag) >= 0) || (r.cid && c.id === r.cid);
  const kept = [], out = [];
  sample.moments.forEach(c => {
    const drop = on.find(r => r.kind === "drop" && hit(r, c)), keep = on.find(r => r.kind === "keep" && hit(r, c));
    if (drop && !keep) out.push({ c, why: "out by “" + drop.text + "”" });
    else kept.push(c);
  });
  const order = (on.find(r => r.kind === "order") || {}).order || "time";
  let rows = kept.slice();
  if (order === "thread") rows.sort((a, b) => (a.thread || "").localeCompare(b.thread || "") || a.id - b.id);
  if (order === "open") { const i = rows.findIndex(c => c.tags.indexOf("strong") >= 0); if (i > 0) rows.unshift(rows.splice(i, 1)[0]); }
  const cap = on.find(r => r.kind === "cap");
  let secs = rows.reduce((n, c) => n + c.dur, 0);
  if (cap && secs > cap.secs) {
    // keep-in-full rules protect; everything else goes longest-example-first until it fits
    const protectedBy = c => on.some(r => r.kind === "keep" && hit(r, c));
    const victims = rows.filter(c => !protectedBy(c) && c.tags.indexOf("resolve") < 0).sort((a, b) => b.dur - a.dur);
    for (const v of victims) { if (secs <= cap.secs) break; rows = rows.filter(c => c !== v); out.push({ c: v, why: "over the cap — " + fmt(v.dur) + " of example, not protected by a keep" }); secs -= v.dur; }
  }
  return { rows, out, secs, order };
}
export const fmt = n => Math.floor(n / 60) + ":" + String(Math.round(n) % 60).padStart(2, "0");
