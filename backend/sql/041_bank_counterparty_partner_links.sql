-- V3.2 银行对方户名与客户中心映射。
-- 不修改原始银行流水，只保存“银行显示名称 -> 客户ID”的身份解析规则。

CREATE TABLE IF NOT EXISTS bank_counterparty_partner_links (
  normalized_counterparty_name TEXT PRIMARY KEY,
  counterparty_name_snapshot TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  match_method TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT NOT NULL DEFAULT '',
  created_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_counterparty_partner_links_partner
  ON bank_counterparty_partner_links (partner_id);
