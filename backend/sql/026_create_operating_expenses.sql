CREATE TABLE IF NOT EXISTS operating_expenses (
    id TEXT PRIMARY KEY,
    expense_month VARCHAR(7) NOT NULL,
    expense_date VARCHAR(16),
    category VARCHAR(32) NOT NULL,
    game_name TEXT,
    vendor_name TEXT,
    amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    description TEXT,
    remark TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_operating_expenses_month
    ON operating_expenses(expense_month, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_operating_expenses_category
    ON operating_expenses(category, expense_month);
CREATE INDEX IF NOT EXISTS ix_operating_expenses_game
    ON operating_expenses(game_name, expense_month);

DROP TRIGGER IF EXISTS trg_operation_log_operating_expense ON operating_expenses;
CREATE TRIGGER trg_operation_log_operating_expense
AFTER INSERT OR UPDATE OR DELETE ON operating_expenses
FOR EACH ROW EXECUTE FUNCTION app_capture_bill_operation_log(
    'operating_expense',
    'id',
    'expense_month',
    'operating_expense'
);
