-- Retrofits per-account ownership onto tables that predate auth. Every
-- table below is scoped to a single owning user from here on; clip_segments
-- and clip_tags are deliberately left alone since every existing query
-- already reaches them through their parent clip's id, so ownership is
-- enforced through that clip's user_id rather than a redundant column.
-- (Also created lazily by ensureTenancySchema in src/tenancy.ts, so local
-- dev works without applying migrations; run this against prod D1. SQLite
-- has no `ADD COLUMN IF NOT EXISTS` — ensureTenancySchema checks
-- PRAGMA table_info first, which this plain mirror can't express.)

ALTER TABLE projects ADD COLUMN user_id TEXT;
ALTER TABLE videos ADD COLUMN user_id TEXT;
ALTER TABLE clips ADD COLUMN user_id TEXT;
ALTER TABLE visual_tags ADD COLUMN user_id TEXT;
