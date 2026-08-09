/**
 * Better Auth, self-hosted in the same D1 database as everything else — no
 * third-party auth vendor. Workers are stateless per request, so `auth()` is a
 * factory (never a module-level singleton): each request builds a fresh
 * instance over that request's D1 binding.
 */
import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import type { Context, Next } from "hono";
import type { Env } from "./env";
import { claimUnownedRows } from "./tenancy";

/** Matches the schema `npx @better-auth/cli generate` produces for this
 *  better-auth version — see migrations/0004_auth.sql for the mirror. This
 *  project has no migration runner (tables are created lazily on first
 *  request, like every other `ensure*Schema` here), so better-auth's own
 *  CLI-driven migration flow doesn't apply. */
export async function ensureAuthSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS user (
         id TEXT NOT NULL PRIMARY KEY,
         name TEXT NOT NULL,
         email TEXT NOT NULL UNIQUE,
         emailVerified INTEGER NOT NULL,
         image TEXT,
         createdAt DATE NOT NULL,
         updatedAt DATE NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS session (
         id TEXT NOT NULL PRIMARY KEY,
         expiresAt DATE NOT NULL,
         token TEXT NOT NULL UNIQUE,
         createdAt DATE NOT NULL,
         updatedAt DATE NOT NULL,
         ipAddress TEXT,
         userAgent TEXT,
         userId TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS account (
         id TEXT NOT NULL PRIMARY KEY,
         accountId TEXT NOT NULL,
         providerId TEXT NOT NULL,
         userId TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
         accessToken TEXT,
         refreshToken TEXT,
         idToken TEXT,
         accessTokenExpiresAt DATE,
         refreshTokenExpiresAt DATE,
         scope TEXT,
         password TEXT,
         createdAt DATE NOT NULL,
         updatedAt DATE NOT NULL
       )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS verification (
         id TEXT NOT NULL PRIMARY KEY,
         identifier TEXT NOT NULL,
         value TEXT NOT NULL,
         expiresAt DATE NOT NULL,
         createdAt DATE NOT NULL,
         updatedAt DATE NOT NULL
       )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS session_userId_idx ON session (userId)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS account_userId_idx ON account (userId)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier)`),
  ]);
}

/** A fixed fallback so `wrangler dev` works unconfigured; production always
 *  sets BETTER_AUTH_SECRET via `wrangler secret put` (see deploy.yml). */
const DEV_SECRET = "aldershot-dev-only-secret-do-not-use-in-production-xxxxxxxx";

export function auth(env: Env) {
  return betterAuth({
    database: {
      dialect: new D1Dialect({ database: env.DB }),
      type: "sqlite",
    },
    secret: env.BETTER_AUTH_SECRET || DEV_SECRET,
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string }) => {
            await claimUnownedRows(env.DB, user.id);
          },
        },
      },
    },
  });
}

/** Requires a valid session on every /api/* route except the ones excluded
 *  in src/index.ts (health check, and better-auth's own routes). Sets
 *  `userId` in context for every downstream handler. */
export async function requireUser(c: Context<{ Bindings: Env; Variables: { userId: string } }>, next: Next) {
  await ensureAuthSchema(c.env.DB);
  const session = await auth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
}
