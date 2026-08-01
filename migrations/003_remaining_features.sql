-- Remaining product features schema (#24/#85/#31/#48/#49/#56/#81)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT,
  tier TEXT DEFAULT 'free',
  daily_limit INTEGER DEFAULT 20,
  requests_today INTEGER DEFAULT 0,
  day_key TEXT,
  webhook_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  roast_id TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  ip_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(roast_id, category)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_hash TEXT,
  email TEXT,
  webhook_url TEXT,
  last_score REAL,
  last_roast_id TEXT,
  notify_on_change INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watchlist_url_hash ON watchlist(url_hash);

CREATE TABLE IF NOT EXISTS scheduled_roasts (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  email TEXT,
  cadence TEXT DEFAULT 'weekly',
  next_run_at TEXT,
  last_run_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
