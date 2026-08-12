ALTER TABLE channel_record_line_items
  ADD COLUMN IF NOT EXISTS settlement_rule_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS channel_fee_mode VARCHAR(16),
  ADD COLUMN IF NOT EXISTS channel_fee_rate NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16),
  ADD COLUMN IF NOT EXISTS validation_tolerance NUMERIC(18, 2);

CREATE INDEX IF NOT EXISTS idx_channel_line_rule_code
  ON channel_record_line_items (settlement_rule_code);
