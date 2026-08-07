CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,
    entity_id TEXT NOT NULL,
    entity_number TEXT,
    action VARCHAR(48) NOT NULL,
    summary TEXT NOT NULL,
    actor_user_id TEXT,
    actor_email TEXT,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_operation_logs_entity
    ON operation_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_operation_logs_actor
    ON operation_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_operation_logs_action
    ON operation_logs(action, created_at DESC);

CREATE OR REPLACE FUNCTION app_operation_log_changes(old_row JSONB, new_row JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        jsonb_object_agg(
            changed.key,
            jsonb_build_object('before', old_row -> changed.key, 'after', new_row -> changed.key)
        ),
        '{}'::jsonb
    )
    FROM (
        SELECT keys.key
        FROM jsonb_object_keys(COALESCE(old_row, '{}'::jsonb) || COALESCE(new_row, '{}'::jsonb)) AS keys(key)
        WHERE keys.key NOT IN ('id', 'created_at', 'updated_at')
          AND (old_row -> keys.key) IS DISTINCT FROM (new_row -> keys.key)
    ) AS changed;
$$;

CREATE OR REPLACE FUNCTION app_capture_bill_operation_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    new_json JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
    changed JSONB;
    entity_type_value TEXT := TG_ARGV[0];
    entity_id_key TEXT := TG_ARGV[1];
    entity_number_key TEXT := NULLIF(TG_ARGV[2], '');
    resource_kind TEXT := TG_ARGV[3];
    entity_id_value TEXT;
    entity_number_value TEXT;
    action_value TEXT;
    summary_value TEXT;
    actor_id TEXT := NULLIF(current_setting('app.current_user_id', true), '');
    actor_email_value TEXT := NULLIF(current_setting('app.current_user_email', true), '');
BEGIN
    IF entity_type_value LIKE '@%' THEN
        entity_type_value := COALESCE(
            new_json ->> substring(entity_type_value FROM 2),
            old_json ->> substring(entity_type_value FROM 2)
        );
    END IF;

    entity_id_value := COALESCE(new_json ->> entity_id_key, old_json ->> entity_id_key);
    IF entity_number_key IS NOT NULL THEN
        entity_number_value := COALESCE(new_json ->> entity_number_key, old_json ->> entity_number_key);
    END IF;

    IF entity_type_value IS NULL OR entity_id_value IS NULL OR entity_id_value = '' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    changed := app_operation_log_changes(old_json, new_json);

    -- 收款汇总会自动回写渠道主表；收款明细本身已有日志时，不重复制造一条主表更新日志。
    IF TG_TABLE_NAME = 'channel_records' AND TG_OP = 'UPDATE' THEN
        IF (changed - 'received_amount' - 'receipt_status') = '{}'::jsonb THEN
            RETURN NEW;
        END IF;
    END IF;

    IF TG_TABLE_NAME = 'bank_transactions' THEN
        IF COALESCE(new_json ->> 'reconciliation_id', old_json ->> 'reconciliation_id', '') = '' THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
        IF COALESCE(new_json ->> 'reconciliation_type', old_json ->> 'reconciliation_type', '') NOT IN ('rd', 'channel') THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
        entity_type_value := COALESCE(new_json ->> 'reconciliation_type', old_json ->> 'reconciliation_type');
        entity_id_value := COALESCE(new_json ->> 'reconciliation_id', old_json ->> 'reconciliation_id');
    END IF;

    IF resource_kind = 'bill' THEN
        IF TG_OP = 'INSERT' THEN
            action_value := 'create';
            summary_value := CASE entity_type_value WHEN 'rd' THEN '创建研发账单' ELSE '创建渠道账单' END;
            changed := '{}'::jsonb;
        ELSIF TG_OP = 'DELETE' THEN
            action_value := 'delete';
            summary_value := CASE entity_type_value WHEN 'rd' THEN '删除研发账单' ELSE '删除渠道账单' END;
            changed := jsonb_build_object('record', jsonb_build_object('before', old_json, 'after', NULL));
        ELSIF (old_json -> 'status') IS DISTINCT FROM (new_json -> 'status')
              AND (changed - 'status') = '{}'::jsonb THEN
            action_value := 'status_change';
            summary_value := '变更账单状态';
        ELSE
            action_value := 'update';
            summary_value := CASE entity_type_value WHEN 'rd' THEN '修改研发账单' ELSE '修改渠道账单' END;
        END IF;
    ELSIF resource_kind = 'receipt' THEN
        action_value := CASE TG_OP WHEN 'INSERT' THEN 'receipt_add' WHEN 'DELETE' THEN 'receipt_delete' ELSE 'receipt_update' END;
        summary_value := CASE TG_OP WHEN 'INSERT' THEN '登记渠道收款' WHEN 'DELETE' THEN '删除渠道收款' ELSE '修改渠道收款' END;
        IF TG_OP = 'DELETE' THEN
            changed := jsonb_build_object('receipt', jsonb_build_object('before', old_json, 'after', NULL));
        END IF;
    ELSIF resource_kind = 'bank_transaction' THEN
        action_value := CASE TG_OP WHEN 'INSERT' THEN 'payment_add' WHEN 'DELETE' THEN 'payment_delete' ELSE 'payment_update' END;
        summary_value := CASE TG_OP WHEN 'INSERT' THEN '登记银行收付款' WHEN 'DELETE' THEN '删除银行收付款' ELSE '修改银行收付款' END;
        IF TG_OP = 'DELETE' THEN
            changed := jsonb_build_object('payment', jsonb_build_object('before', old_json, 'after', NULL));
        END IF;
    ELSIF resource_kind = 'bank_instruction' THEN
        action_value := CASE TG_OP WHEN 'INSERT' THEN 'payment_instruction_create' WHEN 'DELETE' THEN 'payment_instruction_delete' ELSE 'payment_instruction_update' END;
        summary_value := CASE TG_OP WHEN 'INSERT' THEN '创建付款指令' WHEN 'DELETE' THEN '删除付款指令' ELSE '更新付款指令' END;
        IF TG_OP = 'DELETE' THEN
            changed := jsonb_build_object('instruction', jsonb_build_object('before', old_json, 'after', NULL));
        END IF;
    ELSIF resource_kind = 'invoice_allocation' THEN
        IF TG_OP = 'INSERT' THEN
            action_value := 'invoice_link';
            summary_value := '关联发票';
        ELSIF TG_OP = 'DELETE' THEN
            action_value := 'invoice_unlink';
            summary_value := '撤销发票关联';
            changed := jsonb_build_object('allocation', jsonb_build_object('before', old_json, 'after', NULL));
        ELSIF (old_json ->> 'status') IS DISTINCT FROM (new_json ->> 'status')
              AND COALESCE(new_json ->> 'status', '') NOT IN ('confirmed', 'suggested') THEN
            action_value := 'invoice_unlink';
            summary_value := '撤销发票关联';
        ELSE
            action_value := 'invoice_link_update';
            summary_value := '更新发票关联';
        END IF;
    ELSE
        action_value := lower(TG_OP);
        summary_value := '更新业务记录';
    END IF;

    INSERT INTO operation_logs (
        id,
        entity_type,
        entity_id,
        entity_number,
        action,
        summary,
        actor_user_id,
        actor_email,
        changes,
        metadata
    ) VALUES (
        md5(random()::text || clock_timestamp()::text || entity_type_value || entity_id_value),
        entity_type_value,
        entity_id_value,
        entity_number_value,
        action_value,
        summary_value,
        actor_id,
        actor_email_value,
        COALESCE(changed, '{}'::jsonb),
        jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP)
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_operation_log_rd_bill ON reconciliation_records;
CREATE TRIGGER trg_operation_log_rd_bill
AFTER INSERT OR UPDATE OR DELETE ON reconciliation_records
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('rd', 'id', 'statement_no', 'bill');

DROP TRIGGER IF EXISTS trg_operation_log_channel_bill ON channel_records;
CREATE TRIGGER trg_operation_log_channel_bill
AFTER INSERT OR UPDATE OR DELETE ON channel_records
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('channel', 'id', 'statement_no', 'bill');

DROP TRIGGER IF EXISTS trg_operation_log_channel_receipt ON channel_receipts;
CREATE TRIGGER trg_operation_log_channel_receipt
AFTER INSERT OR UPDATE OR DELETE ON channel_receipts
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('channel', 'channel_record_id', '', 'receipt');

DROP TRIGGER IF EXISTS trg_operation_log_bank_transaction ON bank_transactions;
CREATE TRIGGER trg_operation_log_bank_transaction
AFTER INSERT OR UPDATE OR DELETE ON bank_transactions
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('@reconciliation_type', 'reconciliation_id', 'reconciliation_no', 'bank_transaction');

DROP TRIGGER IF EXISTS trg_operation_log_bank_payment_instruction ON bank_payment_records;
CREATE TRIGGER trg_operation_log_bank_payment_instruction
AFTER INSERT OR UPDATE OR DELETE ON bank_payment_records
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('rd', 'reconciliation_id', '', 'bank_instruction');

DROP TRIGGER IF EXISTS trg_operation_log_bill_invoice_allocation ON bill_invoice_allocations;
CREATE TRIGGER trg_operation_log_bill_invoice_allocation
AFTER INSERT OR UPDATE OR DELETE ON bill_invoice_allocations
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log('@bill_type', 'bill_id', '', 'invoice_allocation');
