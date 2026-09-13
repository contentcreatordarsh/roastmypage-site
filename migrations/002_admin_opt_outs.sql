-- #81 / #66 Admin dashboard — email opt-out list
-- Apply with:
--   npx wrangler d1 execute roast-db-dev --remote --file migrations/002_admin_opt_outs.sql
--   npx wrangler d1 execute roast-db --remote --env production --file migrations/002_admin_opt_outs.sql
--
-- Gallery hide/feature flags live in KV (CONFIG key admin:moderation), not D1.

CREATE TABLE IF NOT EXISTS email_opt_outs (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
