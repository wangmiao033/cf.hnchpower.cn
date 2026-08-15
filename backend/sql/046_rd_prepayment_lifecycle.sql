CREATE TABLE IF NOT EXISTS cf_rd_prepayment_lifecycle_settings (
  access_item_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL DEFAULT '',
  strict_mode BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT NOT NULL DEFAULT '研发预付款',
  invoice_policy TEXT NOT NULL DEFAULT 'separate'
    CHECK (invoice_policy IN ('separate', 'release_by_deduction', 'manual')),
  frozen_at TIMESTAMPTZ NULL,
  freeze_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_lifecycle_contract
ON cf_rd_prepayment_lifecycle_settings (contract_id, updated_at);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_installments (
  id TEXT PRIMARY KEY,
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  installment_no INTEGER NOT NULL CHECK (installment_no > 0),
  installment_name TEXT NOT NULL DEFAULT '',
  planned_amount NUMERIC(18,2) NOT NULL CHECK (planned_amount > 0),
  trigger_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'contract_effective', 'game_launch', 'fixed_date', 'other')),
  trigger_note TEXT NOT NULL DEFAULT '',
  trigger_date TEXT NULL,
  triggered_at TIMESTAMPTZ NULL,
  triggered_by TEXT NOT NULL DEFAULT '',
  payment_due_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_due_days >= 0 AND payment_due_days <= 365),
  due_date TEXT NULL,
  requires_invoice BOOLEAN NOT NULL DEFAULT TRUE,
  invoice_ready_at TIMESTAMPTZ NULL,
  invoice_ready_by TEXT NOT NULL DEFAULT '',
  invoice_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (access_item_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_installments_access
ON cf_rd_prepayment_installments (access_item_id, installment_no);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_installments_trigger
ON cf_rd_prepayment_installments (access_item_id, triggered_at, due_date);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_refunds (
  id TEXT PRIMARY KEY,
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  bank_transaction_id TEXT NOT NULL,
  refund_amount NUMERIC(18,2) NOT NULL CHECK (refund_amount > 0),
  refund_date TEXT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_transaction_id, access_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_refunds_access
ON cf_rd_prepayment_refunds (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_refunds_bank
ON cf_rd_prepayment_refunds (bank_transaction_id, created_at);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_invoice_releases (
  id TEXT PRIMARY KEY,
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  deduction_id TEXT NOT NULL DEFAULT '',
  funding_id TEXT NOT NULL DEFAULT '',
  invoice_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  released_amount NUMERIC(18,2) NOT NULL CHECK (released_amount > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_releases_access
ON cf_rd_prepayment_invoice_releases (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_releases_bill
ON cf_rd_prepayment_invoice_releases (bill_id, invoice_id);

CREATE OR REPLACE FUNCTION cf_rd_prepayment_guard_strict_funding()
RETURNS TRIGGER AS $$
DECLARE
  v_strict BOOLEAN := FALSE;
  v_frozen TIMESTAMPTZ;
  v_eligible NUMERIC(18,2) := 0;
  v_existing NUMERIC(18,2) := 0;
BEGIN
  SELECT strict_mode, frozen_at
    INTO v_strict, v_frozen
  FROM cf_rd_prepayment_lifecycle_settings
  WHERE access_item_id = NEW.access_item_id;

  IF COALESCE(v_strict, FALSE) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_frozen IS NOT NULL THEN
    RAISE EXCEPTION 'PREPAYMENT_FROZEN: 该研发预付款已冻结，不能继续登记付款';
  END IF;

  SELECT COALESCE(SUM(planned_amount), 0)
    INTO v_eligible
  FROM cf_rd_prepayment_installments
  WHERE access_item_id = NEW.access_item_id
    AND triggered_at IS NOT NULL
    AND (requires_invoice IS FALSE OR invoice_ready_at IS NOT NULL);

  SELECT COALESCE(SUM(funded_amount), 0)
    INTO v_existing
  FROM cf_rd_prepayment_fundings
  WHERE access_item_id = NEW.access_item_id
    AND id <> NEW.id;

  IF v_existing + NEW.funded_amount > v_eligible + 0.005 THEN
    RAISE EXCEPTION 'PREPAYMENT_NOT_DUE: 登记金额超过已触发且满足付款前置条件的预付款金额';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cf_rd_prepayment_guard_strict_funding ON cf_rd_prepayment_fundings;
CREATE TRIGGER trg_cf_rd_prepayment_guard_strict_funding
BEFORE INSERT OR UPDATE OF funded_amount, access_item_id
ON cf_rd_prepayment_fundings
FOR EACH ROW EXECUTE FUNCTION cf_rd_prepayment_guard_strict_funding();

CREATE OR REPLACE FUNCTION cf_rd_prepayment_guard_strict_deduction()
RETURNS TRIGGER AS $$
DECLARE
  v_strict BOOLEAN := FALSE;
  v_frozen TIMESTAMPTZ;
  v_funded NUMERIC(18,2) := 0;
  v_refunded NUMERIC(18,2) := 0;
  v_used NUMERIC(18,2) := 0;
  v_available NUMERIC(18,2) := 0;
BEGIN
  SELECT strict_mode, frozen_at
    INTO v_strict, v_frozen
  FROM cf_rd_prepayment_lifecycle_settings
  WHERE access_item_id = NEW.access_item_id;

  IF COALESCE(v_strict, FALSE) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_frozen IS NOT NULL THEN
    RAISE EXCEPTION 'PREPAYMENT_FROZEN: 该研发预付款已冻结待处理，不能继续抵扣研发账单';
  END IF;

  SELECT COALESCE(SUM(funded_amount), 0)
    INTO v_funded
  FROM cf_rd_prepayment_fundings
  WHERE access_item_id = NEW.access_item_id;

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refunded
  FROM cf_rd_prepayment_refunds
  WHERE access_item_id = NEW.access_item_id;

  SELECT COALESCE(SUM(deduction_amount), 0)
    INTO v_used
  FROM cf_rd_prepayment_deductions
  WHERE access_item_id = NEW.access_item_id
    AND id <> NEW.id;

  v_available := GREATEST(0, v_funded - v_refunded - v_used);

  IF NEW.deduction_amount > v_available + 0.005 THEN
    RAISE EXCEPTION 'PREPAYMENT_INSUFFICIENT: 本次抵扣超过银行实付扣除退款后的可用余额';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cf_rd_prepayment_guard_strict_deduction ON cf_rd_prepayment_deductions;
CREATE TRIGGER trg_cf_rd_prepayment_guard_strict_deduction
BEFORE INSERT OR UPDATE OF deduction_amount, access_item_id
ON cf_rd_prepayment_deductions
FOR EACH ROW EXECUTE FUNCTION cf_rd_prepayment_guard_strict_deduction();

CREATE OR REPLACE FUNCTION cf_rd_prepayment_guard_refund()
RETURNS TRIGGER AS $$
DECLARE
  v_frozen TIMESTAMPTZ;
  v_funded NUMERIC(18,2) := 0;
  v_used NUMERIC(18,2) := 0;
  v_refunded NUMERIC(18,2) := 0;
  v_refundable NUMERIC(18,2) := 0;
BEGIN
  SELECT frozen_at
    INTO v_frozen
  FROM cf_rd_prepayment_lifecycle_settings
  WHERE access_item_id = NEW.access_item_id;

  IF v_frozen IS NULL THEN
    RAISE EXCEPTION 'PREPAYMENT_NOT_FROZEN: 预付款退款前必须先冻结资金池';
  END IF;

  SELECT COALESCE(SUM(funded_amount), 0)
    INTO v_funded
  FROM cf_rd_prepayment_fundings
  WHERE access_item_id = NEW.access_item_id;

  SELECT COALESCE(SUM(deduction_amount), 0)
    INTO v_used
  FROM cf_rd_prepayment_deductions
  WHERE access_item_id = NEW.access_item_id;

  SELECT COALESCE(SUM(refund_amount), 0)
    INTO v_refunded
  FROM cf_rd_prepayment_refunds
  WHERE access_item_id = NEW.access_item_id
    AND id <> NEW.id;

  v_refundable := GREATEST(0, v_funded - v_used - v_refunded);

  IF NEW.refund_amount > v_refundable + 0.005 THEN
    RAISE EXCEPTION 'PREPAYMENT_REFUND_EXCESS: 退款金额超过当前未抵扣银行实付余额';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cf_rd_prepayment_guard_refund ON cf_rd_prepayment_refunds;
CREATE TRIGGER trg_cf_rd_prepayment_guard_refund
BEFORE INSERT OR UPDATE OF refund_amount, access_item_id
ON cf_rd_prepayment_refunds
FOR EACH ROW EXECUTE FUNCTION cf_rd_prepayment_guard_refund();
