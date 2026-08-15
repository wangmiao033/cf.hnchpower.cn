-- 发票归档状态：归档只影响日常工作区可见性，不删除发票、附件或账单关联事实。
CREATE TABLE IF NOT EXISTS invoice_archive_states (
  invoice_id TEXT PRIMARY KEY REFERENCES invoice_records(id) ON DELETE CASCADE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  manual_hold BOOLEAN NOT NULL DEFAULT FALSE,
  archive_source TEXT,
  archived_at TIMESTAMPTZ,
  unarchived_at TIMESTAMPTZ,
  archived_by_user_id TEXT,
  archived_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_archive_state_not_archived_and_held
    CHECK (NOT (is_archived AND manual_hold))
);

CREATE INDEX IF NOT EXISTS idx_invoice_archive_states_archived
  ON invoice_archive_states (is_archived, archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_archive_states_manual_hold
  ON invoice_archive_states (manual_hold)
  WHERE manual_hold = TRUE;
