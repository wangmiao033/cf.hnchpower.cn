-- Stable game identity bridge between channel history and contract access items.
-- This migration never changes historical financial amounts/rates; it only adds identity metadata.

CREATE TABLE IF NOT EXISTS game_registry_aliases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_registry_games(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_registry_aliases_game
  ON game_registry_aliases (game_id);

CREATE TABLE IF NOT EXISTS contract_access_game_links (
  access_item_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_registry_games(id) ON DELETE RESTRICT,
  match_method TEXT NOT NULL DEFAULT 'auto_exact',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_access_game_links_game
  ON contract_access_game_links (game_id);

ALTER TABLE channel_record_line_items
  ADD COLUMN IF NOT EXISTS game_id TEXT NULL REFERENCES game_registry_games(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_channel_record_line_items_game_id
  ON channel_record_line_items (game_id);

-- Bootstrap stable game identities from existing channel history.
WITH source_names AS (
  SELECT
    BTRIM(game_name) AS display_name,
    LOWER(REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(game_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')) AS normalized_name
  FROM channel_record_line_items
  WHERE BTRIM(COALESCE(game_name, '')) <> ''
), grouped AS (
  SELECT normalized_name, MIN(display_name) AS canonical_name
  FROM source_names
  WHERE normalized_name <> ''
  GROUP BY normalized_name
)
INSERT INTO game_registry_games (id, canonical_name, normalized_name, status, source)
SELECT 'game-' || MD5(normalized_name), canonical_name, normalized_name, 'active', 'history-bootstrap'
FROM grouped
ON CONFLICT (normalized_name) DO NOTHING;

WITH source_names AS (
  SELECT
    BTRIM(game_name) AS display_name,
    LOWER(REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(game_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')) AS normalized_name
  FROM channel_record_line_items
  WHERE BTRIM(COALESCE(game_name, '')) <> ''
), grouped AS (
  SELECT normalized_name, MIN(display_name) AS alias_name
  FROM source_names
  WHERE normalized_name <> ''
  GROUP BY normalized_name
)
INSERT INTO game_registry_aliases (id, game_id, alias_name, normalized_alias, source)
SELECT
  'alias-' || MD5(game.id || ':' || grouped.normalized_name),
  game.id,
  grouped.alias_name,
  grouped.normalized_name,
  'history-bootstrap'
FROM grouped
JOIN game_registry_games AS game ON game.normalized_name = grouped.normalized_name
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE channel_record_line_items AS line
SET game_id = game.id
FROM game_registry_games AS game
WHERE line.game_id IS NULL
  AND BTRIM(COALESCE(line.game_name, '')) <> ''
  AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(line.game_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')) = game.normalized_name;

-- Contract tables are owned by the data service and may not exist in a fresh core-only DB.
-- When present, bootstrap contract product identities and exact access-item links.
DO $$
BEGIN
  IF TO_REGCLASS('public.cf_contract_access_items') IS NOT NULL THEN
    EXECUTE $sql$
      WITH source_names AS (
        SELECT
          BTRIM(product_name) AS display_name,
          LOWER(REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(product_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')) AS normalized_name
        FROM cf_contract_access_items
        WHERE BTRIM(COALESCE(product_name, '')) <> ''
      ), grouped AS (
        SELECT normalized_name, MIN(display_name) AS canonical_name
        FROM source_names
        WHERE normalized_name <> ''
        GROUP BY normalized_name
      )
      INSERT INTO game_registry_games (id, canonical_name, normalized_name, status, source)
      SELECT 'game-' || MD5(normalized_name), canonical_name, normalized_name, 'active', 'contract-bootstrap'
      FROM grouped
      ON CONFLICT (normalized_name) DO NOTHING
    $sql$;

    EXECUTE $sql$
      WITH source_names AS (
        SELECT
          BTRIM(product_name) AS display_name,
          LOWER(REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(product_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')) AS normalized_name
        FROM cf_contract_access_items
        WHERE BTRIM(COALESCE(product_name, '')) <> ''
      ), grouped AS (
        SELECT normalized_name, MIN(display_name) AS alias_name
        FROM source_names
        WHERE normalized_name <> ''
        GROUP BY normalized_name
      )
      INSERT INTO game_registry_aliases (id, game_id, alias_name, normalized_alias, source)
      SELECT
        'alias-' || MD5(game.id || ':' || grouped.normalized_name),
        game.id,
        grouped.alias_name,
        grouped.normalized_name,
        'contract-bootstrap'
      FROM grouped
      JOIN game_registry_games AS game ON game.normalized_name = grouped.normalized_name
      ON CONFLICT (normalized_alias) DO NOTHING
    $sql$;

    EXECUTE $sql$
      INSERT INTO contract_access_game_links (access_item_id, game_id, match_method, confirmed)
      SELECT access.id, alias.game_id, 'auto_exact', FALSE
      FROM cf_contract_access_items AS access
      JOIN game_registry_aliases AS alias
        ON alias.normalized_alias = LOWER(
          REGEXP_REPLACE(REPLACE(REPLACE(BTRIM(access.product_name), '（', '('), '）', ')'), '[[:space:]]+', '', 'g')
        )
      WHERE BTRIM(COALESCE(access.product_name, '')) <> ''
      ON CONFLICT (access_item_id) DO NOTHING
    $sql$;
  END IF;
END
$$;