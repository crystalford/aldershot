/**
 * Reading the user's sentence.
 *
 * Home is one text field: "Say what you want out of your footage." What they
 * type decides where they land (01-PRODUCT.md §Home). The prototype does this
 * with regexes and it works well enough to ship as the fast path
 * (04-API-AND-JOBS.md §1) — an LLM call is the fallback, not the default,
 * because it is slower and costs money to answer a question a regex usually
 * gets right.
 *
 * Patterns and copy are copied from the prototype's `readIntent` and
 * `intentLabel`. Order matters: "react to this essay" is a reaction, not an
 * essay, so `react` is tested first.
 */

export type Intent = "extract" | "shorts" | "tighten" | "compose" | "react" | "essay";
export type IntentRead = Intent | "unclear";

const PATTERNS: Array<[IntentRead, RegExp]> = [
  ["react", /\b(react|reaction|respond|commentary|talk over)\b/],
  ["essay", /\b(essay|documentary|argument about|video about)\b/],
  ["shorts", /\b(shorts?|tiktok|reels?|vertical|9:16)\b/],
  ["tighten", /\b(tighten|tidy|clean ?up|polish|remove the ums?|dead air)\b/],
  ["compose", /\b(cut|supercut|trim|montage|assemble|version|down to)\b/],
  ["extract", /\b(clips?|grab|pull|isolate|find|get me|get the)\b/],
];

/** The fast path. Returns "unclear" when nothing matches — never a guess. */
export function readIntent(brief: string): IntentRead {
  const t = (brief || "").toLowerCase();
  if (!t.trim()) return "compose";
  for (const [kind, re] of PATTERNS) if (re.test(t)) return kind;
  return "unclear";
}

/**
 * What the app says it understood, shown under the composer before the user
 * commits. Copied verbatim — these lines are how the product explains itself.
 */
export function intentLabel(brief: string): string {
  switch (readIntent(brief)) {
    case "extract":
      return "Reads as a clip job — the clips land in Footage, tagged. Nothing to assemble.";
    case "shorts":
      return "Reads as a shorts run — vertical and captioned, waiting in Clipping.";
    case "react":
      return "Reads as a reaction — a project with room between the blocks for your voice.";
    case "essay":
      return "Reads as an essay — five acts, built out of footage you've already kept.";
    case "unclear":
      return "Could go two ways. Begin and it'll check before spending the time.";
    default:
      return "Reads as a cut — this becomes a project you can come back to.";
  }
}

/**
 * What an intent produces. `extract` deliberately makes no project — the clips
 * land in Footage and there is nothing to assemble (01-PRODUCT.md's table).
 */
export const INTENT_KIND: Record<Intent, "cut" | "reaction" | "essay" | null> = {
  extract: null,
  shorts: null,
  tighten: "cut",
  compose: "cut",
  react: "reaction",
  essay: "essay",
};
