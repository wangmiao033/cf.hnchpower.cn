-- Additive, reversible-in-app voucher split: NULL/NULL means historical semantics.
-- No backfill and no updates to any existing reconciliation or confirmed bill.
ALTER TABLE channel_record_line_items
  ADD COLUMN IF NOT EXISTS voucher_face_value NUMERIC(18, 2) NULL,
  ADD COLUMN IF NOT EXISTS voucher_direct_cost NUMERIC(18, 2) NULL;
