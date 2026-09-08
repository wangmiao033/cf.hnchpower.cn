-- 运营费用中心：丰富费用字段，并新增不影响利润的押金/保证金独立台账。

ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS expense_kind VARCHAR(32) NOT NULL DEFAULT 'other';
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS due_date VARCHAR(32);
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS payment_date VARCHAR(32);
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'paid';
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(16) NOT NULL DEFAULT 'unknown';
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS voucher_note TEXT;

CREATE INDEX IF NOT EXISTS idx_operating_expenses_kind
  ON operating_expenses(expense_kind);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_payment_status
  ON operating_expenses(payment_status);

CREATE TABLE IF NOT EXISTS operating_deposits (
  id TEXT PRIMARY KEY,
  deposit_type VARCHAR(32) NOT NULL DEFAULT 'office',
  title TEXT NOT NULL,
  counterparty TEXT,
  amount NUMERIC(18, 2) NOT NULL,
  paid_date VARCHAR(32),
  expected_refund_date VARCHAR(32),
  status VARCHAR(16) NOT NULL DEFAULT 'held',
  refund_date VARCHAR(32),
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operating_deposits_status
  ON operating_deposits(status);
CREATE INDEX IF NOT EXISTS idx_operating_deposits_type
  ON operating_deposits(deposit_type);
