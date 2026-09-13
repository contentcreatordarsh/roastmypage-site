-- Roast My Landing Page — current full schema snapshot.
-- This file is the concatenation of migrations/*.sql (0000_initial + 001_watchlist).
-- Keep it in sync with those files; tests/schema.test.js enforces that.
--
-- Fresh database (either path works):
--   npx wrangler d1 execute <db-name> --local --file schema.sql
--   npx wrangler d1 migrations apply <db-name> --local
-- Do not CREATE TABLE from application code in src/.

CREATE TABLE IF NOT EXISTS roasts (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_hash TEXT,
  screenshot_key TEXT,
  overall_score REAL,
  hero_score REAL,
  cta_score REAL,
  trust_score REAL,
  copy_score REAL,
  design_score REAL,
  roast_response TEXT,
  quick_wins TEXT,
  country TEXT,
  seo_data TEXT,
  performance_data TEXT,
  heatmap_data TEXT,
  industry TEXT DEFAULT 'other',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_roasts_url_hash ON roasts(url_hash);
CREATE INDEX IF NOT EXISTS idx_roasts_created_at ON roasts(created_at);
CREATE INDEX IF NOT EXISTS idx_roasts_industry ON roasts(industry);
CREATE INDEX IF NOT EXISTS idx_roasts_score ON roasts(overall_score);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT PRIMARY KEY,
  request_count INTEGER DEFAULT 0,
  window_start TEXT,
  last_request TEXT
);

CREATE TABLE IF NOT EXISTS visitors (
  country TEXT PRIMARY KEY,
  visited_at TEXT
);

CREATE TABLE IF NOT EXISTS email_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  roast_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_opt_outs (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  vote TEXT NOT NULL,
  context TEXT,
  reasons TEXT,
  message TEXT,
  email TEXT,
  roast_id TEXT,
  url TEXT,
  ip_hash TEXT,
  country TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- API v1 daily quotas are kept in D1 so increments and limit checks happen
-- atomically. Old days remain queryable for audits and can be pruned safely.
CREATE TABLE IF NOT EXISTS api_v1_counters (
  day_key TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (day_key, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_api_v1_counters_day ON api_v1_counters(day_key);

-- #49 Competitor watchlists — owner_key is a client-generated UUID (no accounts).
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
