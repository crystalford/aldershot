/**
 * A PASTED BRIEF, COMPILED INTO RULES YOU CAN SEE AND SWITCH OFF.
 *
 * Phase 5's acceptance names the sentence: "hooks in 2s, 20–40s, no
 * politics, we need 8" compiles to four visible rules with a shortlist diff.
 *
 * THIS IS WHAT RULES ARE FOR. A brief handed to a model that returned a
 * shortlist would be a black box with a paste box on the front; a brief
 * compiled into four rows in the rules pane is a thing a person can read,
 * argue with, and switch off one at a time — invariant 1, and the whole
 * difference between this product and a prompt.
 *
 * REGEXES, NOT A MODEL CALL, for the reason src/rule-parse.ts gives about
 * the same job: a rule is the thing the user can see and switch off, so it
 * has to be the same rule every time the same brief is pasted. A model that
 * read "20–40s" as a cap today and a length tomorrow makes the pane
 * untrustworthy in a way no accuracy figure fixes.
 *
 * AND THE RULE READS AS WHAT THEY WROTE. Invariant 10 — "the user's own
 * words win where they exist" — so the rule's text is the clause, tidied,
 * rather than a restatement of it in our vocabulary.
 */

import { compute, ruleEffect, type Rule } from "./rules.ts";
import { parseRules, type Parsed } from "./rule-parse.ts";
import { NOISE } from "./moment-tags.ts";

/** Written-out numbers people actually paste. */
const SPOKEN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

const num = (raw: string): number | null => {
  const t = raw.trim().toLowerCase();
  if (SPOKEN[t] !== undefined) return SPOKEN[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Seconds, however they were written. */
const SECS = String.raw`(\d+)\s*(?:s\b|secs?\b|seconds?\b)`;

/*
 * THE FOUR SHAPES A SHORTS BRIEF IS MADE OF.
 *
 * Ordered most specific first: "hooks in 2s" contains a number and a
 * seconds unit and would be read as a length by a looser pattern, so the
 * hook is asked about before the length is.
 */
const HOOK = new RegExp(String.raw`\bhooks?\b[^.,;]*?\b(?:in|within|by|inside)\s+${SECS}`, "i");
const RANGE = new RegExp(String.raw`\b(\d+)\s*(?:–|—|-|to)\s*${SECS}`, "i");
const UNDER = new RegExp(String.raw`\b(?:under|below|less than|no longer than|max(?:imum)?(?: of)?)\s+${SECS}`, "i");
const OVER = new RegExp(String.raw`\b(?:over|above|at least|longer than|min(?:imum)?(?: of)?)\s+${SECS}`, "i");
const COUNT = new RegExp(
  String.raw`\b(?:we need|need|give me|want|make me|make|about)\s+(\d+|${Object.keys(SPOKEN).join("|")})\b` +
    String.raw`|\b(\d+|${Object.keys(SPOKEN).join("|")})\s+(?:shorts?|clips?|of them)\b`,
  "i",
);
const AVOID = /\b(?:no|nothing about|avoid|keep out|without|stay off|skip)\s+([a-z][a-z' -]{2,30})/gi;

/**
 * THE SUBJECT IN "no politics", as the words a moment would have to say.
 *
 * Stop words go, because "no the gym stuff" is about the gym — and a rule
 * matching "the" would take the whole library out in one row.
 */
export function subjectWords(phrase: string): string[] {
  return [
    ...new Set(
      phrase
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .filter((w) => w.length > 2 && !NOISE.has(w)),
    ),
  ].slice(0, 4);
}

/** One clause, tidied, as it will read in the rules pane. */
const sentence = (clause: string): string => {
  const t = clause.trim().replace(/\s+/g, " ").replace(/[,;]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
};

/**
 * Compile a brief.
 *
 * Anything that is not one of the four shapes is handed to
 * `parseRules` — the editing-sentence parser — because a brief often
 * carries an ordinary instruction too ("lead with the best line"), and a
 * compiler that dropped those would silently lose half of what was pasted.
 *
 * `unparsed` names what meant nothing, so the reply can say so rather than
 * quietly producing three rules from a brief that had five clauses in it.
 */
export function compileBrief(text: string): Parsed {
  const brief = text.trim();
  const rules: Array<Omit<Rule, "id">> = [];
  if (!brief) return { rules, unparsed: [] };

  const used: string[] = [];
  const take = (m: RegExpMatchArray | null): RegExpMatchArray | null => {
    if (m) used.push(m[0]);
    return m;
  };

  /* Hooks first: it contains a number and a seconds unit, so a looser
     length pattern would eat it. */
  const hook = take(brief.match(HOOK));
  if (hook) {
    rules.push({ kind: "hook", secs: Number(hook[1]), on: true, text: sentence(hook[0]) });
  }

  const range = take(brief.match(RANGE));
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    rules.push({ kind: "len", minSecs: lo, maxSecs: hi, on: true, text: sentence(range[0]) });
  } else {
    /* An open-ended bound on either side is still a length. Both can be
       written, and then they are one rule — applyRule keeps one `len`. */
    const under = take(brief.match(UNDER));
    const over = take(brief.match(OVER));
    if (under || over) {
      rules.push({
        kind: "len",
        ...(over ? { minSecs: Number(over[1]) } : {}),
        ...(under ? { maxSecs: Number(under[1]) } : {}),
        on: true,
        text: sentence([over?.[0], under?.[0]].filter(Boolean).join(", ")),
      });
    }
  }

  const count = take(brief.match(COUNT));
  if (count) {
    const n = num(count[1] ?? count[2] ?? "");
    if (n !== null && n > 0) rules.push({ kind: "count", n, on: true, text: sentence(count[0]) });
  }

  /*
   * EVERY "no X" IN THE BRIEF, not just the first. A brief saying "no
   * politics, no work stuff" means both, and taking one would be a rule
   * pane that looks complete and is not.
   */
  for (const m of brief.matchAll(AVOID)) {
    const words = subjectWords(m[1]);
    if (!words.length) continue;
    used.push(m[0]);
    rules.push({ kind: "drop", words, on: true, text: sentence(m[0]) });
  }

  /*
   * AND THE REST, through the editing-sentence parser. A brief often
   * carries an ordinary instruction — "lead with the best line" — and a
   * compiler that dropped those would silently lose half of what was
   * pasted.
   */
  let rest = brief;
  for (const u of used) rest = rest.replace(u, " ");
  const over = parseRules(rest);
  for (const r of over.rules) {
    if (!rules.some((x) => x.kind === r.kind)) rules.push(r);
  }

  /* What meant nothing, only when the whole brief did. A brief is mostly
     subject matter, and listing every clause that was not a rule would be
     noise on one that worked. */
  return { rules, unparsed: rules.length ? [] : [brief] };
}

/* ── What it did to the shortlist ───────────────────────────────────────── */

export interface RuleDiff {
  rule: Rule;
  /** Moments this rule takes off the shortlist, given the others. */
  removed: number;
  /** And any it puts back — a keep rule can. */
  added: number;
}

export interface BriefDiff {
  /** How many moments there were before any of this ran. */
  before: number;
  /** And after. */
  after: number;
  rules: RuleDiff[];
  /** The count rule's number, when one was asked for and not reached. */
  short: number | null;
}

/**
 * THE SHORTLIST DIFF the acceptance asks for, per rule.
 *
 * Each line is `ruleEffect` — the cut computed with the rule on and with it
 * off — which is the same diff the rules pane shows for a hand-written rule
 * and is why a compiled brief is not a special case. A rule that removes
 * nothing says so; "nothing here touches it" is a real answer and a more
 * useful one than silence.
 *
 * AND WHETHER IT REACHED THE NUMBER. "We need 8" against a library that can
 * only produce five is the one thing a person pasting a brief most needs to
 * be told, and it is the thing a shortlist of five quietly does not say.
 */
export function shortlistDiff(
  rules: Rule[],
  opts: Parameters<typeof compute>[1],
): BriefDiff {
  const before = compute(
    rules.map((r) => ({ ...r, on: false })),
    opts,
  );
  const after = compute(rules, opts);

  const want = rules.find((r) => r.on && r.kind === "count")?.n;
  const got = after.st.filter((m) => m.in).length;

  return {
    before: before.st.filter((m) => m.in).length,
    after: got,
    rules: rules.map((rule) => {
      const e = ruleEffect(rules, rule, opts);
      return { rule, removed: e.removed, added: e.added };
    }),
    short: typeof want === "number" && got < want ? want - got : null,
  };
}
