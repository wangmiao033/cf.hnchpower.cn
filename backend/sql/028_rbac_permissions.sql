CREATE TABLE IF NOT EXISTS auth_user_permission_overrides (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    permission VARCHAR(128) NOT NULL,
    effect VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_auth_user_permission_effect CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT uq_auth_user_permission_override UNIQUE (user_id, permission)
);

CREATE INDEX IF NOT EXISTS ix_auth_user_permission_user
    ON auth_user_permission_overrides(user_id, permission);
CREATE INDEX IF NOT EXISTS ix_auth_user_permission_permission
    ON auth_user_permission_overrides(permission, effect);

CREATE OR REPLACE FUNCTION app_capture_permission_override_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    new_json JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
    uid TEXT := COALESCE(new_json ->> 'user_id', old_json ->> 'user_id');
    permission_value TEXT := COALESCE(new_json ->> 'permission', old_json ->> 'permission');
    action_value TEXT;
    summary_value TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        action_value := 'permission_override_create';
        summary_value := '新增用户权限覆盖';
    ELSIF TG_OP = 'DELETE' THEN
        action_value := 'permission_override_delete';
        summary_value := '删除用户权限覆盖';
    ELSE
        action_value := 'permission_override_update';
        summary_value := '修改用户权限覆盖';
    END IF;

    INSERT INTO operation_logs (
        id, entity_type, entity_id, entity_number, action, summary,
        actor_user_id, actor_email, changes, metadata
    ) VALUES (
        CONCAT('PERM-', md5(random()::text || clock_timestamp()::text || COALESCE(uid, ''))),
        'auth_permission',
        COALESCE(uid, ''),
        permission_value,
        action_value,
        summary_value,
        NULLIF(current_setting('app.current_user_id', true), ''),
        NULLIF(current_setting('app.current_user_email', true), ''),
        app_operation_log_changes(old_json, new_json),
        jsonb_build_object('permission', permission_value)
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_permission_audit ON auth_user_permission_overrides;
CREATE TRIGGER trg_auth_user_permission_audit
AFTER INSERT OR UPDATE OR DELETE ON auth_user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION app_capture_permission_override_log();

CREATE OR REPLACE FUNCTION app_capture_auth_user_access_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_json JSONB := jsonb_build_object(
        'role', OLD.role,
        'is_active', OLD.is_active
    );
    new_json JSONB := jsonb_build_object(
        'role', NEW.role,
        'is_active', NEW.is_active
    );
BEGIN
    IF old_json = new_json THEN
        RETURN NEW;
    END IF;

    INSERT INTO operation_logs (
        id, entity_type, entity_id, entity_number, action, summary,
        actor_user_id, actor_email, changes, metadata
    ) VALUES (
        CONCAT('USER-ACCESS-', md5(random()::text || clock_timestamp()::text || NEW.id)),
        'auth_user_access',
        NEW.id,
        NEW.email,
        'user_access_update',
        '修改用户角色或账号状态',
        NULLIF(current_setting('app.current_user_id', true), ''),
        NULLIF(current_setting('app.current_user_email', true), ''),
        app_operation_log_changes(old_json, new_json),
        jsonb_build_object('email', NEW.email)
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_access_audit ON auth_users;
CREATE TRIGGER trg_auth_user_access_audit
AFTER UPDATE OF role, is_active ON auth_users
FOR EACH ROW EXECUTE FUNCTION app_capture_auth_user_access_log();
