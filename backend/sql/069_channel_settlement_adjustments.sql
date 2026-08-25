-- Generic, opt-in bill-level settlement adjustments for channel bills.
-- Game/business line amounts remain untouched; only the final receivable changes.
ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_type VARCHAR(40);

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_source_month VARCHAR(16);

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_reason TEXT;

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_final_override NUMERIC(18, 2);
