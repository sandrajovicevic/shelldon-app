CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commitments (
  device_id TEXT NOT NULL,
  id TEXT NOT NULL,
  message TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, id)
);

CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments (sent, due_at);
CREATE INDEX IF NOT EXISTS idx_commitments_device_pending ON commitments (device_id, sent);
