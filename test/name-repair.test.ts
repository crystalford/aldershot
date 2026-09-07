/**
 * Never greet somebody by a name they do not have.
 *
 * nameFromEmail refuses a run-on longer than twelve letters exactly so
 * "chrisrobtelford@" does not become "Chrisrobtelford" — the fidelity sign-off
 * on the greeting says a mangled surname-mashup is worse than dropping the
 * vocative. But it only runs when an account is CREATED, so a row made before
 * the rule kept its bad name, and the owner's own Home read "Good morning,
 * Chrisrobtelford." while the function that made it had long been fixed.
 *
 * The shipped SQL is lifted from the source so this cannot pass against a copy
 * that has drifted from what runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { repairName } from "../src/user.ts";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE v2_users(id TEXT PRIMARY KEY, email TEXT, name TEXT)`);
  const ins = db.prepare(`INSERT INTO v2_users VALUES(?,?,?)`);
  ins.run('u1', 'chrisrobtelford@gmail.com', 'Chrisrobtelford');
  ins.run('u2', 'chris.telford@gmail.com', 'Chris');
  ins.run('u3', 'someone@example.com', 'Ada Lovelace');
  ins.run('u4', 'nobody@example.com', null);
  const nameOf = (id: string) =>
    (db.prepare(`SELECT name FROM v2_users WHERE id=?`).get(id) as { name: string | null }).name;
  return { db, nameOf };
}

/* The thinnest D1 stand-in that repairName needs: prepare/bind/run. */
const shim = (db: DatabaseSync) => ({
  prepare: (sql: string) => ({
    bind: (...a: string[]) => ({ run: async () => db.prepare(sql).run(...a) }),
  }),
});

test("a run-on the rule now refuses is cleared", async () => {
  const w = world();
  const out = await repairName(shim(w.db) as never, { id: 'u1', email: 'chrisrobtelford@gmail.com', name: 'Chrisrobtelford' } as never);
  assert.equal(out.name, null, 'the greeting must fall back to "Good morning."');
  assert.equal(w.nameOf('u1'), null, 'and it must not come back on the next page load');
});

test("a name the rule would still derive is left alone", async () => {
  const w = world();
  const out = await repairName(shim(w.db) as never, { id: 'u2', email: 'chris.telford@gmail.com', name: 'Chris' } as never);
  assert.equal(out.name, 'Chris');
  assert.equal(w.nameOf('u2'), 'Chris');
});

test("a name a provider gave us is never touched", async () => {
  // Google telling us who somebody is beats any guess from an address.
  const w = world();
  const out = await repairName(shim(w.db) as never, { id: 'u3', email: 'someone@example.com', name: 'Ada Lovelace' } as never);
  assert.equal(out.name, 'Ada Lovelace');
  assert.equal(w.nameOf('u3'), 'Ada Lovelace');
});

test("no name is not a problem to solve", async () => {
  const w = world();
  const out = await repairName(shim(w.db) as never, { id: 'u4', email: 'nobody@example.com', name: null } as never);
  assert.equal(out.name, null);
});
