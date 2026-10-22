-- 076: 大熊游戏独立现金订单存储（待独立备份和人工批准后执行）
-- 此文件不在当前自动迁移范围1..75内，禁止在普通生产构建/启动中自动执行。
-- 不修改既有研发、渠道、合同、发票、银行和经营费用任何表。
CREATE TABLE IF NOT EXISTS self_operated_import_batches (
    id TEXT PRIMARY KEY,
    request_key VARCHAR(128) NOT NULL UNIQUE,
    payload_digest CHAR(64) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    source_label VARCHAR(32) NOT NULL DEFAULT 'daxiong',
    submitted_by_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    submitted_count INTEGER NOT NULL CHECK (submitted_count BETWEEN 1 AND 5000),
    inserted_count INTEGER NOT NULL CHECK (inserted_count >= 0),
    duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
    inserted_game_cents BIGINT NOT NULL DEFAULT 0 CHECK (inserted_game_cents >= 0),
    inserted_coin_cents BIGINT NOT NULL DEFAULT 0 CHECK (inserted_coin_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_self_operated_batch_counts
        CHECK (inserted_count + duplicate_count = submitted_count)
);

CREATE TABLE IF NOT EXISTS self_operated_orders (
    id TEXT PRIMARY KEY,
    source_label VARCHAR(32) NOT NULL DEFAULT 'daxiong',
    external_order_id VARCHAR(160) NOT NULL,
    game_id VARCHAR(100) NOT NULL DEFAULT '',
    game_name VARCHAR(255) NOT NULL DEFAULT '',
    order_kind VARCHAR(8) NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 999999999999),
    paid_date DATE NOT NULL,
    settlement_month VARCHAR(7) NOT NULL,
    import_batch_id TEXT NOT NULL REFERENCES self_operated_import_batches(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_self_operated_source_external_order UNIQUE (source_label, external_order_id),
    CONSTRAINT ck_self_operated_order_source CHECK (source_label = 'daxiong'),
    CONSTRAINT ck_self_operated_order_kind CHECK (order_kind IN ('game', 'coin')),
    CONSTRAINT ck_self_operated_game_identity CHECK (
        order_kind = 'coin' OR length(trim(game_id)) > 0 OR length(trim(game_name)) > 0
    ),
    CONSTRAINT ck_self_operated_month CHECK (
        settlement_month = to_char(paid_date, 'YYYY-MM')
    )
);

CREATE INDEX IF NOT EXISTS idx_self_operated_orders_month_kind
    ON self_operated_orders(settlement_month, order_kind);
CREATE INDEX IF NOT EXISTS idx_self_operated_orders_game_month
    ON self_operated_orders(settlement_month, game_id, game_name);
CREATE INDEX IF NOT EXISTS idx_self_operated_orders_batch
    ON self_operated_orders(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_self_operated_batches_created
    ON self_operated_import_batches(created_at DESC);
