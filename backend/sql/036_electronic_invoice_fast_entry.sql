-- Electronic invoice fast-entry metadata and durable source-file linkage.

ALTER TABLE invoice_records
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS source_file_name TEXT,
    ADD COLUMN IF NOT EXISTS source_file_url TEXT,
    ADD COLUMN IF NOT EXISTS source_file_type TEXT,
    ADD COLUMN IF NOT EXISTS source_file_size BIGINT;

CREATE INDEX IF NOT EXISTS ix_invoice_records_source_file_name
    ON invoice_records(source_file_name)
    WHERE source_file_name IS NOT NULL;
