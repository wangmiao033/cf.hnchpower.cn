ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS ix_bank_transactions_import_batch_id
  ON bank_transactions(import_batch_id);

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id VARCHAR(64) PRIMARY KEY,
  source_bank VARCHAR(64),
  source_file_name TEXT,
  source_sheet_name TEXT,
  bank_account VARCHAR(200),
  total INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  income_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  expense_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  date_from VARCHAR(32),
  date_to VARCHAR(32),
  duplicate_row_nos JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalid_row_nos JSONB NOT NULL DEFAULT '[]'::jsonb,
  legacy_backfill BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bank_import_batches_created_at
  ON bank_import_batches(created_at DESC);

CREATE INDEX IF NOT EXISTS ix_bank_import_batches_account
  ON bank_import_batches(bank_account);

CREATE INDEX IF NOT EXISTS ix_bank_import_batches_source_file
  ON bank_import_batches(source_file_name);

INSERT INTO bank_import_batches (
  id,
  source_bank,
  source_file_name,
  bank_account,
  total,
  inserted,
  duplicates,
  invalid,
  income_total,
  expense_total,
  date_from,
  date_to,
  duplicate_row_nos,
  invalid_row_nos,
  legacy_backfill,
  created_at
)
SELECT
  'legacy-' || md5(
    COALESCE(UPPER(NULLIF(TRIM(source_bank), '')), 'BANK') || '|' ||
    COALESCE(NULLIF(TRIM(source_file_name), ''), '') || '|' ||
    COALESCE(NULLIF(TRIM(bank_account), ''), '')
  ),
  COALESCE(UPPER(NULLIF(TRIM(source_bank), '')), 'BANK'),
  NULLIF(TRIM(source_file_name), ''),
  NULLIF(TRIM(bank_account), ''),
  COUNT(*)::INTEGER,
  COUNT(*)::INTEGER,
  0,
  0,
  COALESCE(SUM(income_amount), 0),
  COALESCE(SUM(expense_amount), 0),
  MIN(trade_date),
  MAX(trade_date),
  '[]'::jsonb,
  '[]'::jsonb,
  TRUE,
  MIN(created_at)
FROM bank_transactions
WHERE type = 'statement_import'
  AND NULLIF(TRIM(source_file_name), '') IS NOT NULL
GROUP BY
  COALESCE(UPPER(NULLIF(TRIM(source_bank), '')), 'BANK'),
  NULLIF(TRIM(source_file_name), ''),
  NULLIF(TRIM(bank_account), '')
ON CONFLICT (id) DO NOTHING;

UPDATE bank_transactions
SET import_batch_id = 'legacy-' || md5(
  COALESCE(UPPER(NULLIF(TRIM(source_bank), '')), 'BANK') || '|' ||
  COALESCE(NULLIF(TRIM(source_file_name), ''), '') || '|' ||
  COALESCE(NULLIF(TRIM(bank_account), ''), '')
)
WHERE import_batch_id IS NULL
  AND type = 'statement_import'
  AND NULLIF(TRIM(source_file_name), '') IS NOT NULL;
