CREATE TABLE IF NOT EXISTS bill_archive_states (
  bill_type VARCHAR(16) NOT NULL,
  bill_id TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by_user_id TEXT,
  archived_by_email TEXT,
  archive_source VARCHAR(16) NOT NULL DEFAULT 'manual',
  closure_at TIMESTAMPTZ,
  PRIMARY KEY (bill_type, bill_id),
  CONSTRAINT bill_archive_states_type_check CHECK (bill_type IN ('rd', 'channel')),
  CONSTRAINT bill_archive_states_source_check CHECK (archive_source IN ('manual', 'auto'))
);

CREATE INDEX IF NOT EXISTS idx_bill_archive_states_archived_at
  ON bill_archive_states (archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_archive_states_type_archived_at
  ON bill_archive_states (bill_type, archived_at DESC);
