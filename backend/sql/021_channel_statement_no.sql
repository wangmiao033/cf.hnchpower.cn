ALTER TABLE channel_records
ADD COLUMN IF NOT EXISTS statement_no VARCHAR;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_records_statement_no
ON channel_records(statement_no)
WHERE statement_no IS NOT NULL;
