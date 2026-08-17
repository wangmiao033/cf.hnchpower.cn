CREATE TABLE IF NOT EXISTS cf_bill_contract_links (
  bill_type TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  access_item_id TEXT NOT NULL REFERENCES cf_contract_access_items(id) ON DELETE CASCADE,
  match_method TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bill_type, bill_id, line_id),
  CONSTRAINT cf_bill_contract_links_type_chk CHECK (bill_type IN ('rd', 'channel'))
);
CREATE INDEX IF NOT EXISTS idx_cf_bill_contract_links_access ON cf_bill_contract_links (access_item_id);
CREATE INDEX IF NOT EXISTS idx_cf_bill_contract_links_bill ON cf_bill_contract_links (bill_type, bill_id);
CREATE TABLE IF NOT EXISTS cf_contract_reconciliation_snapshots (
  id TEXT PRIMARY KEY,
  bill_type TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'confirmed',
  overall_status TEXT NOT NULL DEFAULT '',
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cf_contract_snapshots_type_chk CHECK (bill_type IN ('rd', 'channel'))
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_snapshots_bill ON cf_contract_reconciliation_snapshots (bill_type, bill_id, created_at DESC);
