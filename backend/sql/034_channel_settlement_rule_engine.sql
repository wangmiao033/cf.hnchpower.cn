-- Channel settlement rule engine + platform statement validation.

ALTER TABLE channel_records
    ADD COLUMN IF NOT EXISTS settlement_rule_code VARCHAR(40) NOT NULL DEFAULT 'legacy_fixed_fee_tax',
    ADD COLUMN IF NOT EXISTS channel_fee_mode VARCHAR(16) NOT NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(16) NOT NULL DEFAULT 'share',
    ADD COLUMN IF NOT EXISTS validation_tolerance NUMERIC(18, 2) NOT NULL DEFAULT 0.05,
    ADD COLUMN IF NOT EXISTS system_settlement_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_settlement_amount NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS settlement_difference NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS validation_status VARCHAR(16) NOT NULL DEFAULT 'unvalidated';

ALTER TABLE channel_record_line_items
    ADD COLUMN IF NOT EXISTS platform_settlement_amount NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS system_settlement_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS settlement_difference NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS validation_status VARCHAR(16) NOT NULL DEFAULT 'unvalidated';

UPDATE channel_record_line_items
SET system_settlement_amount = settlement_amount
WHERE system_settlement_amount = 0 AND settlement_amount <> 0;

UPDATE channel_records
SET system_settlement_amount = settlement_amount
WHERE system_settlement_amount = 0 AND settlement_amount <> 0;

CREATE INDEX IF NOT EXISTS ix_channel_records_validation_status
    ON channel_records(validation_status);
