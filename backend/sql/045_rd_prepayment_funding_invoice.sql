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

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_fundings (
  id TEXT PRIMARY KEY,
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  bank_transaction_id TEXT NOT NULL,
  funded_amount NUMERIC(18,2) NOT NULL CHECK (funded_amount > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  funding_date TEXT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_transaction_id, access_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_fundings_access
ON cf_rd_prepayment_fundings (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_fundings_bank
ON cf_rd_prepayment_fundings (bank_transaction_id, created_at);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_invoice_allocations (
  id TEXT PRIMARY KEY,
  funding_id TEXT NOT NULL REFERENCES cf_rd_prepayment_fundings(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoice_records(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(18,2) NOT NULL CHECK (allocated_amount > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (funding_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_funding
ON cf_rd_prepayment_invoice_allocations (funding_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_invoice
ON cf_rd_prepayment_invoice_allocations (invoice_id, created_at);
