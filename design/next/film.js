/**
 * The sample film behind design/next/ — "NASA as a medium", 20:00.
 *
 * Copied VERBATIM from Plan.dc.html, the way design/one-take/footage.js is the
 * reference for the rule engine. test/film-plan.test.ts loads this and checks
 * that Plan.dc.html still carries the same SEQ, so the two cannot drift.
 *
 * A row is [dur, pictureKind, picture, pictureStatus, soundMode, sound, soundStatus].
 */
export const SEQ = [
  { id: "s1", act: 0, title: "Cheap science fiction", qk: "raises", q: "What did McLuhan see that the rest of us missed?", rows: [
    [9, "archive", "McLuhan interview, close on him", "have", "sync", "McLuhan: the “cheap science fiction” line, in his words", "have"],
    [4, "hold", "Hold on his face, then cut to black", "have", "silence", "Nothing. Let the line sit.", ""],
    [22, "you", "You, on camera, close", "have", "vo", "He said it like a throwaway. I think it’s the whole story: the space age wasn’t just broadcast. It was produced.", "rec"],
    [10, "card", "Title: NASA as a medium", "have", "breathe", "Music comes up under the title", ""] ] },
  { id: "s2", act: 0, title: "Before NASA, there was Disney", qk: "raises", q: "Who sold space before anyone had flown?", rows: [
    [20, "wanted", "“Man in Space”, Disneyland TV, 1955 — von Braun at the model rocket", "wanted", "vo", "In 1955, three years before NASA existed, Wernher von Braun went on Disney’s television show to explain how we’d get to space.", "draft"],
    [25, "found", "The episode’s animated rocket sequence", "found", "sync", "The broadcast’s own narrator, 25 seconds", "found"],
    [6, "sketch", "The cartoon rocket freezes and redraws as an engineering drawing", "have", "breathe", "Music only", ""],
    [30, "you", "You, on camera", "have", "vo", "The audience saw the future before the engineers had built it. Picture first, hardware later — that’s the pattern to watch.", "draft"],
    [24, "sketch", "A timeline draws itself: 1955 broadcast → 1958 NASA → 1961 first American in space", "have", "vo", "Watch how fast a picture becomes a program.", "draft"] ] },
  { id: "s3", act: 0, title: "Mercury on TV", qk: "answers", q: "The launches were staged like episodes.", rows: [
    [6, "archive", "Montage: seven anchors counting down", "have", "sync", "The countdowns, overlapping", "have"],
    [6, "you", "Your bridge line", "have", "vo", "Before anyone flew, the launches were scheduled like episodes.", "draft"],
    [30, "archive", "John Glenn’s launch, 1962, as it aired", "have", "sync", "The broadcast commentary, 30 seconds", "have"],
    [4, "hold", "Hold on the rocket clearing the tower", "have", "breathe", "Crowd sound, then music", ""],
    [44, "sketch", "Each flight drawn as an episode card: cast, date, cliffhanger", "figures", "vo", "Every flight had a cast, a cliffhanger, and a live audience. The schedule read like a season.", "draft"],
    [30, "you", "You, on the stream", "have", "vo", "TV didn’t cover the space program. It was the space program’s medium.", "rec"] ] },
  { id: "s4", act: 0, title: "The posters", qk: "raises", q: "When the agency pays for the picture, who is the picture for?", rows: [
    [10, "archive", "Your poster scans, one at a time", "have", "vo", "In 1962 NASA started its own art program.", "rec"],
    [30, "sketch", "A poster redrawn as line art — the planet draws itself", "have", "vo", "It invited artists to its launches and paid them to paint what they saw.", "rec"],
    [20, "found", "Norman Rockwell’s painting of astronauts suiting up, 1965", "found", "vo", "Norman Rockwell. Later, Robert Rauschenberg.", "draft"],
    [8, "hold", "Slow pan across the paintings", "have", "breathe", "Music", ""],
    [52, "archive", "Your three poster scans, side by side", "have", "vo", "Here’s the question nobody asked at the time: when the agency pays for the picture, who is the picture for?", "draft"] ] },
  { id: "s5", act: 1, title: "It was arithmetic", qk: "answers", q: "The real planning looked nothing like the posters.", rows: [
    [4, "you", "Your line", "have", "vo", "The real planning looked nothing like the posters.", "rec"],
    [6, "sketch", "The transfer orbit draws itself; the camera dives into Mars", "have", "vo", "It was arithmetic.", "rec"],
    [6, "found", "Mariner 4’s first picture of Mars, coloured by hand, 1965", "found", "vo", "The first picture of Mars was coloured in by hand.", "rec"],
    [18, "wanted", "A JPL engineer remembering the hand-coloured image", "wanted", "sync", "In their words, 18 seconds", "wanted"],
    [4, "hold", "Hold on the finished image", "have", "breathe", "Music up", ""],
    [8, "wanted", "A launch broadcast, today", "wanted", "vo", "Sixty years on, the launches still stream like episodes.", "draft"],
    [104, "sketch", "Orbits, launch windows and fuel, drawn", "have", "vo", "Mars only lines up every twenty-six months. Miss the window and you wait two years. None of that fits on a poster.", "draft"] ] },
  { id: "s6", act: 1, title: "The engineers’ view", qk: "raises", q: "Did the people doing the work believe the show?", rows: [
    [20, "archive", "Your video at 3:12", "have", "vo", "The people doing the work thought the publicity was a distraction.", "rec"],
    [40, "found", "Oral history: an engineer on the press", "found", "sync", "The engineer’s line — you pick it from three Scout marked", "found"],
    [5, "hold", "Hold on the transcript page", "have", "breathe", "Room tone", ""],
    [55, "archive", "Control-room footage", "have", "vo", "And yet they did the work inside the show — every test, every countdown, on camera.", "draft"] ] },
  { id: "s7", act: 1, title: "The fire", qk: "raises", q: "What did the show cost?", rows: [
    [10, "card", "January 27, 1967", "have", "silence", "Nothing.", ""],
    [40, "wanted", "The news bulletin about the Apollo 1 fire, as it aired", "wanted", "sync", "The bulletin, as it aired", "wanted"],
    [8, "hold", "Black", "have", "silence", "Nothing.", ""],
    [60, "sketch", "The capsule and its hatch, drawn from the review board report", "figures", "vo", "Three astronauts — Gus Grissom, Ed White and Roger Chaffee — died in a fire during a launch rehearsal on the pad.", "draft"],
    [32, "you", "You, on camera", "have", "vo", "For almost two years, no American crew flew.", "draft"] ] },
  { id: "s8", act: 2, title: "Apollo 11, the finale", qk: "answers", q: "The broadcast was the product.", rows: [
    [30, "wanted", "The landing, July 20, 1969, as broadcast", "wanted", "sync", "The broadcast audio", "wanted"],
    [6, "hold", "Hold on the grainy picture", "have", "breathe", "Static, then music", ""],
    [50, "sketch", "The signal path drawn: the Moon → dishes at Goldstone, Honeysuckle Creek and Parkes → Houston → the networks", "have", "vo", "The picture of the century came down through three dish antennas on three continents before anyone at home saw it.", "draft"],
    [34, "you", "You, on camera", "have", "vo", "The mission had two payloads: two men on the Moon, and a picture of them.", "draft"] ] },
  { id: "s9", act: 2, title: "The cuts", qk: "answers", q: "Once the picture was delivered, the money left.", rows: [
    [45, "sketch", "NASA’s share of federal spending, drawn as a line", "figures", "vo", "NASA’s share of federal spending peaked around four and a half percent in 1966. By the time Apollo 17 flew, the last three Moon missions had already been cancelled.", "draft"],
    [20, "wanted", "Apollo 17 lifting off the Moon, 1972", "wanted", "sync", "The mission audio", "wanted"],
    [40, "you", "You, on camera", "have", "vo", "The audience had seen the ending. Nobody pays for a sequel to a finale.", "draft"] ] },
  { id: "s10", act: 2, title: "Streamed like episodes", qk: "raises", q: "Is it happening again?", rows: [
    [30, "wanted", "A recent launch livestream", "wanted", "sync", "The stream’s own commentary", "wanted"],
    [4, "hold", "Hold on the rocket", "have", "breathe", "Crowd cheering on the stream", ""],
    [56, "you", "You, on camera", "have", "vo", "Sixty years on, the launches still stream like episodes. Only now the network and the rocket belong to the same company.", "draft"] ] },
  { id: "s11", act: 2, title: "The close", qk: "answers", q: "The fiction wasn’t decoration. It was the funding model.", rows: [
    [8, "archive", "McLuhan again — the same line, shorter", "have", "sync", "McLuhan, 8 seconds", "have"],
    [40, "you", "You, on camera", "have", "vo", "The fiction wasn’t decoration. It was the funding model. — Your last line goes here; write it last.", "draft"],
    [12, "sketch", "The budget line redraws itself, then fades", "have", "breathe", "Music", ""],
    [15, "card", "End card: NASA as a medium", "have", "breathe", "Music out", ""] ] },
];

// A section Aldershot proposes when your stream and your video disagree.
export const BOTH = { id: "s6b", act: 1, title: "Both were true", qk: "answers", q: "NASA ran on publicity and hated it — at the same time.", rows: [
  [20, "archive", "Your stream at 41:50", "have", "sync", "You, on the stream: “it ran on publicity”", "have"],
  [20, "archive", "Your video at 3:12", "have", "sync", "You, on video: “NASA hated publicity”", "have"],
  [4, "hold", "Split screen, both of you, frozen", "have", "breathe", "Silence, then music", ""],
  [46, "you", "You, on camera, now", "have", "vo", "Both of me were right. The engineers hated the show, and the show paid for the engineers.", "draft"] ] };

// The cold open, when you ask to open on Mariner 4.
export const COLD = { id: "s0", act: 0, title: "Cold open: the numbers", qk: "raises", q: "What is this picture, and why is it made of numbers?", rows: [
  [20, "found", "Mariner 4’s first data colouring itself in, strip by strip — no explanation yet", "found", "breathe", "No voice. Just the picture arriving.", ""] ] };

export const ACTS = [
  { label: "ACT 1 · THE PROMISE", job: "What the audience was sold — before and during the first flights." },
  { label: "ACT 2 · THE MACHINE BEHIND IT", job: "How the work actually happened, and what it cost." },
  { label: "ACT 3 · THE BILL", job: "The finale, the cuts, and the same show running again." },
];
