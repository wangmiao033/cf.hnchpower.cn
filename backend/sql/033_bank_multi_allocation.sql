-- P2: bank reconciliation multi-allocation.
-- Keep bank_reconciliation_matches as the allocation fact table, but allow one transaction to
-- have multiple active allocations as long as the same bill is not duplicated.

DROP INDEX IF EXISTS ux_bank_recon_match_active_tx;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_recon_match_active_tx_bill
    ON bank_reconciliation_matches(bank_transaction_id, bill_type, bill_id)
    WHERE status = 'confirmed';

-- Preserve DB-level protection for reconciled bank rows while allowing the reconciliation
-- service to refresh legacy projection fields after an allocation/reversal.
CREATE OR REPLACE FUNCTION app_guard_confirmed_bank_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    has_match BOOLEAN;
    allow_projection_sync BOOLEAN := COALESCE(NULLIF(current_setting('app.allow_bank_allocation_sync', true), ''), '0') = '1';
BEGIN
    SELECT EXISTS(
        SELECT 1
        FROM bank_reconciliation_matches m
        WHERE m.bank_transaction_id = OLD.id
          AND m.status = 'confirmed'
    ) INTO has_match;

    IF NOT has_match THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '已核销银行流水不能直接删除，请先撤销核销';
    END IF;

    IF NEW.trade_date IS DISTINCT FROM OLD.trade_date
       OR NEW.payer_name IS DISTINCT FROM OLD.payer_name
       OR NEW.payee_name IS DISTINCT FROM OLD.payee_name
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.income_amount IS DISTINCT FROM OLD.income_amount
       OR NEW.expense_amount IS DISTINCT FROM OLD.expense_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.transaction_no IS DISTINCT FROM OLD.transaction_no THEN
        RAISE EXCEPTION '已核销银行流水的资金字段不能直接修改，请先撤销核销';
    END IF;

    IF NOT allow_projection_sync AND (
       NEW.type IS DISTINCT FROM OLD.type
       OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id
       OR NEW.reconciliation_type IS DISTINCT FROM OLD.reconciliation_type
       OR NEW.reconciliation_no IS DISTINCT FROM OLD.reconciliation_no
       OR NEW.linked_amount IS DISTINCT FROM OLD.linked_amount
       OR NEW.status IS DISTINCT FROM OLD.status
    ) THEN
        RAISE EXCEPTION '已核销银行流水的核销投影字段不能直接修改';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_transaction_reconciliation_guard ON bank_transactions;
CREATE TRIGGER trg_bank_transaction_reconciliation_guard
BEFORE UPDATE OR DELETE ON bank_transactions
FOR EACH ROW EXECUTE FUNCTION app_guard_confirmed_bank_transaction();
