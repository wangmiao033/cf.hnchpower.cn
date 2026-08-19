CREATE TABLE IF NOT EXISTS cf_rd_prepayment_deductions (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  line_index INTEGER NOT NULL DEFAULT 0,
  line_id TEXT NOT NULL DEFAULT '',
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  settlement_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bill_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_access
ON cf_rd_prepayment_deductions (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_bill
ON cf_rd_prepayment_deductions (bill_id);
