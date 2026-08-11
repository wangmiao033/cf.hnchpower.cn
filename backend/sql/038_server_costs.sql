CREATE TABLE IF NOT EXISTS server_costs (
  id TEXT PRIMARY KEY,
  expense_month VARCHAR(16) NOT NULL,
  expense_date VARCHAR(32),
  provider_name TEXT,
  category VARCHAR(32) NOT NULL DEFAULT 'cloud_server',
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  game_name TEXT,
  payer_entity TEXT,
  remark TEXT,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_server_costs_expense_month ON server_costs (expense_month);
CREATE INDEX IF NOT EXISTS idx_server_costs_category ON server_costs (category);
CREATE INDEX IF NOT EXISTS idx_server_costs_status ON server_costs (status);
CREATE INDEX IF NOT EXISTS idx_server_costs_game_name ON server_costs (game_name);
CREATE INDEX IF NOT EXISTS idx_server_costs_provider_name ON server_costs (provider_name);
