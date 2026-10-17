// Labs: the directed-plan sample. Someone else's footage (a 3-stream archive), the user's own screenshots as evidence,
// and one brief. The plan is what the model would produce; here it is authored, so the shape can be judged before the engine exists.
export const BRIEF = "From everything tagged DSP, make a video about his break from reality — and overlay it with the screenshots I uploaded, where they prove what the narration says.";

export const SOURCES = {
  S1: { name: "Stream · 12 Mar 2019 · the pre-stream", kind: "video", secs: 9120, color: "#E06A6A", who: "him" },
  S2: { name: "Stream · 4 Aug 2021 · the “detractors” rant", kind: "video", secs: 7380, color: "#D9B36A", who: "him" },
  S3: { name: "Stream · 19 Jan 2024 · the apology", kind: "video", secs: 5940, color: "#B08CD4", who: "him" },
  D: { name: "Your screenshots · 14 files", kind: "images", secs: 0, color: "#5EB8C9", who: "you" },
};

// Moments the archive already holds (read once, tagged by thread). Transcript lines are what the model argues from.
export const MOMENTS = [
  { id: 1, src: "S1", ts: "0:14:20", dur: 41, thread: "the audience", text: "I've got the best community on this platform. You guys know that. Everyone else is just noise." },
  { id: 2, src: "S1", ts: "1:02:05", dur: 38, thread: "money", text: "Donations are down this month and I don't understand it. The content's better than ever. Better than ever." },
  { id: 3, src: "S1", ts: "1:48:30", dur: 52, thread: "the detractors", text: "There's a group of them — maybe ten people — who spend all day making videos about me. All day. Think about that." },
  { id: 4, src: "S2", ts: "0:08:10", dur: 47, thread: "the detractors", text: "It's not ten anymore. It's coordinated. Somebody is paying for this. You don't get this much hate organically." },
  { id: 5, src: "S2", ts: "0:41:52", dur: 36, thread: "the audience", text: "If you're watching this and you're not subscribed, you're part of the problem. I'm serious." },
  { id: 6, src: "S2", ts: "1:19:00", dur: 58, thread: "the platform", text: "The algorithm is suppressing me. I've seen the numbers. Videos I upload get a tenth of what they got two years ago. That's not a coincidence." },
  { id: 7, src: "S2", ts: "1:55:40", dur: 44, thread: "money", text: "I'm not asking for charity. I'm asking you to recognise what this costs me. Every month. To keep doing this for you." },
  { id: 8, src: "S3", ts: "0:03:00", dur: 61, thread: "the apology", text: "If anyone was offended by anything I said, then I'm sorry they felt that way. I don't think I did anything wrong, but if you felt it, I hear you." },
  { id: 9, src: "S3", ts: "0:27:15", dur: 49, thread: "the detractors", text: "They've won, in a way. They got what they wanted. I just want everyone to know I never changed. They did." },
  { id: 10, src: "S3", ts: "0:58:40", dur: 55, thread: "the platform", text: "The platform doesn't want me here. Fine. I'll build my own. The people who matter will follow." },
  { id: 11, src: "S3", ts: "1:30:10", dur: 33, thread: "the audience", text: "I know some of you have been here nine years. Nine years. I don't take that lightly. I just need you to keep showing up." },
];

// The user's screenshots — read by OCR, each one a document with a date and the text on it.
export const SHOTS = [
  { id: "d1", file: "sub-count-2019-03.png", date: "Mar 2019", text: "Subscribers 212,418 · Avg. concurrent 3,120", proves: "the 2019 baseline" },
  { id: "d2", file: "sub-count-2024-01.png", date: "Jan 2024", text: "Subscribers 198,906 · Avg. concurrent 640", proves: "a tenth of the audience, in his own dashboard" },
  { id: "d3", file: "donation-goal-2021-08.png", date: "Aug 2021", text: "Monthly goal $4,000 · Reached $1,130 (28%)", proves: "the money, the month he said the content was better than ever" },
  { id: "d4", file: "tweet-2021-08-coordinated.png", date: "Aug 2021", text: "“This is a coordinated harassment campaign. I have proof.” — 1,204 replies, no proof posted", proves: "the claim of coordination, and what followed it" },
  { id: "d5", file: "forum-detractors-thread.png", date: "2019–2024", text: "Thread: 'DSP watch' · 31,000 posts · 412 unique posters", proves: "it was never ten people — or a payroll" },
  { id: "d6", file: "platform-strike-notice.png", date: "Dec 2023", text: "Community guidelines strike · Reason: harassment · Appeal denied", proves: "what 'the platform doesn't want me here' refers to" },
];

// The plan: blocks, each one a point in the argument with its narration, the moments that back it, the shot that proves it, and the director's call.
// `vo` is drafted from his words and the shots; marked where it should be the user's own voice.
export const PLAN = [
  { n: 1, title: "He starts from the top", role: "exhibit", vo: null, moments: [1], shots: [], screen: "S1 0:14:20 plays clean — his voice, his room, 2019. No narration yet. Let the confidence land.", need: null },
  { n: 2, title: "The numbers, the first time", role: "vo", vo: "In March 2019 he had two hundred thousand subscribers and three thousand people watching at any moment. He was right about one thing: the community was real.", moments: [], shots: ["d1"], screen: "Your screenshot d1, held. The two figures highlighted as they're said. Then back to him.", need: null },
  { n: 3, title: "Ten people", role: "exhibit", vo: null, moments: [3], shots: ["d5"], screen: "S1 1:48:30 plays; on 'maybe ten people' your screenshot d5 slides in beside him — 412 posters. Hold both.", need: null },
  { n: 4, title: "The story gets bigger", role: "vo", vo: "Two years later it isn't ten people. It's a campaign. Someone is paying. He says he has proof.", moments: [4], shots: ["d4"], screen: "S2 0:08:10 under the narration, ducked. Then d4: the tweet, and the reply count. The line 'no proof posted' appears last.", need: null },
  { n: 5, title: "Better than ever", role: "exhibit", vo: null, moments: [2], shots: ["d3"], screen: "S1 1:02:05 — 'better than ever', twice. Cut to d3 on the second one: 28% of goal.", need: null },
  { n: 6, title: "The algorithm", role: "vo", vo: "He's right that the numbers fell. Six hundred and forty people, from three thousand. He has one explanation for it, and it isn't him.", moments: [6], shots: ["d2"], screen: "S2 1:19:00 plays first, clean — 'that's not a coincidence'. Then d2 over your line. The same dashboard as block 2, five years on.", need: null },
  { n: 7, title: "What he asks of them", role: "exhibit", vo: null, moments: [5, 7], shots: [], screen: "S2 0:41:52 then S2 1:55:40, back to back, no gap. Let the two asks sit next to each other.", need: null },
  { n: 8, title: "The apology", role: "exhibit", vo: null, moments: [8], shots: [], screen: "S3 0:03:00 in full — the conditional apology. Caption the word 'if' each time he says it.", need: null },
  { n: 9, title: "The turn", role: "cam", vo: "YOUR LINE — the one thing this adds up to. Drafted from his words: 'Every number went down, and every explanation pointed somewhere else.' Say it your way.", moments: [], shots: [], screen: "You, to camera. The only time you appear. Nothing else on screen.", need: "your take, 10–15s" },
  { n: 10, title: "They did", role: "exhibit", vo: null, moments: [9, 10], shots: ["d6"], screen: "S3 0:27:15 — 'I never changed. They did.' Then d6, the strike notice, as he says 'the platform doesn't want me here'. Hold the word 'harassment'.", need: null },
  { n: 11, title: "Nine years", role: "exhibit", vo: null, moments: [11], shots: [], screen: "S3 1:30:10 to black. No music. End on 'keep showing up'.", need: null },
];

export const RULES = [
  { n: "01", text: "Argue from his own words — every point is backed by a moment he said, or a screenshot you uploaded.", effect: "11 blocks · 10 of his moments · 6 of your 14 screenshots · 1 line of yours" },
  { n: "02", text: "Show a screenshot while the narration says the thing it proves — never before, never without it.", effect: "6 Document blocks, each pinned to a line" },
  { n: "03", text: "When he's saying it himself, let him. Your voice only where the footage can't.", effect: "7 exhibits, 3 narrated blocks, 1 to camera" },
  { n: "04", text: "Run it as it happened — 2019, 2021, 2024.", effect: "the order is the argument; 'sharpest first' would be editorial and would say so" },
  { n: "05", text: "Every clip of his is third-party footage. Attribute at first use; log each one for the dispute file.", effect: "10 clips · 7:24 of his footage · attribution card on block 1" },
];

export const GAPS = [
  { text: "Block 9 is yours to record. Everything else is him and your screenshots.", kind: "record" },
  { text: "8 of your 14 screenshots aren't used — nothing in the narration needs them. They're kept.", kind: "info" },
  { text: "No moment covers the Dec 2023 strike itself. If he addressed it on stream, that footage isn't in the archive yet.", kind: "missing" },
  { text: "Third-party footage: 7:24 of his streams. Before you post will flag each clip; the dispute file is started now.", kind: "rights" },
];

export const fmt = n => Math.floor(n / 60) + ":" + String(Math.round(n) % 60).padStart(2, "0");
