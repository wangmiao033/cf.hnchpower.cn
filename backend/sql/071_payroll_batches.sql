-- 工资批次：以“公司 + 工资月份”为主记录，员工明细保留实际工资表口径。
-- operating_expenses 继续作为经营利润事实表；工资批次的 amount = 应发/税前工资合计。

CREATE TABLE IF NOT EXISTS payroll_batches (
  id TEXT PRIMARY KEY,
  operating_expense_id TEXT NOT NULL UNIQUE REFERENCES operating_expenses(id) ON DELETE CASCADE,
  expense_month VARCHAR(16) NOT NULL,
  company_name TEXT NOT NULL,
  employee_count INTEGER NOT NULL DEFAULT 0,
  gross_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
  employee_deduction_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  income_tax_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  net_salary_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  source_file_name TEXT,
  validation_status VARCHAR(16) NOT NULL DEFAULT 'valid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_batches_company_month
  ON payroll_batches(company_name, expense_month);
CREATE INDEX IF NOT EXISTS idx_payroll_batches_month
  ON payroll_batches(expense_month);
CREATE INDEX IF NOT EXISTS idx_payroll_batches_company
  ON payroll_batches(company_name);

CREATE TABLE IF NOT EXISTS payroll_employee_items (
  id TEXT PRIMARY KEY,
  payroll_batch_id TEXT NOT NULL REFERENCES payroll_batches(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  employee_name TEXT NOT NULL,
  gross_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
  tax_adjustment NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pension_insurance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  medical_insurance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  unemployment_insurance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  housing_fund NUMERIC(18, 2) NOT NULL DEFAULT 0,
  leave_deduction NUMERIC(18, 2) NOT NULL DEFAULT 0,
  late_deduction NUMERIC(18, 2) NOT NULL DEFAULT 0,
  deduction_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  income_tax NUMERIC(18, 2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(18, 2) NOT NULL DEFAULT 0,
  signature_date TEXT,
  validation_status VARCHAR(16) NOT NULL DEFAULT 'valid',
  deduction_difference NUMERIC(18, 2) NOT NULL DEFAULT 0,
  net_difference NUMERIC(18, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_employee_items_batch
  ON payroll_employee_items(payroll_batch_id, sort_order);
