CREATE OR REPLACE FUNCTION app_capture_bill_attachment_operation_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    new_json JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
    bill_type_value TEXT := COALESCE(new_json ->> 'bill_type', old_json ->> 'bill_type');
    bill_id_value TEXT := COALESCE(new_json ->> 'bill_id', old_json ->> 'bill_id');
    attachment_id_value TEXT := COALESCE(new_json ->> 'id', old_json ->> 'id');
    file_name_value TEXT := COALESCE(new_json ->> 'file_name', old_json ->> 'file_name');
    action_value TEXT;
    summary_value TEXT;
    changed JSONB;
BEGIN
    IF bill_type_value NOT IN ('rd', 'channel') OR COALESCE(bill_id_value, '') = '' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    changed := app_operation_log_changes(old_json, new_json);
    IF TG_OP = 'INSERT' THEN
        action_value := 'attachment_add';
        summary_value := '上传账单附件';
        changed := jsonb_build_object(
            'file_name', jsonb_build_object('before', NULL, 'after', new_json -> 'file_name'),
            'file_size', jsonb_build_object('before', NULL, 'after', new_json -> 'file_size')
        );
    ELSIF TG_OP = 'DELETE' THEN
        action_value := 'attachment_delete';
        summary_value := '删除账单附件';
        changed := jsonb_build_object(
            'file_name', jsonb_build_object('before', old_json -> 'file_name', 'after', NULL),
            'file_size', jsonb_build_object('before', old_json -> 'file_size', 'after', NULL)
        );
    ELSE
        action_value := 'attachment_update';
        summary_value := '更新账单附件';
    END IF;

    INSERT INTO operation_logs (
        id, entity_type, entity_id, entity_number, action, summary,
        actor_user_id, actor_email, changes, metadata
    ) VALUES (
        CONCAT('ATTACH-', md5(random()::text || clock_timestamp()::text || attachment_id_value)),
        bill_type_value,
        bill_id_value,
        NULL,
        action_value,
        summary_value,
        NULLIF(current_setting('app.current_user_id', true), ''),
        NULLIF(current_setting('app.current_user_email', true), ''),
        COALESCE(changed, '{}'::jsonb),
        jsonb_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'attachment_id', attachment_id_value,
            'file_name', file_name_value,
            'file_type', COALESCE(new_json ->> 'file_type', old_json ->> 'file_type'),
            'file_size', COALESCE(new_json -> 'file_size', old_json -> 'file_size')
        )
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_bill_attachment_audit ON bill_attachments;
CREATE TRIGGER trg_bill_attachment_audit
AFTER INSERT OR UPDATE OR DELETE ON bill_attachments
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_attachment_operation_log();
