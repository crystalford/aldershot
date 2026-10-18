/**
 * A SENTENCE INTO RULES, deterministically.
 *
 * "Keep it under three minutes." "Take out the hellos." "As it happened."
 * "The start drags." Each of those is a rule, and `04-RULE-ENGINE.md` lists
 * the patterns: threads and kinds of line, orders, lengths, landing, shorts,
 * feelings, sound.
 *
 * REGEXES, NOT A MODEL CALL, and the reason is not cost. A rule is the thing
 * the user can see and switch off, so it has to be the same rule every time
 * the same sentence is typed; a model that returns `cap` today and `len`
 * tomorrow makes the rules pane untrustworthy in a way no accuracy figure
 * fixes. The house rule is "if it can be a regex, a lint or a measurement, it
 * is not a model call", and in production a model is consulted only when this
 * returns nothing — and then its output must be a rule object in the closed
 * schema, never a timeline edit.
 *
 * FEELINGS ARE RULES. "The start drags" is not a complaint to be interpreted,
 * it is an order rule. "Hard to follow" is one thread at a time. "Tighter",
 * "punchier", "too long" are all a cap. This is the part that makes the
 * conversation an editing interface rather than a chat window, and it is the
 * part that has to be deterministic, because a feeling the system reads
 * differently on Tuesday is worse than one it cannot read at all.
 *
 * Nothing here guesses. A sentence that matches no pattern produces no rule
 * and `unparsed` names it, so the caller can say what DOES parse — an honest
 * reply listing what works, never a silent no-op.
 */

import type { Rule, Order } from "./rules.ts";
import { targetFromBrief } from "./assemble.ts";

export interface Parsed {
  rules: Array<Omit<Rule, "id">>;
  /** The clauses that meant nothing to us, for the honest reply. */
  unparsed: string[];
}

/** What the user can be told parses, when nothing did. */
export const WHAT_PARSES = [
  "a length — “under three minutes”, “keep it to 90 seconds”",
  "an order — “as it happened”, “one thread at a time”, “start on the sharpest line”",
  "what to lose — “take out the hellos”, “lose the hedging”",
  "what to keep — “keep the hard lines”, “end on where you land it”",
  "how it feels — “the start drags”, “hard to follow”, “too long”",
  /*
   * THE SHORTS BRIEF'S OWN FOUR, added when src/brief.ts learned them.
   * This list is what somebody is told when nothing parsed, so a shape the
   * product understands and does not mention here is a shape nobody will
   * ever type again.
   */
  "a shorts brief — “hooks in 2s”, “20–40s”, “no politics”, “we need 8”",
];

/*
 * The tag each phrase names. Keyed by the tags src/moment-tags.ts derives, so
 * a sentence can only ever ask for something a moment can actually be.
 */
const TAG_PHRASES: Array<[RegExp, string]> = [
  [/\b(the )?(hellos?|mic checks?|housekeeping|admin|sponsor( reads?)?|intros?|sign[- ]?offs?)\b/i, "housekeeping"],
  [/\b(the )?(hedging|hedges|waffle|“?i don'?t know”?s?|umms?|dithering)\b/i, "hedge"],
  [/\b(the )?(hard lines?|sharp(est)? lines?|best bits?|strongest bits?)\b/i, "strong"],
  [/\b(the )?(core|substance|where (you'?re|i'?m) working (it|something) out)\b/i, "core"],
];

const ORDER_PHRASES: Array<[RegExp, Order, string]> = [
  [/\bas it happened\b|\bchronologic(al|ally)\b|\bin order\b/i, "time", "Run it as it happened."],
  [/\bone (thread|strand|topic) at a time\b|\bby (thread|strand|topic)\b|\bgroup(ed)? by (thread|topic)\b/i, "strand", "Run it one thread at a time."],
  [/\bstart on the (sharpest|hardest|best) line\b|\bsharpest line first\b|\bopen on the (sharpest|hardest|best)\b|\blead with the (sharpest|hardest|best)\b/i, "open", "Start on the sharpest line."],
];

/*
 * FEELINGS, each mapped to the rule that answers it.
 *
 * "The start drags" does not mean "shorten the start" — there is no such rule.
 * It means the cut opens on something that has to be earned, so the answer is
 * to open on the sharpest line instead. That mapping is a judgement, written
 * down where it can be argued with rather than left in a prompt.
 */
const FEELINGS: Array<[RegExp, Omit<Rule, "id">]> = [
  [
    /\b(the )?(start|opening|beginning) (drags|is slow|takes too long)\b|\bslow (start|opening)\b|\btakes a while to get going\b/i,
    { kind: "order", order: "open", on: true, text: "Start on the sharpest line." },
  ],
  [
    /\bhard to follow\b|\ball over the place\b|\bjumps around\b|\bconfusing\b|\bdoesn'?t flow\b/i,
    { kind: "order", order: "strand", on: true, text: "Run it one thread at a time." },
  ],
];

/** "tighter", "punchier", "too long" — a cap, at the length 04 specifies. */
const TIGHTEN = /\btighter\b|\bpunchier\b|\btoo long\b|\btighten (it|this)\b|\bcut it down\b|\btrim it\b/i;
const TIGHTEN_MS = 3 * 60_000;

/**
 * Turns a sentence into rules.
 *
 * `seconds` is what a length phrase resolved to; the caller passes
 * targetFromBrief's answer so the two cannot disagree about what "two minutes"
 * means.
 */
export function parseRules(sentence: string): Parsed {
  const text = sentence.trim();
  const rules: Array<Omit<Rule, "id">> = [];
  const unparsed: string[] = [];
  if (!text) return { rules, unparsed };

  /* A length, from the one parser that already knows how to read one. */
  const target = targetFromBrief(text);
  if (target.said) {
    rules.push({
      kind: "cap",
      secs: Math.round(target.ms / 1000),
      on: true,
      text: `Keep it under ${Math.round(target.ms / 60_000) || 1} minute${target.ms >= 120_000 ? "s" : ""}.`,
    });
  }

  for (const [re, order, label] of ORDER_PHRASES) {
    if (re.test(text)) {
      rules.push({ kind: "order", order, on: true, text: label });
      break;
    }
  }

  /*
   * LOSE versus KEEP, decided by the verb and not by the noun.
   *
   * "Keep the hedging" and "lose the hedging" name the same tag and mean
   * opposite things, so the tag alone cannot decide — and getting this
   * backwards silently inverts the cut. Each clause is read on its own,
   * because "keep the hard lines but take out the hellos" is one sentence
   * carrying both.
   */
  const DROP_VERB = /\b(take out|lose|drop|cut|remove|bin|get rid of|no more|without)\b/i;
  const KEEP_VERB = /\b(keep|leave in|stay on|hold on to|end on|land on)\b/i;

  for (const clause of text.split(/\b(?:but|and then|,|;|\.)\s*/i)) {
    const c = clause.trim();
    if (!c) continue;
    const tag = TAG_PHRASES.find(([re]) => re.test(c))?.[1];
    if (!tag) continue;
    if (DROP_VERB.test(c)) rules.push({ kind: "drop", tag, on: true, text: c });
    else if (KEEP_VERB.test(c)) rules.push({ kind: "keep", tag, on: true, text: c });
  }

  /* "End on the answer" / "land it on" — keep whatever resolves. */
  if (/\b(end|finish|land|close) (it )?on (the )?(answer|resolution|decision|point)\b/i.test(text)) {
    rules.push({ kind: "keep", tag: "strong", on: true, text: "End on where you land it." });
  }

  for (const [re, rule] of FEELINGS) {
    if (re.test(text) && !rules.some((r) => r.kind === rule.kind)) rules.push({ ...rule });
  }

  if (TIGHTEN.test(text) && !rules.some((r) => r.kind === "cap")) {
    rules.push({
      kind: "cap",
      secs: TIGHTEN_MS / 1000,
      on: true,
      text: "Keep it under three minutes.",
    });
  }

  /*
   * What meant nothing. Only reported when NOTHING parsed: a brief is mostly
   * subject matter ("the bits about the gym"), and listing every clause that
   * was not a rule would be noise on a sentence that worked.
   */
  if (!rules.length) unparsed.push(text);

  return { rules, unparsed };
}

/** The honest reply, when a sentence carried no rule at all. */
export function honestReply(unparsed: string[]): string | null {
  if (!unparsed.length) return null;
  return (
    `Nothing in that changes the cut. What does: ` +
    WHAT_PARSES.map((s) => s.replace(/^[a-z ]+ — /, "")).join("; ") +
    "."
  );
}
