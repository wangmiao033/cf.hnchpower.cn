-- V4 游戏库 + 渠道游戏结算规则基础表。
-- 只新增旁路主数据，不修改任何历史渠道账单、金额或结算字段。

CREATE TABLE IF NOT EXISTS game_registry_games (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_game_registry_games_canonical_name
    ON game_registry_games (canonical_name);

CREATE TABLE IF NOT EXISTS channel_game_rules (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES game_registry_games(id) ON DELETE RESTRICT,
    partner_name TEXT NOT NULL DEFAULT '',
    channel_name TEXT NOT NULL DEFAULT '',
    start_month VARCHAR(7) NOT NULL,
    end_month VARCHAR(7),
    share_rate NUMERIC(10, 4),
    tax_rate NUMERIC(10, 4),
    channel_fee_rate NUMERIC(10, 4),
    settlement_rule_code VARCHAR(40),
    channel_fee_mode VARCHAR(16),
    tax_mode VARCHAR(16),
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_month_count INTEGER NOT NULL DEFAULT 0,
    source_first_bill_id TEXT,
    source_last_bill_id TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_channel_game_rule_period
        UNIQUE (partner_name, channel_name, game_id, start_month),
    CONSTRAINT ck_channel_game_rule_start_month
        CHECK (start_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
    CONSTRAINT ck_channel_game_rule_end_month
        CHECK (end_month IS NULL OR end_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS ix_channel_game_rules_lookup
    ON channel_game_rules (partner_name, channel_name, game_id, start_month, end_month);

CREATE INDEX IF NOT EXISTS ix_channel_game_rules_game
    ON channel_game_rules (game_id);
