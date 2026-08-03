ALTER TABLE invoice_records
  ADD COLUMN IF NOT EXISTS invoice_direction TEXT NOT NULL DEFAULT 'output',
  ADD COLUMN IF NOT EXISTS invoice_type TEXT,
  ADD COLUMN IF NOT EXISTS digital_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS invoice_code TEXT,
  ADD COLUMN IF NOT EXISTS invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS invoice_identity_key TEXT,
  ADD COLUMN IF NOT EXISTS buyer_name TEXT,
  ADD COLUMN IF NOT EXISTS buyer_tax_no TEXT,
  ADD COLUMN IF NOT EXISTS seller_name TEXT,
  ADD COLUMN IF NOT EXISTS seller_tax_no TEXT,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_with_tax NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issuer TEXT,
  ADD COLUMN IF NOT EXISTS invoice_source TEXT,
  ADD COLUMN IF NOT EXISTS tax_status TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS original_invoice_id TEXT;

UPDATE invoice_records
SET amount_with_tax = invoice_amount + tax_amount
WHERE amount_with_tax = 0 AND (invoice_amount <> 0 OR tax_amount <> 0);

UPDATE invoice_records
SET invoice_identity_key = CASE
  WHEN COALESCE(BTRIM(digital_invoice_no), '') <> '' THEN 'digital:' || BTRIM(digital_invoice_no)
  WHEN COALESCE(BTRIM(invoice_code), '') <> '' AND COALESCE(BTRIM(invoice_no), '') <> ''
    THEN 'legacy:' || BTRIM(invoice_code) || ':' || BTRIM(invoice_no)
  ELSE NULL
END
WHERE invoice_identity_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_records_identity_key
  ON invoice_records (invoice_identity_key);
CREATE INDEX IF NOT EXISTS idx_invoice_records_direction
  ON invoice_records (invoice_direction);

WITH ranked_identities AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY invoice_identity_key
    ORDER BY created_at, id
  ) AS duplicate_rank
  FROM invoice_records
  WHERE invoice_identity_key IS NOT NULL
)
UPDATE invoice_records AS invoice
SET invoice_identity_key = NULL
FROM ranked_identities AS ranked
WHERE invoice.id = ranked.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_records_identity_key
  ON invoice_records (invoice_identity_key)
  WHERE invoice_identity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bill_invoice_allocations (
  id TEXT PRIMARY KEY,
  bill_type TEXT NOT NULL CHECK (bill_type IN ('rd', 'channel')),
  bill_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoice_records(id) ON DELETE RESTRICT,
  allocated_net_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  allocated_tax_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  allocated_gross_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  match_type TEXT NOT NULL DEFAULT 'manual',
  match_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_invoice_allocations_bill
  ON bill_invoice_allocations (bill_type, bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_invoice_allocations_invoice
  ON bill_invoice_allocations (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_invoice_allocations_active
  ON bill_invoice_allocations (bill_type, bill_id, invoice_id)
  WHERE status IN ('suggested', 'confirmed');
