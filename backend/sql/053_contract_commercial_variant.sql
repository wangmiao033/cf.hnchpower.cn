ALTER TABLE cf_contract_access_terms
ADD COLUMN IF NOT EXISTS commercial_variant TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cf_contract_access_terms_commercial_variant
ON cf_contract_access_terms (commercial_variant)
WHERE commercial_variant <> '';

-- Backfill the common discount versions from existing product names so old contracts
-- immediately benefit from structured matching without requiring manual re-entry.
UPDATE cf_contract_access_terms AS terms
SET commercial_variant = CASE
  WHEN access.product_name ~* '(^|[^0-9])0[.]0?5[[:space:]]*折' THEN '0.05折'
  WHEN access.product_name ~* '(^|[^0-9])0[.]1[[:space:]]*折' THEN '0.1折'
  WHEN access.product_name ~* '(^|[^0-9])0[.]2[[:space:]]*折' THEN '0.2折'
  WHEN access.product_name ~* '(^|[^0-9])0[.]3[[:space:]]*折' THEN '0.3折'
  WHEN access.product_name ~* '(^|[^0-9])0[.]5[[:space:]]*折' THEN '0.5折'
  WHEN access.product_name ~* '(^|[^0-9])1[[:space:]]*折' THEN '1折'
  WHEN access.product_name ~* '(^|[^0-9])2[[:space:]]*折' THEN '2折'
  WHEN access.product_name ~* '(^|[^0-9])3[[:space:]]*折' THEN '3折'
  WHEN access.product_name ~* '(^|[^0-9])5[[:space:]]*折' THEN '5折'
  ELSE terms.commercial_variant
END
FROM cf_contract_access_items AS access
WHERE access.id = terms.access_item_id
  AND terms.commercial_variant = '';
