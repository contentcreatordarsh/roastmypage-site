-- Roast My Landing Page — database schema
-- Apply to a fresh D1 database with:
--   npx wrangler d1 execute <db-name> --remote --file schema.sql
-- Reconstructed from the application's queries (src/index.js, src/db.js).

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

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'agency')),
  label TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked);

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
