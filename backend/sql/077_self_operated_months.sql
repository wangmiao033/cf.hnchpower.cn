-- Manual migration only, after verified production backup and isolated restore rehearsal.
-- Not included in automatic migrations. No existing accounting table is modified.
CREATE TABLE IF NOT EXISTS self_operated_months (
    month VARCHAR(7) PRIMARY KEY CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    rows JSON NOT NULL CHECK (json_typeof(rows) = 'array')
);
CREATE TABLE IF NOT EXISTS self_operated_month_saves (
    request_key VARCHAR(36) PRIMARY KEY,
    month VARCHAR(7) NOT NULL,
    digest VARCHAR(64) NOT NULL,
    actor_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    rows JSON NOT NULL CHECK (json_typeof(rows) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
