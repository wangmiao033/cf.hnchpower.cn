CREATE TABLE IF NOT EXISTS cf_contract_difference_cases (
  id TEXT PRIMARY KEY,
  bill_type TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  access_item_id TEXT,
  contract_id TEXT,
  contract_name TEXT NOT NULL DEFAULT '',
  contract_no TEXT NOT NULL DEFAULT '',
  statement_no TEXT NOT NULL DEFAULT '',
  partner_name TEXT NOT NULL DEFAULT '',
  game_name TEXT NOT NULL DEFAULT '',
  settlement_cycle TEXT NOT NULL DEFAULT '',
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_direction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  handling_type TEXT,
  substatus TEXT NOT NULL DEFAULT '',
  reason_type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT cf_contract_difference_case_type_chk CHECK (bill_type IN ('rd', 'channel')),
  CONSTRAINT cf_contract_difference_case_status_chk CHECK (status IN ('pending', 'processing', 'resolved')),
  UNIQUE (bill_type, bill_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_status ON cf_contract_difference_cases (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_bill ON cf_contract_difference_cases (bill_type, bill_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_period ON cf_contract_difference_cases (settlement_cycle, status);

CREATE TABLE IF NOT EXISTS cf_contract_difference_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_events_case ON cf_contract_difference_events (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cf_contract_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_no TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
  source_bill_type TEXT NOT NULL,
  source_bill_id TEXT NOT NULL,
  source_statement_no TEXT NOT NULL DEFAULT '',
  partner_name TEXT NOT NULL DEFAULT '',
  game_name TEXT NOT NULL DEFAULT '',
  settlement_cycle TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL,
  direction_label TEXT NOT NULL DEFAULT '',
  amount NUMERIC(18,2) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  invoice_id TEXT NOT NULL DEFAULT '',
  bank_transaction_id TEXT NOT NULL DEFAULT '',
  reconciliation_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT cf_contract_adjustments_status_chk CHECK (status IN ('open', 'completed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_adjustments_case ON cf_contract_adjustments (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cf_contract_carry_forwards (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
  source_bill_type TEXT NOT NULL,
  source_bill_id TEXT NOT NULL,
  source_statement_no TEXT NOT NULL DEFAULT '',
  partner_name TEXT NOT NULL DEFAULT '',
  game_name TEXT NOT NULL DEFAULT '',
  source_month TEXT NOT NULL DEFAULT '',
  target_month TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  target_bill_type TEXT NOT NULL DEFAULT '',
  target_bill_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  CONSTRAINT cf_contract_carry_forwards_status_chk CHECK (status IN ('pending', 'applied', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_carry_forwards_target ON cf_contract_carry_forwards (target_month, partner_name, game_name, status);
