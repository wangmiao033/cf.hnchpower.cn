-- Explicit flow representation. Old and new unspecified rows keep pre_discount.
-- Metadata only: no amount update, no post_discount backfill, no receipt change.
-- Apply before deploying code which reads this column.
ALTER TABLE channel_record_line_items
  ADD COLUMN IF NOT EXISTS revenue_basis VARCHAR(24) NOT NULL DEFAULT 'pre_discount';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_line_revenue_basis_check'
      AND conrelid = 'channel_record_line_items'::regclass
  ) THEN
    ALTER TABLE channel_record_line_items ADD CONSTRAINT channel_line_revenue_basis_check
      CHECK (revenue_basis IN ('pre_discount', 'post_discount'));
  END IF;
END $$;
