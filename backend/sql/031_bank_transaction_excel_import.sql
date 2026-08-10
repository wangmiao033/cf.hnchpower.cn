ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS balance NUMERIC(18, 2);

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source_bank TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source_row_no INTEGER;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transactions_dedupe_key
  ON bank_transactions (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
