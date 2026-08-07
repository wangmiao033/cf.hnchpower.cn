CREATE TABLE IF NOT EXISTS operating_expenses (
    id TEXT PRIMARY KEY,
    expense_month VARCHAR(16) NOT NULL,
    expense_date VARCHAR(32),
    category VARCHAR(32) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    game_name TEXT,
    vendor_name TEXT,
    remark TEXT,
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_operating_expenses_month
    ON operating_expenses(expense_month, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_operating_expenses_category
    ON operating_expenses(category, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_operating_expenses_game
    ON operating_expenses(game_name, created_at DESC);

CREATE OR REPLACE FUNCTION app_capture_operating_expense_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    new_json JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
    changed JSONB;
    entity_id_value TEXT := COALESCE(new_json ->> 'id', old_json ->> 'id');
    entity_number_value TEXT := CONCAT(
        COALESCE(new_json ->> 'expense_month', old_json ->> 'expense_month', ''),
        CASE WHEN COALESCE(new_json ->> 'category', old_json ->> 'category', '') <> '' THEN ' · ' ELSE '' END,
        COALESCE(new_json ->> 'category', old_json ->> 'category', '')
    );
    action_value TEXT;
    summary_value TEXT;
    actor_id TEXT := NULLIF(current_setting('app.current_user_id', true), '');
    actor_email_value TEXT := NULLIF(current_setting('app.current_user_email', true), '');
BEGIN
    IF entity_id_value IS NULL OR entity_id_value = '' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    changed := app_operation_log_changes(old_json, new_json);

    IF TG_OP = 'INSERT' THEN
        action_value := 'expense_create';
        summary_value := '新增经营费用';
        changed := jsonb_build_object(
            'record',
            jsonb_build_object('before', NULL, 'after', new_json)
        );
    ELSIF TG_OP = 'DELETE' THEN
        action_value := 'expense_delete';
        summary_value := '删除经营费用';
        changed := jsonb_build_object(
            'record',
            jsonb_build_object('before', old_json, 'after', NULL)
        );
    ELSE
        action_value := 'expense_update';
        summary_value := '修改经营费用';
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
        CONCAT('OPEX-', md5(random()::text || clock_timestamp()::text || entity_id_value)),
        'operating_expense',
        entity_id_value,
        NULLIF(entity_number_value, ''),
        action_value,
        summary_value,
        actor_id,
        actor_email_value,
        changed,
        jsonb_build_object(
            'expense_month', COALESCE(new_json ->> 'expense_month', old_json ->> 'expense_month'),
            'category', COALESCE(new_json ->> 'category', old_json ->> 'category'),
            'game_name', COALESCE(new_json ->> 'game_name', old_json ->> 'game_name')
        )
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_operating_expenses_audit ON operating_expenses;
CREATE TRIGGER trg_operating_expenses_audit
AFTER INSERT OR UPDATE OR DELETE ON operating_expenses
FOR EACH ROW EXECUTE FUNCTION app_capture_operating_expense_log();
