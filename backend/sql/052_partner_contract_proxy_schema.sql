-- Partner / contract master-data schema. Runtime API requests must never execute DDL.

CREATE TABLE IF NOT EXISTS cf_partner_records (
  id TEXT PRIMARY KEY,
  normalized_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '研发商',
  tag TEXT NOT NULL DEFAULT '',
  tax_registration_no TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  invoice_content TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  mailing_address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cf_partner_records
  ADD COLUMN IF NOT EXISTS short_name TEXT NOT NULL DEFAULT '';

-- One-time compatibility cleanup that used to run during every customer request.
UPDATE cf_partner_records
SET
  short_name = BTRIM(SUBSTRING(tag FROM '^简称[:：][[:space:]]*([^；;]+)')),
  tag = BTRIM(REGEXP_REPLACE(tag, '^简称[:：][[:space:]]*[^；;]+[；;]?[[:space:]]*', ''))
WHERE short_name = '' AND tag ~ '^简称[:：]';

CREATE TABLE IF NOT EXISTS cf_partner_data_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cf_partner_alias_repair_backup (
  migration_key TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  old_short_name TEXT NOT NULL,
  new_short_name TEXT NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (migration_key, partner_id)
);

WITH repairs(normalized_name, new_short_name) AS (
  VALUES
    ('玩咖', '玩咖'),
    ('广州熊动科技有限公司', '熊动'),
    ('北京千幻文化传媒有限公司', '千幻'),
    ('广州超凡响应网络科技有限公司', '超凡响应'),
    ('杭州司墨网络科技有限公司', '司墨'),
    ('杭州速发网络科技有限公司', '速发'),
    ('广州沙巴克网络科技有限公司', '沙巴克'),
    ('广州玺越网络科技有限公司', '玺越'),
    ('西安游海网络科技有限公司', '游海'),
    ('西安麦游网络科技有限公司', '麦游')
)
INSERT INTO cf_partner_alias_repair_backup (
  migration_key, partner_id, partner_name, old_short_name, new_short_name
)
SELECT
  '20260726_split_combined_customer_aliases_v1', partner.id, partner.name,
  partner.short_name, repairs.new_short_name
FROM cf_partner_records AS partner
JOIN repairs USING (normalized_name)
WHERE partner.short_name IS DISTINCT FROM repairs.new_short_name
ON CONFLICT (migration_key, partner_id) DO NOTHING;

WITH repairs(normalized_name, new_short_name) AS (
  VALUES
    ('玩咖', '玩咖'),
    ('广州熊动科技有限公司', '熊动'),
    ('北京千幻文化传媒有限公司', '千幻'),
    ('广州超凡响应网络科技有限公司', '超凡响应'),
    ('杭州司墨网络科技有限公司', '司墨'),
    ('杭州速发网络科技有限公司', '速发'),
    ('广州沙巴克网络科技有限公司', '沙巴克'),
    ('广州玺越网络科技有限公司', '玺越'),
    ('西安游海网络科技有限公司', '游海'),
    ('西安麦游网络科技有限公司', '麦游')
)
UPDATE cf_partner_records AS partner
SET short_name = repairs.new_short_name, updated_at = NOW()
FROM repairs
WHERE partner.normalized_name = repairs.normalized_name
  AND partner.short_name IS DISTINCT FROM repairs.new_short_name;

INSERT INTO cf_partner_data_migrations (migration_key)
VALUES ('20260726_split_combined_customer_aliases_v1')
ON CONFLICT (migration_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cf_partner_records_category
ON cf_partner_records (category);

CREATE TABLE IF NOT EXISTS cf_reconciliation_partner_links (
  reconciliation_id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES cf_partner_records(id) ON DELETE RESTRICT,
  partner_name_snapshot TEXT NOT NULL DEFAULT '',
  match_method TEXT NOT NULL DEFAULT 'exact_name',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_reconciliation_partner_links_partner
ON cf_reconciliation_partner_links (partner_id);

CREATE TABLE IF NOT EXISTS cf_contract_records (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manual',
  source_key TEXT NOT NULL UNIQUE,
  contract_name TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT 'master',
  platform_record_id TEXT NOT NULL DEFAULT '',
  amount NUMERIC(18, 2) NULL,
  counterparty TEXT NOT NULL DEFAULT '',
  normalized_counterparty TEXT NOT NULL DEFAULT '',
  contract_no TEXT NOT NULL DEFAULT '',
  signing_date DATE NULL,
  signing_status TEXT NOT NULL DEFAULT '',
  effective_date DATE NULL,
  end_date DATE NULL,
  performance_status TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  partner_id TEXT NULL REFERENCES cf_partner_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cf_contract_records
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'master',
  ADD COLUMN IF NOT EXISTS platform_record_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cf_contract_records_end_date
ON cf_contract_records (end_date);
CREATE INDEX IF NOT EXISTS idx_cf_contract_records_counterparty
ON cf_contract_records (normalized_counterparty);
CREATE INDEX IF NOT EXISTS idx_cf_contract_records_partner_id
ON cf_contract_records (partner_id);

CREATE TABLE IF NOT EXISTS cf_contract_attachment_files (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES cf_contract_records(id) ON DELETE CASCADE,
  expected_name TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  blob_pathname TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cf_contract_attachment_files_contract
ON cf_contract_attachment_files (contract_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_contract_attachment_files_dedupe
ON cf_contract_attachment_files (contract_id, checksum_sha256)
WHERE checksum_sha256 <> '';

CREATE TABLE IF NOT EXISTS cf_contract_access_items (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES cf_contract_records(id) ON DELETE CASCADE,
  channel_name TEXT NOT NULL DEFAULT '',
  agreement_type TEXT NOT NULL DEFAULT '',
  platform_record_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  rights_source TEXT NOT NULL DEFAULT '',
  game_status TEXT NOT NULL DEFAULT '',
  agreement_status TEXT NOT NULL DEFAULT '',
  authorization_start DATE NULL,
  authorization_end DATE NULL,
  share_rate NUMERIC(7, 2) NULL,
  channel_fee_rate NUMERIC(7, 2) NULL,
  software_copyright_no TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  territory TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '生效',
  remarks TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cf_contract_access_items
  ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS game_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreement_status TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cf_contract_access_items_contract
ON cf_contract_access_items (contract_id, authorization_end, created_at);
CREATE INDEX IF NOT EXISTS idx_cf_contract_access_items_product
ON cf_contract_access_items (product_name);
