CREATE TABLE IF NOT EXISTS opt_outs (
  id TEXT PRIMARY KEY,
  url TEXT,
  url_hash TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opt_outs_url_hash ON opt_outs(url_hash);
CREATE INDEX IF NOT EXISTS idx_opt_outs_created_at ON opt_outs(created_at);
