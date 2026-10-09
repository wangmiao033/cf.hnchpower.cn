-- 其他经营费用子分类。保留历史记录为 NULL（未分类），不修改金额或归属月份。
ALTER TABLE operating_expenses
  ADD COLUMN IF NOT EXISTS expense_subcategory VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_operating_expenses_subcategory
  ON operating_expenses(expense_subcategory);
