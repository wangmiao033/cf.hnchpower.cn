ALTER TABLE exception_statuses
  ADD COLUMN IF NOT EXISTS assignee TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_email TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE exception_statuses DROP CONSTRAINT IF EXISTS ck_exception_statuses_status;
ALTER TABLE exception_statuses
  ADD CONSTRAINT ck_exception_statuses_status
  CHECK (status IN ('pending', 'processing', 'ignored', 'resolved'));

CREATE INDEX IF NOT EXISTS idx_exception_statuses_status ON exception_statuses (status);
