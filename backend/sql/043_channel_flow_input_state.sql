ALTER TABLE channel_record_line_items
ADD COLUMN IF NOT EXISTS flow_input_state VARCHAR(24) NOT NULL DEFAULT 'confirmed';

UPDATE channel_record_line_items
SET flow_input_state = 'confirmed'
WHERE flow_input_state IS NULL OR BTRIM(flow_input_state) = '';
