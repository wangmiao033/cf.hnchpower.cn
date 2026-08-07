CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT NOT NULL,
    direction VARCHAR(16) NOT NULL,
    bill_type VARCHAR(16) NOT NULL,
    bill_id TEXT NOT NULL,
    bill_number TEXT,
    linked_amount NUMERIC(18, 2) NOT NULL,
    confidence_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
    confidence_level VARCHAR(16) NOT NULL DEFAULT 'manual',
    match_reasons JSONB,
    generated_receipt_id TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
    original_transaction_type VARCHAR(32) NOT NULL DEFAULT 'statement_import',
    original_transaction_status TEXT,
    confirmed_by TEXT,
    confirmed_email TEXT,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reversed_by TEXT,
    reversed_email TEXT,
    reversed_at TIMESTAMPTZ,
    reverse_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bank_recon_match_bill
    ON bank_reconciliation_matches(bill_type, bill_id, status);
CREATE INDEX IF NOT EXISTS ix_bank_recon_match_tx
    ON bank_reconciliation_matches(bank_transaction_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_recon_match_active_tx
    ON bank_reconciliation_matches(bank_transaction_id)
    WHERE status = 'confirmed';

CREATE OR REPLACE FUNCTION app_capture_bank_reconciliation_match_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    new_json JSONB := to_jsonb(NEW);
    action_value TEXT;
    summary_value TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        action_value := 'bank_match_confirm';
        summary_value := '确认银行流水核销';
    ELSIF OLD.status = 'confirmed' AND NEW.status = 'reversed' THEN
        action_value := 'bank_match_reverse';
        summary_value := '撤销银行流水核销';
    ELSE
        action_value := 'bank_match_update';
        summary_value := '更新银行流水核销';
    END IF;

    INSERT INTO operation_logs (
        id, entity_type, entity_id, entity_number, action, summary,
        actor_user_id, actor_email, changes, metadata
    ) VALUES (
        CONCAT('BANKMATCH-', md5(random()::text || clock_timestamp()::text || NEW.id)),
        'bank_reconciliation',
        NEW.id,
        NEW.bill_number,
        action_value,
        summary_value,
        NULLIF(current_setting('app.current_user_id', true), ''),
        NULLIF(current_setting('app.current_user_email', true), ''),
        app_operation_log_changes(old_json, new_json),
        jsonb_build_object(
            'bank_transaction_id', NEW.bank_transaction_id,
            'bill_type', NEW.bill_type,
            'bill_id', NEW.bill_id,
            'direction', NEW.direction,
            'linked_amount', NEW.linked_amount,
            'confidence_score', NEW.confidence_score
        )
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_reconciliation_match_audit ON bank_reconciliation_matches;
CREATE TRIGGER trg_bank_reconciliation_match_audit
AFTER INSERT OR UPDATE ON bank_reconciliation_matches
FOR EACH ROW EXECUTE FUNCTION app_capture_bank_reconciliation_match_log();

CREATE OR REPLACE FUNCTION app_guard_confirmed_bank_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    has_match BOOLEAN;
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

    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.trade_date IS DISTINCT FROM OLD.trade_date
       OR NEW.payer_name IS DISTINCT FROM OLD.payer_name
       OR NEW.payee_name IS DISTINCT FROM OLD.payee_name
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.income_amount IS DISTINCT FROM OLD.income_amount
       OR NEW.expense_amount IS DISTINCT FROM OLD.expense_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.transaction_no IS DISTINCT FROM OLD.transaction_no
       OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id
       OR NEW.reconciliation_type IS DISTINCT FROM OLD.reconciliation_type
       OR NEW.reconciliation_no IS DISTINCT FROM OLD.reconciliation_no
       OR NEW.linked_amount IS DISTINCT FROM OLD.linked_amount
       OR NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION '已核销银行流水的资金字段不能直接修改，请先撤销核销';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_transaction_reconciliation_guard ON bank_transactions;
CREATE TRIGGER trg_bank_transaction_reconciliation_guard
BEFORE UPDATE OR DELETE ON bank_transactions
FOR EACH ROW EXECUTE FUNCTION app_guard_confirmed_bank_transaction();

CREATE OR REPLACE FUNCTION app_guard_auto_channel_receipt_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS(
        SELECT 1
        FROM bank_reconciliation_matches m
        WHERE m.generated_receipt_id = OLD.id
          AND m.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION '自动核销生成的收款记录不能直接删除，请先撤销核销';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_channel_receipt_delete_guard ON channel_receipts;
CREATE TRIGGER trg_auto_channel_receipt_delete_guard
BEFORE DELETE ON channel_receipts
FOR EACH ROW EXECUTE FUNCTION app_guard_auto_channel_receipt_delete();
