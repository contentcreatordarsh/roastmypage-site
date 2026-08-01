-- Apply on existing D1 databases after deploying schema updates for #19/#26/#40/#83.
-- Fresh installs can use schema.sql alone.

ALTER TABLE roasts ADD COLUMN device TEXT DEFAULT 'desktop';
ALTER TABLE roasts ADD COLUMN full_page INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS opt_out_requests (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  hostname TEXT,
  roast_count INTEGER DEFAULT 0,
  ip_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opt_out_hostname ON opt_out_requests(hostname);
