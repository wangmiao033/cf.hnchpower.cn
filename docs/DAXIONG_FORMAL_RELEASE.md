# 大熊独立台账：发布前置条件

当前实现尚未正式上线。此文档不表示备份、迁移或恢复演练已经执行。

## 范围与复用

选择性复用 PR279 的订单批次审计、订单去重、管理员认证及严格导入校验；没有合并旧 PR。新增月表快照、保存请求审计、乐观版本检查和幂等重试。金额以整数分存储，空值保留。研发应付仅引用既有研发账单行，不更新任何研发、渠道、合同、收款或公司总账数据。

前端保留系统壳，只切换大熊页面入口。旧示例页面保留供草稿兼容测试使用，不再从正式入口加载。IndexedDB 不迁移、不删除、不覆盖；用户查看文件及逐月金额后明确确认，才向服务端导入。

## 安全发布顺序

1. 恢复正常 Neon 连接器对既有项目的读取，核实实际生产项目和分支，不使用替代凭据绕过访问错误。
2. 按 PRODUCTION_RUNBOOK 创建并验证生产备份；在隔离分支演练恢复，记录项目、分支、时间和恢复结果。不得把配置字段本身当作备份证据。
3. 在隔离 PostgreSQL 分支运行 `076_self_operated_orders.sql` 和 `077_self_operated_months.sql`；核实新表、约束、权限。运行重复导入、并发保存、失败回滚、跨会话回读测试，删除测试隔离分支按既有管理流程处理。生产不插入测试账。
4. 核对 SQL 仅新增四张独立表。两份 SQL 刻意未加入启动自动迁移列表。生产迁移必须采用既有经授权流程，并记录执行结果。
5. 确认完整 CI 与界面验收通过后发布应用。仅在以上证据齐备后配置既有写入门槛：`DAXIONG_PRODUCTION_NEON_PROJECT_ID`、`DAXIONG_VERIFIED_PRODUCTION_PROJECT_ID`、`DAXIONG_VERIFIED_BACKUP_BRANCH_ID`、`DAXIONG_VERIFIED_BACKUP_AT` 和 `DAXIONG_ORDERS_WRITES_ENABLED`。当前沿用 PR279 的 72 小时备份有效期，超过期限写入自动关闭，需要正常更新真实验证证据；上线前需安排运维维护。
6. 核实 Vercel READY 对应提交；以已认证管理员只读访问 status 和 ledger，确认写入门槛及回读，无数据时应为空。真实录入仅使用用户提供的账单。

## 回退

关闭 `DAXIONG_ORDERS_WRITES_ENABLED`，应用回退至已验证版本；保留四张独立表和审计数据，不执行 DROP 或回写旧系统。若需恢复数据，使用已演练的备份流程，不覆盖上线后合法新增数据。旧本机草稿始终保留。

## 当前阻塞

`neon_describe_project` 读取 `withered-mouse-06737032` 返回 HTTP 404 / UNAVAILABLE：`The request could not be authorized due to an internal error`。无重连链接，原因无法进一步判定。未重试、未改用其他凭据。生产备份恢复、隔离 PostgreSQL 迁移、生产迁移和正式 API 验收尚未执行。
