-- Additive customer/legal-entity and bank ownership model.
-- No changes to existing contract, settlement, receipt, bank or invoice amounts.
-- Applied only by the versioned migration job; never from request handlers.

CREATE TABLE IF NOT EXISTS cf_legal_entities (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  tax_registration_no TEXT NOT NULL DEFAULT '',
  entity_kind TEXT NOT NULL DEFAULT 'counterparty'
    CHECK (entity_kind IN ('counterparty', 'own', 'both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cf_partner_legal_entity_links (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES cf_partner_records(id) ON DELETE RESTRICT,
  entity_id TEXT NOT NULL REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('contract', 'payer', 'invoice')),
  effective_month VARCHAR(7) NOT NULL,
  end_month VARCHAR(7),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_cf_party_period_start CHECK (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT ck_cf_party_period_end CHECK (
    end_month IS NULL OR (
      end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      AND end_month >= effective_month
    )
  ),
  CONSTRAINT uq_cf_partner_entity_role_start UNIQUE(partner_id, role, effective_month)
);

CREATE INDEX IF NOT EXISTS idx_cf_partner_entities_lookup
  ON cf_partner_legal_entity_links(partner_id, role, effective_month, end_month);
CREATE INDEX IF NOT EXISTS idx_cf_partner_entities_entity
  ON cf_partner_legal_entity_links(entity_id);

CREATE TABLE IF NOT EXISTS cf_entity_bank_accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  account_no TEXT NOT NULL,
  normalized_account TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL DEFAULT '',
  currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
  account_label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_cf_entity_account_nonblank CHECK (LENGTH(normalized_account) >= 6)
);
CREATE INDEX IF NOT EXISTS idx_cf_entity_bank_accounts_entity
  ON cf_entity_bank_accounts(entity_id, is_active);

-- Snapshot of the contractual and expected cash identities on each channel bill.
-- Historic rows deliberately stay NULL: no speculative backfill of settled bills.
ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES cf_partner_records(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contract_entity_id TEXT REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contract_entity_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS expected_payer_entity_id TEXT REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS expected_payer_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS expected_receiving_entity_id TEXT REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS expected_receiving_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS invoice_entity_id TEXT REFERENCES cf_legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS invoice_entity_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS payer_override_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_channel_records_partner_id
  ON channel_records(partner_id, settlement_month);
CREATE INDEX IF NOT EXISTS idx_channel_records_expected_payer
  ON channel_records(expected_payer_entity_id);
