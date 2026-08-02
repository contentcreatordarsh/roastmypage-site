-- #49 Competitor watchlists with score change alerts
-- Apply with:
--   npx wrangler d1 execute roast-db-dev --remote --file migrations/001_watchlist.sql
--   npx wrangler d1 execute roast-db --remote --env production --file migrations/001_watchlist.sql

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  url TEXT NOT NULL,
  url_hash TEXT,
  label TEXT,
  email TEXT,
  webhook_url TEXT,
  last_score REAL,
  last_roast_id TEXT,
  notify_on_change INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watchlist_owner ON watchlist(owner_key);
CREATE INDEX IF NOT EXISTS idx_watchlist_active ON watchlist(active, notify_on_change, updated_at);

CREATE TABLE IF NOT EXISTS watchlist_alerts (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  url TEXT NOT NULL,
  previous_score REAL,
  new_score REAL,
  roast_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watchlist_alerts_owner ON watchlist_alerts(owner_key, created_at);
