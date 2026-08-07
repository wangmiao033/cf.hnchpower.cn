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
