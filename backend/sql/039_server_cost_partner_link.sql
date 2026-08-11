-- 服务器成本实付主体关联客户库。
-- 保留 payer_entity 名称快照，新增稳定的客户库 ID 关联，兼容历史手工数据。

ALTER TABLE server_costs
  ADD COLUMN IF NOT EXISTS payer_partner_id TEXT;

CREATE INDEX IF NOT EXISTS ix_server_costs_payer_partner_id
  ON server_costs (payer_partner_id);
