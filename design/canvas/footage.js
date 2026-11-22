// The one footage file. Home and the Editor both read from here — same moments, same rules, same engine.
export const SRC = {
  A: { name: "Tuesday · kitchen", secs: 2466, color: "#5EB8C9", f: 1 },
  B: { name: "Thursday · the drive", secs: 3150, color: "#5EC98F", f: 3 },
  C: { name: "Sunday · the house", secs: 3898, color: "#B08CD4", f: 5 },
};
export const STRANDS = ["why leave", "what it costs", "the house", "what I'd miss", "landing it"];
export const CLIPS = [
  { id: 1,  src: "A", ts: "0:00",  dur: 38, tags: ["chat"], text: "Okay is this— yeah it's recording. Hi. Give me a second, where was I." },
  { id: 2,  src: "A", ts: "6:40",  dur: 44, tags: ["core", "strong"], strand: "why leave", text: "I think the honest version is I don't like who I am here. Not the city. Me, in it." },
  { id: 3,  src: "A", ts: "14:12", dur: 31, tags: ["core"], strand: "why leave", text: "Every plan I make is a plan to be somewhere else in six months. That's been true for three years." },
  { id: 4,  src: "A", ts: "22:15", dur: 36, tags: ["hedge"], strand: "why leave", text: "But I mean, maybe that's just, I don't know, maybe everyone feels like that and it's fine." },
  { id: 5,  src: "B", ts: "3:05",  dur: 29, tags: ["chat"], text: "Sorry, the mic's on the dash — if it rattles, that's why." },
  { id: 6,  src: "B", ts: "11:48", dur: 47, tags: ["core"], strand: "what it costs", text: "If I leave, rent halves and I lose everyone I'd call at 2am. That's the actual trade. Say it plainly." },
  { id: 7,  src: "B", ts: "19:30", dur: 33, tags: ["core"], strand: "what it costs", text: "I keep pricing it in money because the other price is embarrassing to say out loud." },
  { id: 8,  src: "B", ts: "27:52", dur: 40, tags: ["core", "house"], strand: "the house", text: "The house has a room that gets sun until four. I've thought about that room more than I've thought about the job." },
  { id: 9,  src: "B", ts: "36:10", dur: 35, tags: ["core", "house"], strand: "the house", text: "Mum keeps sending photos of it like it's already mine." },
  { id: 10, src: "C", ts: "8:20",  dur: 42, tags: ["core"], strand: "what I'd miss", text: "Tuesday nights. Not the people exactly. The version of me that shows up on Tuesday nights." },
  { id: 11, src: "C", ts: "17:45", dur: 30, tags: ["hedge"], strand: "what I'd miss", text: "I don't know. I don't know. This is probably a bad idea to think about on camera." },
  { id: 12, src: "C", ts: "31:20", dur: 39, tags: ["core", "strong"], strand: "what I'd miss", text: "You can't keep a version of yourself alive by visiting it twice a year." },
  { id: 13, src: "C", ts: "44:02", dur: 46, tags: ["strong", "resolve"], strand: "landing it", text: "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made." },
  { id: 14, src: "C", ts: "58:30", dur: 28, tags: ["chat"], text: "Okay that's— I'll stop there. I need to eat something." },
];
export const TAGNAME = { chat: "the hellos and mic checks", hedge: "the hedging — the “I don't know”s", house: "the house thread", resolve: "where you land it", strong: "the hard lines", core: "the parts where you're working something out" };
export const ORDERS = {
  strand: { name: "one thread at a time", why: "Each question gets asked and answered before the next one starts." },
  time:   { name: "as it happened", why: "Tuesday, Thursday, Sunday — you watch the decision arrive." },
  open:   { name: "sharpest line first", why: "Start on the line that hurts, then earn it." },
};
export const SEED = [
  { id: 1, kind: "keep", tag: "core", on: true, text: "Keep the parts where you're actually working something out." },
  { id: 2, kind: "drop", tag: "chat", on: true, text: "Take out the hellos, the mic checks, the where-was-I." },
  { id: 3, kind: "order", order: "strand", on: true, text: "Run it one thread at a time." },
  { id: 4, kind: "gap", on: true, text: "Leave me twelve seconds to camera at the end of each thread." },
];
export const tsS = ts => { const [m, s] = ts.split(":").map(Number); return m * 60 + s; };
export const fmt = n => Math.floor(n / 60) + ":" + String(Math.round(n) % 60).padStart(2, "0");
export const byTime = (a, b) => a.src.localeCompare(b.src) || tsS(a.ts) - tsS(b.ts);
export const frameFor = (c, set) => { const S = (set && set.SRC) || SRC; return "../assets/frame-" + (((((S[c.src] || {}).f || 1) - 1 + (c.id % 2)) % 6) + 1) + ".png"; };
// A footage set is { SRC, CLIPS, STRANDS }. The sample is the default; a project may carry its own.
export const SAMPLE = { SRC, CLIPS, STRANDS };
export const stub = c => !c ? "" : c.text.length > 56 ? c.text.slice(0, 56).replace(/\s+\S*$/, "") + "…" : c.text;

// rules → cut. struck: {clipId: {wordIndex: true}}; inserts: [{id, kind, after, cid}]; beatMode: {rowKey: "over"}; scope: one source letter or null.
export function compute(rules, struck = {}, inserts = [], beatMode = {}, scope = null, set = null) {
  const CL = (set && set.CLIPS) || CLIPS, STR = (set && set.STRANDS) || STRANDS;
  const on = rules.filter(r => r.on), hit = (r, c) => (r.tag && c.tags.indexOf(r.tag) >= 0) || (r.cid && c.id === r.cid) || (r.cids && r.cids.indexOf(c.id) >= 0);
  const st = CL.filter(c => !scope || c.src === scope).map(c => ({ ...c, in: false, byId: null, dropId: null }));
  on.filter(r => r.kind === "keep" && !r.hand).forEach(r => st.forEach(c => { if (hit(r, c)) { c.in = true; c.byId = r.id; c.dropId = null; } }));
  on.filter(r => r.kind === "drop" && !r.hand).forEach(r => st.forEach(c => { if (hit(r, c)) { if (c.in && c.byId) c.contest = { k: c.byId, d: r.id }; c.in = false; c.dropId = r.id; } }));
  on.filter(r => r.kind === "keep" && !r.hand && r.wins).forEach(r => st.forEach(c => { if (hit(r, c) && c.contest && c.contest.k === r.id) { c.in = true; c.byId = r.id; c.dropId = null; } }));
  const wdur = c => { const w = c.text.split(" ").length, k = struck[c.id] ? Object.keys(struck[c.id]).length : 0; return Math.max(3, Math.round(c.dur * (1 - k / w))); };
  const cap = on.find(r => r.kind === "cap");
  if (cap) {
    let total = st.filter(c => c.in).reduce((n, c) => n + wdur(c), 0);
    const cand = st.filter(c => c.in && c.tags.indexOf("strong") < 0).sort((a, b) => b.dur - a.dur);
    for (const c of cand) { if (total <= cap.secs) break; c.in = false; c.dropId = cap.id; total -= wdur(c); }
  }
  on.filter(r => r.hand).forEach(r => st.forEach(c => { if (hit(r, c)) { if (r.kind === "keep") { c.in = true; c.byId = r.id; c.dropId = null; } else { c.in = false; c.dropId = r.id; } } }));
  const insIds = inserts.filter(i => i.kind === "clip").map(i => i.cid);
  st.forEach(c => { if (insIds.indexOf(c.id) >= 0) { c.in = false; c.byHand = true; } });
  const orderRule = on.find(r => r.kind === "order"), ord = orderRule ? orderRule.order : "time";
  const kept = st.filter(c => c.in);
  let seq;
  if (ord === "time") seq = kept.slice().sort(byTime);
  else { seq = []; STR.forEach(s => seq.push(...kept.filter(c => c.strand === s).sort(byTime))); kept.filter(c => !c.strand).sort(byTime).forEach(c => seq.push(c)); }
  if (ord === "open" && seq.length) { const strong = seq.filter(c => c.tags.indexOf("strong") >= 0).sort((a, b) => b.dur - a.dur)[0]; if (strong) seq = [strong, ...seq.filter(c => c !== strong)]; }
  const gap = on.find(r => r.kind === "gap"), rows = [];
  seq.forEach((c, i) => {
    rows.push({ ...c, kind: "clip", key: "c" + c.id, secs: wdur(c), ghost: c.provenance === "external" && c.acq !== "verified" });
    const nx = seq[i + 1];
    if (gap && ord !== "time" && c.strand && (!nx || nx.strand !== c.strand)) rows.push({ kind: "voice", key: "g" + c.id, voice: true, strand: c.strand, secs: 12, byId: gap.id, text: "What “" + c.strand + "” adds up to — twelve seconds, you, to camera." });
    if (c.voAfter) rows.push({ kind: "voice", key: "v" + c.id, voice: true, strand: c.strand, secs: c.voAfter.secs || 12, byId: c.voAfter.byId || null, text: c.voAfter.text, fromPlan: true });
  });
  inserts.forEach(ins => {
    let idx = rows.findIndex(r => r.key === ins.after); if (idx < 0) idx = rows.length - 1;
    let row;
    if (ins.kind === "clip") { const c = st.find(x => x.id === ins.cid); if (!c) return; row = { ...c, kind: "clip", key: "i" + ins.id, insId: ins.id, isInsert: true, byHand: true, secs: wdur(c) }; }
    else row = { kind: ins.kind, key: "i" + ins.id, insId: ins.id, isInsert: true, voice: true, secs: ins.kind === "react" ? 20 : 12, byHand: true, text: ins.kind === "react" ? "Your reaction — say what you make of what you just heard." : "A line from you — whatever needs saying here." };
    rows.splice(idx + 1, 0, row);
  });
  rows.forEach(r => { r.over = !!(r.voice && (beatMode || {})[r.key] === "over"); });
  const secs = rows.reduce((n, r) => n + (r.over ? 0 : r.secs), 0);
  return { st, rows, secs, ord };
}

// Apply one new rule to a rule list the way the editor does (orders replace, caps replace, the rest append).
export function applyRule(rules, rule) {
  if (rule.kind === "order") return rules.map(x => x.kind === "order" ? { ...x, order: rule.order, on: true, text: "Run it " + ORDERS[rule.order].name + "." } : x);
  if (["cap", "len", "count", "hook"].indexOf(rule.kind) >= 0) return [...rules.filter(x => x.kind !== rule.kind), rule];
  return [...rules, rule];
}

// The project Home and the Editor pass between them. One slot; the Editor restores it when its query matches.
export const PROJECT_KEY = "aldershot.editor.v1";
export function saveProject(q, patch) {
  try {
    const prev0 = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null") || {};
    // a different project (new query or title) must not inherit the previous one's footage set or plan
    const same = prev0.q === q && (!patch.title || !prev0.title || patch.title === prev0.title);
    const prev = same ? prev0 : { ...prev0, set: undefined, plan: undefined, state: undefined };
    const next = { ...prev, ...patch, q, href: "Aldershot One Take.dc.html" + (q || "?open=1"), at: Date.now(), state: { ...(prev.state || {}), ...(patch.state || {}) } };
    localStorage.setItem(PROJECT_KEY, JSON.stringify(next));
    return next;
  } catch (e) { return null; }
}
// provenance: "yours" (default) · "external" with acq: "scouted" | "mission" | "verified" · "yours-doc". Ghost = external, not yet acquired.
export const provenanceOf = c => c.provenance || "yours";
export function loadProject() { try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || "null"); } catch (e) { return null; } }

// Full transcripts (the read). Each line: t (timecode), sp (speaker), text, m (moment id if the line is a moment).
export const TRANSCRIPTS = {
  A: [
    { t: "0:00", sp: "You", m: 1, text: "Okay is this— yeah it's recording. Hi. Give me a second, where was I." },
    { t: "1:12", sp: "You", text: "So I've been putting this off. The flat's up for renewal in March and I have to tell them by Friday." },
    { t: "3:40", sp: "You", text: "I made a list last night. Pros, cons. The cons column was just the word Tuesday, three times." },
    { t: "6:40", sp: "You", m: 2, text: "I think the honest version is I don't like who I am here. Not the city. Me, in it." },
    { t: "9:05", sp: "You", text: "The job's fine. The job's genuinely fine. That's almost worse — there's nothing to blame." },
    { t: "14:12", sp: "You", m: 3, text: "Every plan I make is a plan to be somewhere else in six months. That's been true for three years." },
    { t: "18:30", sp: "You", text: "My sister thinks I'm romanticising the house. She might be right. She usually is." },
    { t: "22:15", sp: "You", m: 4, text: "But I mean, maybe that's just, I don't know, maybe everyone feels like that and it's fine." },
    { t: "27:48", sp: "You", text: "The rent went up again. Two hundred. I didn't even argue, I just paid it." },
    { t: "33:20", sp: "You", text: "I keep picturing the drive up there. The bit after the bridge where the signal goes." },
    { t: "39:50", sp: "You", text: "Okay. I'll do another one Thursday, in the car. Thinking's easier when I'm driving." },
  ],
  B: [
    { t: "0:40", sp: "You", text: "Right, we're moving. Rain's stopped at least." },
    { t: "3:05", sp: "You", m: 5, text: "Sorry, the mic's on the dash — if it rattles, that's why." },
    { t: "6:22", sp: "You", text: "I called the agent about the house. She said there's another family looking." },
    { t: "11:48", sp: "You", m: 6, text: "If I leave, rent halves and I lose everyone I'd call at 2am. That's the actual trade. Say it plainly." },
    { t: "15:10", sp: "You", text: "My mate Dev said I'd last six months. Then he said nine. Then he bought me a beer." },
    { t: "19:30", sp: "You", m: 7, text: "I keep pricing it in money because the other price is embarrassing to say out loud." },
    { t: "24:05", sp: "You", text: "Mum says the roof's fine. Mum also said the car was fine." },
    { t: "27:52", sp: "You", m: 8, text: "The house has a room that gets sun until four. I've thought about that room more than I've thought about the job." },
    { t: "32:40", sp: "You", text: "I don't know anyone up there under sixty. That's either a problem or the point." },
    { t: "36:10", sp: "You", m: 9, text: "Mum keeps sending photos of it like it's already mine." },
    { t: "44:15", sp: "You", text: "Signal's going. I'll pick this up on Sunday — I'm going to see it properly." },
  ],
  C: [
    { t: "2:10", sp: "You", text: "I'm here. I'm actually standing in it. It smells like the old place used to." },
    { t: "8:20", sp: "You", m: 10, text: "Tuesday nights. Not the people exactly. The version of me that shows up on Tuesday nights." },
    { t: "12:30", sp: "You", text: "The agent's in the kitchen on the phone. I can hear her saying serious buyer." },
    { t: "12:58", sp: "Agent", text: "Sorry — are you the gentleman from this morning? Take as long as you like." },
    { t: "17:45", sp: "You", m: 11, text: "I don't know. I don't know. This is probably a bad idea to think about on camera." },
    { t: "24:00", sp: "You", text: "There's a mark on the door frame where someone measured their kids. I didn't expect that to get me." },
    { t: "31:20", sp: "You", m: 12, text: "You can't keep a version of yourself alive by visiting it twice a year." },
    { t: "38:05", sp: "You", text: "I ran the numbers again in the car park. They work. They've always worked." },
    { t: "44:02", sp: "You", m: 13, text: "So I'm going. Not because it's better there. Because staying is the only decision I've never actually made." },
    { t: "51:10", sp: "You", text: "I'm going to ring her back before I lose my nerve." },
    { t: "58:30", sp: "You", m: 14, text: "Okay that's— I'll stop there. I need to eat something." },
  ],
};
export const SUMMARIES = {
  A: "Forty-one minutes in the kitchen, circling why you'd leave — the honest version lands at 6:40 and you hedge it back at 22:15.",
  B: "Fifty-two minutes driving: what it costs to go, said plainly at 11:48, and the house you can't stop thinking about.",
  C: "An hour inside the house — what you'd miss, the line at 31:20, and the decision at 44:02.",
};
export const ARCHIVE_SUMMARY = "Three vlogs, one question — whether to leave the city for the house. You circle it for two and a half hours across five threads and answer it once, on Sunday at 44:02.";
// read state per source: depth and how the read was made
export const READS = { A: { state: "read", depth: "words + screen", via: "transcribed here" }, B: { state: "read", depth: "words + screen", via: "transcribed here" }, C: { state: "read", depth: "words + screen", via: "transcribed here" } };
// meaning search: a term expands to its neighbours (the real index uses embeddings; this stands in)
export const SYN = { money: ["money", "rent", "cost", "pric", "pay", "numbers", "afford", "halves"], mum: ["mum", "mother", "sister", "family"], family: ["mum", "sister", "family", "kids"], leave: ["leave", "going", "move", "somewhere else", "city"], house: ["house", "room", "door", "roof", "agent", "photos"], friends: ["mate", "dev", "people", "anyone", "tuesday nights", "2am"], miss: ["miss", "tuesday", "version of me", "people"], decide: ["decid", "going", "decision", "made"], doubt: ["don't know", "maybe", "bad idea", "fine"] };
export function searchLines(q, mode) {
  const L = String(q || "").trim().toLowerCase(); if (!L) return [];
  let terms = mode === "exact" ? [L] : L.split(/\s+/).filter(w => w.length > 2);
  const own = terms.slice();
  if (mode !== "exact") { const more = []; terms.forEach(w => Object.keys(SYN).forEach(k => { if (k.indexOf(w) === 0 || w.indexOf(k) === 0 || SYN[k].some(s => s.indexOf(w) === 0)) more.push(...SYN[k]); })); terms = Array.from(new Set([...terms, ...more])); }
  const hits = [];
  Object.keys(TRANSCRIPTS).forEach(src => TRANSCRIPTS[src].forEach(line => { const low = line.text.toLowerCase(); const lit = own.find(w => low.indexOf(w) >= 0), term = lit || terms.find(w => low.indexOf(w) >= 0); if (term) { const i = low.indexOf(term); hits.push({ src, line, score: lit ? 2 : 1, pre: line.text.slice(0, i), mid: line.text.slice(i, i + term.length), post: line.text.slice(i + term.length) }); } }));
  // your own words first, their neighbours after; transcript order within each (stable sort)
  return hits.map((h, i) => ({ h, i })).sort((a, b) => b.h.score - a.h.score || a.i - b.i).map(x => x.h);
}

// Outside your footage: found by Scout or added (a podcast) — linked, never downloaded. Same object as a moment, with provenance.
export const EXT_SRC = {
  X1: { name: "The Backseat Show · Mar 2024 (podcast)", host: "Podcast", color: "#5EB8C9", f: 2, secs: 3420 },
  X2: { name: "DSP · Thursday stream (Twitch)", host: "Twitch", color: "#B08CD4", f: 6, secs: 14400 },
};
export const EXT = [
  { id: 101, src: "X1", ts: "12:34", dur: 31, tags: ["core", "ext"], strand: "what it costs", provenance: "external", acq: "verified", text: "Nobody tells you the rent is the cheap part. The expensive part is who you stop being." },
  { id: 102, src: "X1", ts: "41:08", dur: 24, tags: ["core", "ext"], strand: "what I'd miss", provenance: "external", acq: "scouted", text: "I visit twice a year and every time there's less of me there to visit." },
  { id: 103, src: "X2", ts: "2:13:58", dur: 48, tags: ["core", "ext"], strand: "landing it", provenance: "external", acq: "mission", text: "You don't decide to leave. You notice you already have, and then you do the paperwork." },
];
// The sample plan for "a video about whether to leave". Beats are observable; counterpoints are sought on purpose.
export const PREP = {
  claim: "Leaving isn't a decision you make; it's one you notice you've already made — and the money is the excuse you reach for so you don't have to say that.",
  beats: [
    { id: "b1", role: "subject", name: "Every plan is a plan to be elsewhere", need: "you saying it, in your own words — the pattern, not the feeling", find: [3, 2] },
    { id: "b2", role: "subject", name: "The money is the alibi", need: "the trade priced in rent, then the admission that the price is embarrassing", find: [6, 7], narr: "Narration — he prices it in money because the other price is the one he can't say out loud." },
    { id: "b3", role: "subject", name: "The room that gets sun until four", need: "the house as the thing actually being chosen", find: [8, 9] },
    { id: "b4", role: "counter", name: "The case for staying", need: "what's lost — Tuesday nights, a version of yourself; the strongest version of the other side", find: [10, 12] },
    { id: "b5", role: "counter", name: "Maybe everyone feels like this", need: "the hedge, kept on purpose — the doubt a viewer will have", find: [4] },
    { id: "b6", role: "subject", name: "Noticing you've already left", need: "the landing — said once, late, plainly", find: [13], ext: [103] },
    { id: "b7", role: "outside", name: "What it costs other people", need: "one voice that isn't yours — the same trade, from outside", find: [], ext: [101], narr: "Narration — he isn't the only one who's made this trade." },
  ],
};
