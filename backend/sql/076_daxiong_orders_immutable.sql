-- 大熊游戏独立订单台账。需先完成并验证生产数据库可恢复备份，
-- 再由人工授权的 migration CLI/deploy 执行；应用构建/启动不自动执行 DDL。
-- 本迁移不触碰现有研发、渠道、合同、银行、发票或运营费用表。

CREATE TABLE IF NOT EXISTS daxiong_order_import_batches (
  id TEXT PRIMARY KEY,
  source_file_sha256 CHAR(64) NOT NULL UNIQUE,
  source_file_name TEXT NOT NULL,
  source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes BETWEEN 1 AND 3145728),
  original_csv BYTEA NOT NULL CHECK (octet_length(original_csv) BETWEEN 1 AND 3145728),
  records_read INTEGER NOT NULL CHECK (records_read BETWEEN 1 AND 30000),
  records_eligible INTEGER NOT NULL CHECK (records_eligible BETWEEN 0 AND 30000),
  records_inserted INTEGER NOT NULL CHECK (records_inserted BETWEEN 0 AND 30000),
  records_existing INTEGER NOT NULL CHECK (records_existing BETWEEN 0 AND 30000),
  records_excluded INTEGER NOT NULL CHECK (records_excluded BETWEEN 0 AND 30000),
  game_cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (game_cash_cents >= 0),
  coin_topup_cents BIGINT NOT NULL DEFAULT 0 CHECK (coin_topup_cents >= 0),
  imported_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daxiong_batch_row_count_consistent CHECK (
    records_eligible = records_inserted + records_existing
    AND records_read = records_eligible + records_excluded
  )
);

CREATE TABLE IF NOT EXISTS daxiong_order_records (
  order_id TEXT PRIMARY KEY,
  paid_date DATE NOT NULL,
  paid_month CHAR(7) NOT NULL CHECK (paid_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  game_external_id TEXT NOT NULL DEFAULT '',
  game_name TEXT NOT NULL,
  cash_paid_cents BIGINT NOT NULL CHECK (cash_paid_cents > 0 AND cash_paid_cents <= 100000000000),
  order_kind TEXT NOT NULL CHECK (order_kind IN ('game', 'coin')),
  payment_method TEXT NOT NULL DEFAULT '',
  source_fingerprint CHAR(64) NOT NULL,
  first_batch_id TEXT NOT NULL REFERENCES daxiong_order_import_batches(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daxiong_order_id_valid CHECK (length(order_id) BETWEEN 1 AND 160),
  CONSTRAINT daxiong_order_game_name_valid CHECK (length(game_name) BETWEEN 1 AND 250),
  CONSTRAINT daxiong_order_month_date_consistent CHECK (
    paid_month = to_char(paid_date, 'YYYY-MM')
  )
);

CREATE INDEX IF NOT EXISTS idx_daxiong_order_month_kind
  ON daxiong_order_records (paid_month, order_kind);
CREATE INDEX IF NOT EXISTS idx_daxiong_order_month_game
  ON daxiong_order_records (paid_month, game_external_id);
CREATE INDEX IF NOT EXISTS idx_daxiong_import_batches_date
  ON daxiong_order_import_batches (created_at DESC);
