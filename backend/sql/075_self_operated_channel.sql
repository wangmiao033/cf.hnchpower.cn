-- 自营渠道（大熊游戏）独立业务台账。
-- 仅新增表，不修改历史研发账单、银行流水、合同和运营费用。
CREATE TABLE IF NOT EXISTS self_operated_import_batches (
    id TEXT PRIMARY KEY,
    file_sha256 CHAR(64) NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    order_kind TEXT NOT NULL CHECK (order_kind IN ('game', 'token')),
    records_in_file INTEGER NOT NULL DEFAULT 0 CHECK (records_in_file >= 0),
    records_inserted INTEGER NOT NULL DEFAULT 0 CHECK (records_inserted >= 0),
    records_skipped INTEGER NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS self_operated_orders (
    order_kind TEXT NOT NULL CHECK (order_kind IN ('game', 'token')),
    order_no TEXT NOT NULL,
    settlement_month CHAR(7) NOT NULL CHECK (settlement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    order_time TIMESTAMP NOT NULL,
    game_external_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT '',
    face_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (face_amount >= 0),
    paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    batch_id TEXT NOT NULL REFERENCES self_operated_import_batches(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (order_kind, order_no)
);
CREATE INDEX IF NOT EXISTS idx_self_operated_orders_month_game
    ON self_operated_orders (settlement_month, game_external_id);
CREATE INDEX IF NOT EXISTS idx_self_operated_orders_batch
    ON self_operated_orders (batch_id);

-- 广告充值为预付款；只将 spend 计入业务买量成本。
CREATE TABLE IF NOT EXISTS self_operated_ad_ledger (
    id TEXT PRIMARY KEY,
    expense_month CHAR(7) NOT NULL CHECK (expense_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    expense_date DATE NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('topup', 'spend')),
    ad_platform TEXT NOT NULL,
    game_external_id TEXT NULL,
    game_name TEXT NULL,
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    source_bank TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT self_operated_spend_game_required CHECK (
        entry_type = 'topup' OR NULLIF(game_external_id, '') IS NOT NULL
    )
);
CREATE INDEX IF NOT EXISTS idx_self_operated_ad_month
    ON self_operated_ad_ledger (expense_month, entry_type)
    WHERE deleted_at IS NULL;

-- 合同映射按游戏ID与账期，历史月份不会因新规则改变。
-- contract_access_item_id 是外部合同关联标识；必须在业务层验证后才能用于正式账单。
CREATE TABLE IF NOT EXISTS self_operated_contract_links (
    game_external_id TEXT NOT NULL,
    settlement_month CHAR(7) NOT NULL CHECK (settlement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    contract_access_item_id TEXT NULL,
    settlement_status TEXT NOT NULL DEFAULT 'unlinked'
        CHECK (settlement_status IN ('unlinked', 'linked', 'no_external_share')),
    settlement_basis TEXT NOT NULL DEFAULT 'cash'
        CHECK (settlement_basis IN ('cash', 'contract_specific')),
    trial_share_rate NUMERIC(7,4) NULL CHECK (trial_share_rate BETWEEN 0 AND 100),
    note TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_external_id, settlement_month),
    CONSTRAINT linked_contract_required CHECK (
        settlement_status <> 'linked' OR NULLIF(contract_access_item_id, '') IS NOT NULL
    )
);
CREATE INDEX IF NOT EXISTS idx_self_operated_contract_month ON self_operated_contract_links (settlement_month);
