CREATE TABLE IF NOT EXISTS cf_rd_contract_entry_pending (
  statement_no TEXT PRIMARY KEY,
  metadata_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_by TEXT NOT NULL DEFAULT '',
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cf_rd_contract_entry_snapshots (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  statement_no TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_contract_entry_snapshots_bill
ON cf_rd_contract_entry_snapshots (bill_id, created_at DESC);
