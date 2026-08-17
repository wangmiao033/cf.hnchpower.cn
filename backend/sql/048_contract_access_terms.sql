CREATE TABLE IF NOT EXISTS cf_contract_access_terms (
  access_item_id TEXT PRIMARY KEY REFERENCES cf_contract_access_items(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL REFERENCES cf_contract_records(id) ON DELETE CASCADE,
  settlement_mode TEXT NOT NULL DEFAULT '',
  settlement_basis TEXT NOT NULL DEFAULT '',
  unit_price NUMERIC(18, 4) NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  settlement_cycle TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  invoice_tax_rate NUMERIC(7, 2) NULL,
  invoice_type TEXT NOT NULL DEFAULT '',
  refund_rule TEXT NOT NULL DEFAULT '',
  testing_fee NUMERIC(18, 2) NULL,
  server_cost_bearer TEXT NOT NULL DEFAULT '',
  prepayment_amount NUMERIC(18, 2) NULL,
  minimum_guarantee_amount NUMERIC(18, 2) NULL,
  deduction_rule TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_contract_access_terms_contract
ON cf_contract_access_terms (contract_id);
