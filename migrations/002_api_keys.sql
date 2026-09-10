-- #85 / #24 Public API key system for /api/v1
-- Apply with:
--   npx wrangler d1 execute roast-db-dev --local --file migrations/002_api_keys.sql
--   npx wrangler d1 execute roast-db-dev --remote --file migrations/002_api_keys.sql
--   npx wrangler d1 execute roast-db --remote --env production --file migrations/002_api_keys.sql

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'agency')),
  label TEXT,
  daily_limit INTEGER NOT NULL DEFAULT 50,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

CREATE TABLE IF NOT EXISTS api_usage (
  key_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (key_id, day_key)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage(day_key);
