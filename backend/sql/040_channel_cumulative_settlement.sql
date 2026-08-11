-- Channel cumulative-settlement policies, pools and batches.
-- A bill can be reviewed monthly while invoice/collection is deferred until a partner-level threshold is met.

CREATE TABLE IF NOT EXISTS channel_cumulative_settlement_policies (
    id TEXT PRIMARY KEY,
    partner_key TEXT NOT NULL UNIQUE,
    partner_name TEXT NOT NULL,
    settlement_mode VARCHAR(24) NOT NULL DEFAULT 'periodic',
    threshold_basis VARCHAR(32) NOT NULL DEFAULT 'billing_flow',
    threshold_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    scope VARCHAR(24) NOT NULL DEFAULT 'partner',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT channel_cumulative_policy_mode_chk CHECK (settlement_mode IN ('periodic', 'threshold')),
    CONSTRAINT channel_cumulative_policy_basis_chk CHECK (threshold_basis IN ('billing_flow', 'settlement_amount')),
    CONSTRAINT channel_cumulative_policy_scope_chk CHECK (scope IN ('partner')),
    CONSTRAINT channel_cumulative_policy_threshold_chk CHECK (threshold_amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_channel_cumulative_policy_enabled
    ON channel_cumulative_settlement_policies(enabled, settlement_mode);

CREATE TABLE IF NOT EXISTS channel_cumulative_settlement_batches (
    id TEXT PRIMARY KEY,
    batch_no TEXT NOT NULL UNIQUE,
    partner_key TEXT NOT NULL,
    partner_name TEXT NOT NULL,
    threshold_basis VARCHAR(32) NOT NULL,
    threshold_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    basis_total NUMERIC(18,2) NOT NULL DEFAULT 0,
    settlement_total NUMERIC(18,2) NOT NULL DEFAULT 0,
    period_start VARCHAR(16),
    period_end VARCHAR(16),
    status VARCHAR(24) NOT NULL DEFAULT 'ready',
    created_by_id TEXT,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invoice_task_id TEXT,
    invoice_id TEXT REFERENCES invoice_records(id) ON DELETE SET NULL,
    invoiced_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    CONSTRAINT channel_cumulative_batch_basis_chk CHECK (threshold_basis IN ('billing_flow', 'settlement_amount')),
    CONSTRAINT channel_cumulative_batch_status_chk CHECK (status IN ('ready', 'invoicing', 'invoiced', 'settled', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS ix_channel_cumulative_batch_partner
    ON channel_cumulative_settlement_batches(partner_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_channel_cumulative_batch_status
    ON channel_cumulative_settlement_batches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_cumulative_settlement_batch_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES channel_cumulative_settlement_batches(id) ON DELETE CASCADE,
    bill_id TEXT NOT NULL REFERENCES channel_records(id) ON DELETE RESTRICT,
    settlement_month VARCHAR(16),
    basis_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    settlement_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    release_reason TEXT,
    UNIQUE(batch_id, bill_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_channel_cumulative_active_bill
    ON channel_cumulative_settlement_batch_items(bill_id)
    WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_channel_cumulative_batch_items_batch
    ON channel_cumulative_settlement_batch_items(batch_id, settlement_month, created_at);

-- Extend the existing finance queue so one cumulative invoice task can allocate one invoice across many bills.
ALTER TABLE finance_invoice_tasks
    ADD COLUMN IF NOT EXISTS source_kind VARCHAR(32) NOT NULL DEFAULT 'bill';
ALTER TABLE finance_invoice_tasks
    ADD COLUMN IF NOT EXISTS cumulative_batch_id TEXT REFERENCES channel_cumulative_settlement_batches(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS ux_finance_invoice_tasks_active_bill;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_invoice_tasks_active_bill
    ON finance_invoice_tasks(bill_type, bill_id, direction)
    WHERE source_kind = 'bill' AND status IN ('pending', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_invoice_tasks_active_cumulative_batch
    ON finance_invoice_tasks(cumulative_batch_id, direction)
    WHERE source_kind = 'cumulative_batch' AND cumulative_batch_id IS NOT NULL AND status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS ix_finance_invoice_tasks_cumulative_batch
    ON finance_invoice_tasks(cumulative_batch_id, status);

-- Requested business rule: Shanghai Changzhi settles only after cumulative flow reaches RMB 2,000.
INSERT INTO channel_cumulative_settlement_policies (
    id, partner_key, partner_name, settlement_mode, threshold_basis,
    threshold_amount, scope, enabled, note
)
VALUES (
    'policy-shanghai-changzhi-2000',
    '上海畅指网络科技',
    '上海畅指网络科技有限公司',
    'threshold',
    'billing_flow',
    2000.00,
    'partner',
    TRUE,
    '累计流水总金额达到 2000 元后结算'
)
ON CONFLICT (partner_key) DO UPDATE SET
    partner_name = EXCLUDED.partner_name,
    settlement_mode = EXCLUDED.settlement_mode,
    threshold_basis = EXCLUDED.threshold_basis,
    threshold_amount = EXCLUDED.threshold_amount,
    scope = EXCLUDED.scope,
    enabled = EXCLUDED.enabled,
    note = EXCLUDED.note,
    updated_at = NOW();