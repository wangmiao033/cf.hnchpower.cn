-- Channel bill line items can belong to different settlement months in one statement.
-- Backfill historical lines from the parent bill month so existing data keeps its meaning.

ALTER TABLE channel_record_line_items
  ADD COLUMN IF NOT EXISTS settlement_cycle VARCHAR(16);

UPDATE channel_record_line_items AS line
SET settlement_cycle = parent.settlement_month
FROM channel_records AS parent
WHERE line.channel_record_id = parent.id
  AND (line.settlement_cycle IS NULL OR BTRIM(line.settlement_cycle) = '')
  AND parent.settlement_month IS NOT NULL
  AND BTRIM(parent.settlement_month) <> '';

CREATE INDEX IF NOT EXISTS ix_channel_record_line_items_settlement_cycle
  ON channel_record_line_items (settlement_cycle);
