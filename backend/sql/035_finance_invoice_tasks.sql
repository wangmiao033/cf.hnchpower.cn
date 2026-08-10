-- Finance workbench: invoice task workflow.

CREATE TABLE IF NOT EXISTS finance_invoice_tasks (
    id TEXT PRIMARY KEY,
    task_no TEXT NOT NULL UNIQUE,
    bill_type VARCHAR(16) NOT NULL DEFAULT 'channel',
    bill_id TEXT NOT NULL,
    direction VARCHAR(16) NOT NULL DEFAULT 'output',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    requested_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    allocated_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    bill_number TEXT,
    partner_name TEXT,
    game_name TEXT,
    settlement_month TEXT,
    submitted_by_id TEXT,
    submitted_by_email TEXT,
    submitted_by_name TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_to_id TEXT,
    assigned_to_email TEXT,
    assigned_to_name TEXT,
    started_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    reject_reason TEXT,
    completed_at TIMESTAMPTZ,
    completed_by_id TEXT,
    completed_by_email TEXT,
    completed_by_name TEXT,
    invoice_id TEXT REFERENCES invoice_records(id) ON DELETE SET NULL,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_finance_invoice_tasks_status
    ON finance_invoice_tasks(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS ix_finance_invoice_tasks_bill
    ON finance_invoice_tasks(bill_type, bill_id);
CREATE INDEX IF NOT EXISTS ix_finance_invoice_tasks_assignee
    ON finance_invoice_tasks(assigned_to_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_invoice_tasks_active_bill
    ON finance_invoice_tasks(bill_type, bill_id, direction)
    WHERE status IN ('pending', 'processing');
