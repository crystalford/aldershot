// Scout demo data — the DarksidePhil brief, worked. Illustrative: quotes and sources are invented to show the shape, not real findings.
export const BRIEF = "We're making a video about DarksidePhil and his constant battle with his detractors.";

export const BEATS = [
  { id: "B1", role: "subject", name: "The pattern", behaviour: "Berates live chat during streams; addresses “chat” as an adversary", need: 2 },
  { id: "B2", role: "subject", name: "The trigger", behaviour: "Blows up at backseaters — unsolicited gameplay advice", need: 2 },
  { id: "B3", role: "subject", name: "Enforcement", behaviour: "Bans or times out viewers on stream, and announces it", need: 2 },
  { id: "B4", role: "subject", name: "The outward battle", behaviour: "Responds to critics, reaction channels and “hate” communities by name", need: 2 },
  { id: "B5", role: "subject", name: "Escalation", behaviour: "Rage mid-game that starts from a chat message", need: 2 },
  { id: "B6", role: "context", name: "History", behaviour: "How the feud started; recurring critics; platform moves", need: 1 },
  { id: "C1", role: "counter", name: "His explanation", behaviour: "Calm moments explaining why he reacts; his stated rules for chat", need: 1 },
  { id: "C2", role: "counter", name: "Outside view", behaviour: "Interviews and podcasts where he speaks for himself", need: 1 },
  { id: "C3", role: "counter", name: "Contrition", behaviour: "Apologies, acknowledgements, moments he laughs it off", need: 1 },
  { id: "C4", role: "counter", name: "Detractor conduct", behaviour: "Documented harassment or bad-faith behaviour by detractors", need: 1 },
];

export const REJECTED = [
  { said: "he is narcissistic", why: "a diagnosis, not a behaviour — nothing a viewer could point to on camera" },
  { said: "he can't handle criticism", why: "a motive — rewritten as B4: responds to critics by name" },
];

export const FAMILIES = [
  { id: "direct", name: "Direct", color: "#ECECF1", queries: ["DarksidePhil rage chat", "DarksidePhil bans viewer live", "DarksidePhil backseat gaming rage", "DarksidePhil responds to critics"] },
  { id: "vocab", name: "Community vocabulary", color: "#D9B36A", queries: ["“detractors” + stream", "“the Khan” compilation", "“this is why I don't read chat”", "“Phil vs the mods” thread"], note: "harvested from the titles, descriptions and threads of the first 40 results — the fandom's own words for the moments it has already found" },
  { id: "crowd", name: "Crowd-indexed", color: "#5EB8C9", queries: ["DarksidePhil compilation", "best of DarksidePhil rage", "reddit “timestamp” “VOD” DarksidePhil", "Twitch clips · by views · last 60 days"] },
  { id: "counter", name: "Counterpoint", color: "#5EC98F", queries: ["DarksidePhil interview", "DarksidePhil explains chat rules", "DarksidePhil apology", "DarksidePhil podcast appearance", "harassment of DarksidePhil documented"] },
];

export const SOURCES = [
  { id: "s1", kind: "vod", name: "Stream — RE4 Remake, pt. 3", host: "YouTube", dur: "5:48:12", views: "41k", transcript: "none", note: "YouTube: metadata, chapters and comment timestamps only — no captions without ownership", crowd: 7 },
  { id: "s2", kind: "clip", name: "Clip — “sit down and watch” (vod_offset 2:14:08)", host: "Twitch", dur: "0:48", views: "18k", transcript: "none", note: "Twitch Get Clips · vod_offset points into a VOD that expires in 11 days", crowd: 1 },
  { id: "s3", kind: "podcast", name: "The Backseat Show — ep. 112", host: "Podcast RSS", dur: "1:22:40", views: "—", transcript: "rss", note: "<podcast:transcript> · VTT with word timings · legitimately read", crowd: 0 },
  { id: "s4", kind: "comp", name: "“DSP vs chat — 20 minutes”", host: "YouTube", dur: "20:31", views: "210k", transcript: "none", note: "compilation — each hit must be traced to an original", crowd: 23 },
  { id: "s5", kind: "user", name: "Your capture — stream 2024-01-19", host: "You", dur: "6:02:00", views: "—", transcript: "yours", note: "captured on your machine, uploaded as your material", crowd: 0 },
  { id: "s6", kind: "vod", name: "Q&A stream — “chat rules”", host: "YouTube", dur: "1:04:30", views: "9k", transcript: "none", note: "YouTube: metadata and chapters only", crowd: 2 },
];

// windows the small model scanned; one narrow question each. verified = exact match in the chunk, time from word timings.
export const SCAN = [
  { src: "s5", t: "2:14:02", before: "[a viewer has typed the same route instruction eleven times in two minutes; a mod warns them]", after: "[he mutes chat on screen; the game audio comes back up; two minutes later he unmutes without comment]", q: "Does the streamer address or insult a chat member?", quote: "chat, I'm not going to tell you again — if you want to play, go stream it yourself", beat: "B1", verified: true, score: 1.0 },
  { src: "s5", t: "2:14:40", before: "[the same viewer returns under a second name and types it again]", after: "[silence for forty seconds; he restarts the level]", q: "Does the streamer address or insult a chat member?", quote: "and you're gone. timed out. anyone else?", beat: "B3", verified: true, score: 1.0 },
  { src: "s5", t: "3:41:15", before: "[three viewers type \"the door\" in a row during a stuck section]", after: "[he finds the door thirty seconds later and does not mention it]", q: "Does the streamer respond to backseat advice?", quote: "I know the door is there. I have eyes. stop", beat: "B2", verified: true, score: 0.93 },
  { src: "s5", t: "4:03:50", before: "[a donation asks why he stopped doing charity streams]", after: "[he names the channel, then the year, then moves on to the next donation]", q: "Does the streamer name a critic or channel?", quote: "the whole thing started with that one channel clipping me out of context in 2019", beat: "B6", verified: true, score: 1.0 },
  { src: "s3", t: "0:31:08", before: "[the host asks what it is actually like to read chat live]", after: "[he laughs; the host says that sounds exhausting; he agrees]", q: "Does he explain his reaction to chat?", quote: "when a thousand people are typing at you, the one that's trying to wind you up is the one you read", beat: "C1", verified: true, score: 1.0 },
  { src: "s3", t: "0:47:22", before: "[the host asks whether the clips are fair]", after: "[he lists two streams by date where he says he was in the wrong]", q: "Does he acknowledge or apologise?", quote: "I've gone too far on stream, yeah. more than once", beat: "C3", verified: true, score: 0.97 },
  { src: "s3", t: "0:52:10", before: "[the host asks what the worst of it was]", after: "[he describes moving house; the host changes the subject]", q: "Does he describe detractor behaviour?", quote: "they'd sign up to my emails and post my address", beat: "C4", verified: true, score: 1.0 },
  { src: "s5", t: "5:10:33", before: "[a stretch of twenty minutes with chat hidden; a mod asks in voice whether to unhide it]", after: "[chat stays hidden for the rest of the stream]", q: "Does the streamer address or insult a chat member?", quote: "you people are the reason I don't read chat anymore", beat: "B1", verified: true, score: 1.0 },
  { src: "s5", t: "1:02:11", q: "Does the streamer address or insult a chat member?", quote: "oh here we go again with the backseaters", beat: "B2", verified: false, score: 0.71, why: "model's quote isn't in the chunk — nearest match 0.71, below the bar · rejected" },
  { src: "s5", t: "0:58:40", q: "Does the streamer name a critic or channel?", quote: "it's always the same three accounts", beat: "B4", verified: false, score: 0.86, why: "paraphrase · 0.86 — flagged for a human check" },
];

// board rows: verified moments per beat + crowd-only candidates from sources we can't read
export const CROWD = [
  { src: "s2", t: "2:14:08", beat: "B1", note: "Twitch clip, 18k views · points to the same stretch as your capture at 2:14:02 — the clip lags the moment by ~20 s; scan window started at 2:13:30", status: "crowd" },
  { src: "s4", t: "6:40", beat: "B5", note: "compilation chapter “the Ashley fight” · 23 comment timestamps · original VOD not yet traced", status: "trace" },
  { src: "s1", t: "4:51:10", beat: "B4", note: "3 comments cite this timestamp for “he reads the hate thread live” · no transcript to verify — link only", status: "crowd" },
  { src: "s6", t: "0:12:00", beat: "C1", note: "chapter titled “my chat rules” · no transcript · link only", status: "crowd" },
];

// snowball seeds the verified rows produced
export const SEEDS = [
  { from: "B6 · “that one channel … 2019”", seed: "incident date → the original 2019 VOD", family: "crowd" },
  { from: "C4 · “post my address”", seed: "“doxx” + DarksidePhil + year", family: "counter" },
  { from: "s4 chapter · “the Ashley fight”", seed: "RE4 Remake + “Ashley” + stream date", family: "vocab" },
];

// stopping: cumulative distinct verified moments per round
export const ROUNDS = [
  { n: 1, queries: 17, found: 5 },
  { n: 2, queries: 33, found: 8 },
  { n: 3, queries: 46, found: 8 },
];
