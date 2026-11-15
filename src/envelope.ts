/**
 * THE INTEGRITY ENVELOPE.
 *
 * A claim and its qualifier. An accusation and its response. Propositions that
 * mean something different apart from what they mean together, and which every
 * rendering of a cut has to preserve — a 90-second version and a 30-second
 * version can disagree about what is in them, and cannot disagree about that.
 *
 * `09-EXPORT-AND-INTEGRITY.md` calls these must-keep / never-separate rules
 * and says they are solver constraints rather than warnings: "a variant that
 * would split them does not render". It is also what makes the fragment
 * self-sufficiency test in src/shorts.ts a guarantee rather than a check —
 * that measures whether a moment stands alone, and this is what stops the
 * length dial from taking the half that made it stand alone.
 *
 * WHO MAY SPLIT A PAIR. The four reducers in compute() — cap, len, hook,
 * count — may not, ever, and are made group-aware rather than trusted. A
 * person may: a hand cut is an explicit instruction about one moment and
 * step 6 of the engine is documented as overriding everything above it.
 * The difference is that the person is told, by splitBindings at the export
 * boundary, and the solver is not asked to guess which it was.
 *
 * ONE DEPARTURE FROM THE DATA MODEL. Doc 03 writes the params as
 * (cid_a, cid_b), two columns, exactly two moments. This uses `cids`, the
 * column the rules table already has for "the moments this rule names", and
 * accepts two or more. "Never separate" has no natural arity — an accusation,
 * its response and the qualifier on the response are three — and a pair of
 * columns would have made the three-moment case two rules that each hold half
 * a fact. Bindings are transitive here for the same reason: a-b and b-c is
 * one group of three, not two groups that disagree about b.
 */

import type { Rule } from "./rules.ts";

type Id = number | string;

export interface Binding {
  /** Every moment tied together, in the order the rules first named them. */
  ids: Id[];
  /** The must_keep rules that tied them. Several, once a group is transitive. */
  ruleIds: Array<Rule["id"]>;
}

/**
 * The ids keyed as strings throughout.
 *
 * A moment id is `number | string` in the engine and the reference set uses
 * numbers while everything stored uses strings, so 7 and "7" are the same
 * moment and would be two keys in a Map. One conversion, here, and the
 * returned ids are whatever the rule carried.
 */
const key = (id: Id): string => String(id);

/**
 * The must_keep rules that name at least two moments, as transitive groups.
 *
 * Only rules that are ON. A switched-off must-keep is a constraint the person
 * has lifted, and invariant 6 says rules switch off rather than being deleted,
 * so this is the normal way to stop one applying.
 */
export function bindings(rules: Rule[]): Binding[] {
  /* Union-find over the ids, so a-b and b-c collapse into one group. */
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    /* Path compression, so a long chain of pairs does not make this quadratic. */
    let walk = k;
    while (parent.get(walk) !== r) {
      const next = parent.get(walk) ?? r;
      parent.set(walk, r);
      walk = next;
    }
    return r;
  };
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };

  /* The ids in the order first named, and the rules that named each group. */
  const order: Id[] = [];
  const rulesFor = new Map<string, Array<Rule["id"]>>();

  for (const r of rules) {
    if (!r.on || r.kind !== "must_keep") continue;
    const ids = (r.cids ?? []).filter((id) => id !== undefined && id !== null);
    /* A must-keep naming one moment is not a constraint on anything; naming
       none is a rule with no subject. Both are ignored rather than throwing:
       the rules pane can hold a half-built rule while someone writes it. */
    if (ids.length < 2) continue;
    for (const id of ids) {
      if (!parent.has(key(id))) order.push(id);
      add(key(id));
    }
    /* Everything this rule names joins the first one's group. */
    const root = find(key(ids[0]));
    for (const id of ids.slice(1)) {
      const other = find(key(id));
      if (other !== root) parent.set(other, root);
    }
    const at = rulesFor.get(find(key(ids[0]))) ?? [];
    at.push(r.id);
    rulesFor.set(find(key(ids[0])), at);
  }

  /* Collect the groups, each in the order its members were first named. */
  const groups = new Map<string, Id[]>();
  for (const id of order) {
    const root = find(key(id));
    const at = groups.get(root) ?? [];
    at.push(id);
    groups.set(root, at);
  }

  return [...groups.entries()].map(([root, ids]) => ({
    ids,
    /* The rule ids collected under whichever root each rule saw at the time,
       re-gathered under the final root — merging two groups moves one of them. */
    ruleIds: [...new Set(
      [...rulesFor.entries()].filter(([k2]) => find(k2) === root).flatMap(([, v]) => v),
    )],
  }));
}

/**
 * Every binding that ended up half in the cut.
 *
 * The export boundary's assertion, and the only thing that makes the envelope
 * a guarantee rather than four careful reducers. It is deliberately ignorant of
 * WHY a group is split — a hand cut, a drop rule, or a reducer that stopped
 * being group-aware because somebody added a fifth one. All three produce a
 * cut that says something the footage does not, and all three are worth
 * stopping an export for.
 *
 * `present` is what the footage set holds, which is not the same as what the
 * cut kept: compute() can be scoped to one source, and a pair spanning two
 * sources would otherwise read as permanently split in either scope. A member
 * that is not present is counted on neither side.
 *
 * There is deliberately no "fewer than two present members" guard. One was
 * written and then deleted, because breaking it changed no behaviour and no
 * test: with a single present member, kept is either 0 or 1 and the condition
 * below needs it to be both more than 0 and fewer than 1. A redundant check
 * reads as load-bearing to whoever edits this next.
 */
export function splitBindings(
  bs: Binding[],
  present: (id: Id) => boolean,
  kept: (id: Id) => boolean,
): Binding[] {
  return bs.filter((b) => {
    const here = b.ids.filter(present);
    const inCut = here.filter(kept).length;
    return inCut > 0 && inCut < here.length;
  });
}

/**
 * What to say about a split, in the product's words rather than a rule id.
 *
 * No numbers: invariant 3. The sentence names the thing that would go out
 * alone, because that is the decision in front of the person.
 */
export function splitLine(b: Binding, textOf: (id: Id) => string | undefined, kept: (id: Id) => boolean): string {
  const out = b.ids.filter((id) => !kept(id));
  const first = out.map((id) => textOf(id)).find((t) => !!t);
  const what = first ? `"${first.slice(0, 60)}${first.length > 60 ? "…" : ""}"` : "the other half";
  return `This cut keeps one half of something that was marked never to separate. ${what} would go out on its own.`;
}
