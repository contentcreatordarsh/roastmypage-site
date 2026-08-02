CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  roast_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('fixed', 'wontfix')),
  note TEXT,
  owner_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (roast_id, owner_key, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_annotations_roast_owner ON annotations(roast_id, owner_key);
