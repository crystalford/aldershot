/**
 * THE TEST DATABASE AND THE REAL ONE, ABOUT THE SAME TABLES.
 *
 * test/helpers/fake-d1.ts declares its own CREATE TABLE statements, by hand,
 * and `migrations/schema.sql` is generated from the code that actually runs.
 * They drift, and the drift is invisible: a test exercising a query against a
 * column the fixture never heard of throws "no such column" from inside
 * whatever it was really testing, and the obvious reading is that the thing
 * under test is broken.
 *
 * That happened. `v2_projects.scope` has been real since attach was built and
 * the fixture never had it, so the first function to read it took the proxy
 * test down with an error about SQL.
 *
 * This does not demand the fixture carry every table — it carries the ones
 * its tests need, which is right. It demands that the tables it DOES carry
 * have every column the real one has, so a query that works in production
 * works here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { schema } from "./helpers/fake-d1.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/* Both kinds of comment go first. The file's own header contains
   "(ensureV2Schema and ...)", and a stray paren in a line comment made the
   first version read a column called `ensureV2Schema`. */
const SQL = readFileSync(join(root, "migrations/schema.sql"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

/** Every column the generated document gives a table, added ones included. */
function realColumns(table: string): Set<string> | null {
  const create = SQL.split(";").find((s) =>
    new RegExp(`create table if not exists ${table}\\s*\\(`, "i").test(s),
  );
  if (!create) return null;

  /* From the paren that follows the TABLE NAME, not the first one in the
     chunk — anything before the CREATE is not this statement. */
  const from = create.toLowerCase().indexOf(table.toLowerCase()) + table.length;
  const body = create.slice(create.indexOf("(", from) + 1, create.lastIndexOf(")"));
  const cols = new Set<string>();
  /* Split on top-level commas: a type like DECIMAL(10,2) would otherwise
     produce a column called "2". */
  let depth = 0;
  let piece = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      cols.add(piece.trim().split(/\s+/)[0]);
      piece = "";
    } else piece += ch;
  }
  if (piece.trim()) cols.add(piece.trim().split(/\s+/)[0]);

  for (const m of SQL.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/gi)) {
    if (m[1].toLowerCase() === table.toLowerCase()) cols.add(m[2]);
  }

  /*
   * Table constraints are not columns, and `UNIQUE(source_id, idx)` arrives
   * as the single token `UNIQUE(source_id,` — so this matches the keyword
   * at the start rather than the whole word, which is what let two of them
   * through as columns nobody could ever add.
   */
  const CONSTRAINT = /^(UNIQUE|PRIMARY|FOREIGN|CHECK|CONSTRAINT)\b/i;
  for (const c of [...cols]) if (CONSTRAINT.test(c)) cols.delete(c);
  return cols;
}

test("the test database has every column the real one has", () => {
  const db = new DatabaseSync(":memory:");
  schema(db);

  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  ).map((r) => r.name);
  assert.ok(tables.length > 5, "the fixture declares tables at all");

  const missing: string[] = [];
  for (const table of tables) {
    const real = realColumns(table);
    /* A table the fixture invents for its own purposes is its business. */
    if (!real) continue;
    const have = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name),
    );
    for (const col of real) {
      if (!have.has(col)) missing.push(`${table}.${col}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    "add these to test/helpers/fake-d1.ts — a query that works in production must work in a test",
  );
});
