CREATE TABLE IF NOT EXISTS roast_schedules (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  next_run_at TEXT NOT NULL,
  last_roast_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_roast_schedules_owner ON roast_schedules(owner_key, active);
CREATE INDEX IF NOT EXISTS idx_roast_schedules_due ON roast_schedules(active, next_run_at);
