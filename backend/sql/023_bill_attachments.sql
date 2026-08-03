CREATE TABLE IF NOT EXISTS bill_attachments (
  id TEXT PRIMARY KEY,
  bill_type VARCHAR(16) NOT NULL CHECK (bill_type IN ('rd', 'channel')),
  bill_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(100),
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bill_attachments_parent
ON bill_attachments (bill_type, bill_id, created_at DESC);
