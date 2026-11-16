/**
 * Bring a stored account into line with today's rules.
 *
 * A CLASS of bug, not one bug: a rule applied when a row is created and never
 * again. Twice in a day, and both are here.
 *
 * ONE — never greet somebody by a name they do not have.
 *
 * nameFromEmail refuses a run-on longer than twelve letters exactly so
 * "alexanderfinch@" does not become "Alexanderfinch" — the fidelity sign-off
 * on the greeting says a mangled surname-mashup is worse than dropping the
 * vocative. But it only runs when an account is CREATED, so a row made before
 * the rule kept its bad name, and the owner's own Home read "Good morning,
 * Chrisrobtelford." while the function that made it had long been fixed.
 *
 * TWO — the owner is metered, never blocked. is_owner was likewise set at
 * INSERT and nowhere else, so a row written before that rule kept is_owner at
 * 0 and every cap in the product applied to the account the product is built
 * on: a 2,674-minute upload refused on Studio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { reconcileUser } from "../src/user.ts";


/*
 * THE OWNER'S ADDRESS IS A FIXTURE NOW, not the owner's actual address.
 *
 * It was the real one, in eight places. That was fine in a private
 * repository and is a personal address published in plain text in a public
 * one, which is exactly what address harvesters read. src/user.ts takes the
 * owner address as an argument for the same reason, so a test can simply say
 * which address it is treating as the owner.
 *
 * The run-on local part is load-bearing and had to be preserved: it is what
 * nameFromEmail refuses, and "Alexanderfinch" is fourteen letters for the
 * same reason the original was fifteen.
 */
const OWNER = "alexanderfinch@example.com";
function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE v2_users(id TEXT PRIMARY KEY, email TEXT, name TEXT, is_owner INTEGER DEFAULT 0, plan TEXT DEFAULT 'free')`);
  const ins = db.prepare(`INSERT INTO v2_users (id,email,name) VALUES(?,?,?)`);
  ins.run('u1', OWNER, 'Alexanderfinch');
  ins.run('u2', 'alexander.finch@example.com', 'Alexander');
  ins.run('u3', 'someone@example.com', 'Ada Lovelace');
  ins.run('u4', 'nobody@example.com', null);
  const nameOf = (id: string) =>
    (db.prepare(`SELECT name FROM v2_users WHERE id=?`).get(id) as { name: string | null }).name;
  const rowOf = (id: string) =>
    db.prepare(`SELECT is_owner, plan FROM v2_users WHERE id=?`).get(id) as { is_owner: number; plan: string };
  return { db, nameOf, rowOf };
}

/* The thinnest D1 stand-in that reconcileUser needs: prepare/bind/run. */
const shim = (db: DatabaseSync) => ({
  prepare: (sql: string) => ({
    bind: (...a: string[]) => ({ run: async () => db.prepare(sql).run(...a) }),
  }),
});

test("a run-on the rule now refuses is cleared", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u1', email: OWNER, name: 'Alexanderfinch' } as never, OWNER);
  assert.equal(out.name, null, 'the greeting must fall back to "Good morning."');
  assert.equal(w.nameOf('u1'), null, 'and it must not come back on the next page load');
});

test("a name the rule would still derive is left alone", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u2', email: 'alexander.finch@example.com', name: 'Alexander' } as never, OWNER);
  assert.equal(out.name, 'Alexander');
  assert.equal(w.nameOf('u2'), 'Alexander');
});

test("a name a provider gave us is never touched", async () => {
  // Google telling us who somebody is beats any guess from an address.
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace' } as never, OWNER);
  assert.equal(out.name, 'Ada Lovelace');
  assert.equal(w.nameOf('u3'), 'Ada Lovelace');
});

test("no name is not a problem to solve", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u4', email: 'nobody@example.com', name: null } as never, OWNER);
  assert.equal(out.name, null);
});

test("an owner row written before the rule is put right", async () => {
  /* Without this the fix to checkCap does nothing: it reads is_owner, and
     is_owner was only ever written at INSERT. */
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u1', email: OWNER, name: null, is_owner: 0, plan: 'free',
  } as never, OWNER);
  assert.equal(out.is_owner, 1);
  assert.equal(out.plan, 'studio');
  assert.equal(w.rowOf('u1').is_owner, 1, 'the repair was not written down');
  assert.equal(w.rowOf('u1').plan, 'studio');
});

test("nobody else is promoted, whatever their row says", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace', is_owner: 0, plan: 'free',
  } as never, OWNER);
  assert.equal(out.is_owner, 0);
  assert.equal(out.plan, 'free');
  assert.equal(w.rowOf('u3').is_owner, 0);
});

test("a row already correct is not written to", async () => {
  /* This runs on every visit to Home, so a no-op has to be a no-op. */
  const w = world();
  let writes = 0;
  const counting = {
    prepare: (sql: string) => ({
      bind: (...a: string[]) => ({ run: async () => { writes++; return w.db.prepare(sql).run(...a); } }),
    }),
  };
  await reconcileUser(counting as never, {
    id: 'u1', email: OWNER, name: null, is_owner: 1, plan: 'studio',
  } as never, OWNER);
  assert.equal(writes, 0, 'a correct row was rewritten on the way past');
});

test("both repairs happen in one pass", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u1', email: OWNER, name: 'Alexanderfinch', is_owner: 0, plan: 'free',
  } as never, OWNER);
  assert.equal(out.name, null);
  assert.equal(out.is_owner, 1);
  assert.equal(w.nameOf('u1'), null);
  assert.equal(w.rowOf('u1').is_owner, 1);
});

/*
 * ── The owner address became configuration on 15 Nov 2026 ──────────────────
 *
 * It was a literal in src/user.ts and the repository went public, so it is a
 * secret now (OWNER_EMAIL). That turns one comparison into three cases, and
 * only one of them was ever exercised before these tests.
 */

test("ACCEPTANCE: with no owner address configured, nobody is the owner", async () => {
  /*
   * THE DANGEROUS ONE, and the reason isOwnerEmail is a function rather than
   * an inline `===`. Written as `email === ownerEmail` with both unset, every
   * account on the product becomes the owner the moment the secret goes
   * missing — uncapped, and holding the cost panel. The guard clause is the
   * whole point of the function and this is what pins it.
   */
  const w = world();

  /*
   * EVERY SHAPE OF "NOT CONFIGURED", because the first version of this test
   * used only `undefined` — and `email === undefined` is false for any
   * string, so deleting the guard outright failed nothing. The test was
   * asserting something JavaScript already guaranteed.
   *
   * The pair that actually needs the guard is an EMPTY secret against an
   * empty address: "" === "" is true, and that account would be uncapped and
   * holding the cost panel. A blank repo secret and a `wrangler secret put`
   * that took an empty line both produce exactly that.
   */
  const unconfigured = [undefined, '', '   ', '\n'];
  const addresses = [OWNER, 'someone@example.com', '', '   '];

  for (const ownerEmail of unconfigured) {
    for (const email of addresses) {
      const out = await reconcileUser(
        shim(w.db) as never,
        { id: 'u1', email, name: null, is_owner: 0, plan: 'free' } as never,
        ownerEmail,
      );
      assert.equal(
        out.is_owner,
        0,
        `owner=${JSON.stringify(ownerEmail)} made ${JSON.stringify(email)} the owner`,
      );
      assert.equal(out.plan, 'free');
    }
  }
  assert.equal(w.rowOf('u1').is_owner, 0, 'and nothing was written to the row');
});

test("an address that is not the configured one is not the owner", async () => {
  const w = world();
  const out = await reconcileUser(
    shim(w.db) as never,
    { id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace', is_owner: 0, plan: 'free' } as never,
    OWNER,
  );
  assert.equal(out.is_owner, 0);
  assert.equal(out.plan, 'free');
});

test("ACCEPTANCE: configuring the address later promotes the account on the next pass", async () => {
  /*
   * src/env.ts claims this in so many words — "unset means nobody is the
   * owner, and that is safe rather than quietly wrong, because reconcileUser
   * brings a stale row into line on the next page load". A comment asserting
   * a behaviour is not the behaviour, so this is the claim as a test.
   *
   * It is also the real sequence: the secret is not set on aldershot.io yet,
   * so the owner's first sign-in will create an ordinary account, and setting
   * OWNER_EMAIL afterwards has to be enough.
   */
  const w = world();
  const row = { id: 'u1', email: OWNER, name: null, is_owner: 0, plan: 'free' };

  const before = await reconcileUser(shim(w.db) as never, row as never, undefined);
  assert.equal(before.is_owner, 0, 'not the owner while nothing is configured');

  const after = await reconcileUser(shim(w.db) as never, row as never, OWNER);
  assert.equal(after.is_owner, 1, 'and the owner once it is');
  assert.equal(after.plan, 'studio');
  assert.equal(w.rowOf('u1').is_owner, 1, 'written through to the row, not only returned');
  assert.equal(w.rowOf('u1').plan, 'studio');
});

test("the comparison is exact, so a case variant cannot claim the account", async () => {
  /*
   * Deliberately not case-folded, which is how it behaved as a literal and
   * is the safer of the two: a provider that treats local parts as
   * case-sensitive would otherwise let a near-miss registration land on the
   * owner's plan.
   */
  const w = world();
  const out = await reconcileUser(
    shim(w.db) as never,
    { id: 'u1', email: OWNER.toUpperCase(), name: null, is_owner: 0, plan: 'free' } as never,
    OWNER,
  );
  assert.equal(out.is_owner, 0);
});
