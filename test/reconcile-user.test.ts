/**
 * Bring a stored account into line with today's rules.
 *
 * A CLASS of bug, not one bug: a rule applied when a row is created and never
 * again. Twice in a day, and both are here.
 *
 * ONE — never greet somebody by a name they do not have.
 *
 * nameFromEmail refuses a run-on longer than twelve letters exactly so
 * "chrisrobtelford@" does not become "Chrisrobtelford" — the fidelity sign-off
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { reconcileUser } from "../src/user.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE v2_users(id TEXT PRIMARY KEY, email TEXT, name TEXT, is_owner INTEGER DEFAULT 0, plan TEXT DEFAULT 'free')`);
  const ins = db.prepare(`INSERT INTO v2_users (id,email,name) VALUES(?,?,?)`);
  ins.run('u1', 'chrisrobtelford@gmail.com', 'Chrisrobtelford');
  ins.run('u2', 'chris.telford@gmail.com', 'Chris');
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
  const out = await reconcileUser(shim(w.db) as never, { id: 'u1', email: 'chrisrobtelford@gmail.com', name: 'Chrisrobtelford' } as never);
  assert.equal(out.name, null, 'the greeting must fall back to "Good morning."');
  assert.equal(w.nameOf('u1'), null, 'and it must not come back on the next page load');
});

test("a name the rule would still derive is left alone", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u2', email: 'chris.telford@gmail.com', name: 'Chris' } as never);
  assert.equal(out.name, 'Chris');
  assert.equal(w.nameOf('u2'), 'Chris');
});

test("a name a provider gave us is never touched", async () => {
  // Google telling us who somebody is beats any guess from an address.
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace' } as never);
  assert.equal(out.name, 'Ada Lovelace');
  assert.equal(w.nameOf('u3'), 'Ada Lovelace');
});

test("no name is not a problem to solve", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, { id: 'u4', email: 'nobody@example.com', name: null } as never);
  assert.equal(out.name, null);
});

test("an owner row written before the rule is put right", async () => {
  /* Without this the fix to checkCap does nothing: it reads is_owner, and
     is_owner was only ever written at INSERT. */
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u1', email: 'chrisrobtelford@gmail.com', name: null, is_owner: 0, plan: 'free',
  } as never);
  assert.equal(out.is_owner, 1);
  assert.equal(out.plan, 'studio');
  assert.equal(w.rowOf('u1').is_owner, 1, 'the repair was not written down');
  assert.equal(w.rowOf('u1').plan, 'studio');
});

test("nobody else is promoted, whatever their row says", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace', is_owner: 0, plan: 'free',
  } as never);
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
    id: 'u1', email: 'chrisrobtelford@gmail.com', name: null, is_owner: 1, plan: 'studio',
  } as never);
  assert.equal(writes, 0, 'a correct row was rewritten on the way past');
});

test("both repairs happen in one pass", async () => {
  const w = world();
  const out = await reconcileUser(shim(w.db) as never, {
    id: 'u1', email: 'chrisrobtelford@gmail.com', name: 'Chrisrobtelford', is_owner: 0, plan: 'free',
  } as never);
  assert.equal(out.name, null);
  assert.equal(out.is_owner, 1);
  assert.equal(w.nameOf('u1'), null);
  assert.equal(w.rowOf('u1').is_owner, 1);
});
