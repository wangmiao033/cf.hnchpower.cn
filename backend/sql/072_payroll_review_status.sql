-- 工资财务核对状态：区分“待核对 / 财务已核对 / 已发放”。
ALTER TABLE payroll_batches
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(16) NOT NULL DEFAULT 'pending_review';

CREATE INDEX IF NOT EXISTS idx_payroll_batches_review_status
  ON payroll_batches(review_status);
