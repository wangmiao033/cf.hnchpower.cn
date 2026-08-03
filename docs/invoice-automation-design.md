# 发票自动化与账单关联设计

## 1. 目标

为当前研发账单、渠道账单建立统一的“账单—发票—收付款—税务复核”闭环，在不申请乐企、不保存电子税务局登录凭据的前提下，实现：

- 进项发票通过专用邮箱自动收取。
- 销项发票通过邮箱副本或本地同步助手自动进入系统。
- 发票文件自动解析、去重、归档和识别红冲关系。
- 发票自动推荐匹配真实研发/渠道账单，由财务确认金额分配。
- 每周或月末用税务数字账户导出数据进行差异复核。
- 对账、发票、税务和收付款状态互相独立、可追溯。

## 2. 非目标

- 不实现电子税务局无人值守登录。
- 不保存电子税务局密码、Cookie、短信验证码或数字证书。
- 不调用电子税务局未公开接口。
- 不让发票状态替代账单核对状态。
- 不使用临时 ID 或数组序号关联账单。
- 第一阶段不自动开具发票，只生成开票申请并接收开票结果。

## 3. 当前系统基础与缺口

### 可复用能力

- 研发账单：`reconciliation_records`。
- 渠道账单：`channel_records`。
- 研发付款：`bank_payment_records`。
- 渠道收款：`channel_receipts`。
- 账单附件：`bill_attachments`，已支持 `bill_type + bill_id`。
- 发票台账：`invoice_records`。
- 发票—回款关系：`invoice_payment_links`。
- 发票前端已经包含方向、票种、数电票号、购销方、金额、税额等输入项。

### 必须先解决的缺口

1. 发票前端字段与后端 ORM/Schema 不一致。后端当前只持久化基础字段，完整票号、方向、购销方、税额等字段需要统一。
2. `verified_record_ids` 是 JSON 数组，不能表达账单类型、金额拆分、操作人、红冲和审计，不继续作为主关联方式。
3. `invoice_payment_links` 只能表达“是否关联”，无法表达一次部分收付、多次收付和金额分配。
4. 研发账单、渠道账单页面没有统一发票入口和覆盖率。
5. 没有导入批次、原始文件、重复检测、红蓝票关系和税务差异记录。

## 4. 业务流程

### 4.1 渠道销项链路

1. 渠道账单完成核对。
2. 系统生成开票申请：购买方名称、税号、价税金额、项目名称、账单号。
3. 财务在电子税务局开具销项发票。
4. 将 XML/PDF/OFD 发送到专用邮箱，或由本地助手同步。
5. 系统解析发票并推荐渠道账单。
6. 财务确认分配金额。
7. 系统计算发票覆盖率。
8. 后续登记渠道收款并完成收款核销。

### 4.2 研发进项链路

1. 研发账单完成核对。
2. 系统生成收票通知：我方抬头、税号、应开金额、项目名称、账单号。
3. 研发合作方将发票发送到专用邮箱。
4. 系统解析发票并推荐研发账单。
5. 财务确认分配金额和税务状态。
6. 达到公司付款规则后进入付款审批。
7. 月末与税务数字账户全量数据复核。

### 4.3 状态独立

四类状态分别维护：

- 对账状态：`pending / confirmed`。
- 发票覆盖状态：计算得出 `none / partial / complete / over`。
- 税务状态：`normal / red / void / unknown`。
- 收付款状态：沿用研发付款和渠道收款模块。

禁止使用一个 `status` 同时表达以上多个维度。

## 5. 数据模型

### 5.1 完整发票台账 `invoice_records`

在保留现有主键的基础上统一字段：

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `direction` | `input / output` |
| `invoice_type` | 数电专票、数电普票等 |
| `digital_invoice_no` | 数电发票号码 |
| `invoice_code` | 传统发票代码，可空 |
| `invoice_no` | 传统发票号码，可空 |
| `invoice_identity_key` | 标准化唯一键 |
| `buyer_name/buyer_tax_no` | 购买方 |
| `seller_name/seller_tax_no` | 销售方 |
| `net_amount` | 不含税金额 |
| `tax_amount` | 税额 |
| `gross_amount` | 价税合计 |
| `issue_date` | 开票日期 |
| `tax_status` | `normal / red / void / unknown` |
| `deduction_status` | 进项用途确认状态，可空 |
| `original_invoice_id` | 红票对应原蓝票，可空 |
| `source` | `email / tax_helper / upload / manual` |
| `latest_import_batch_id` | 最近导入批次 |
| `raw_payload` | 结构化原始数据，受控保存 |
| `created_at/updated_at` | 时间戳 |

唯一键规则：

- 有数电票号：`digital:{digital_invoice_no}`。
- 传统发票：`legacy:{invoice_code}:{invoice_no}`。
- 未识别文件暂存：`file:{sha256}`，不得自动进入正式台账。

### 5.2 原始文件 `invoice_documents`

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `invoice_id` | 可空，解析成功后回填 |
| `import_batch_id` | 导入批次 |
| `file_name/file_url/file_type/file_size` | 文件元数据 |
| `sha256` | 文件去重与完整性校验 |
| `document_kind` | `xml / pdf / ofd / image / zip` |
| `parse_status` | `pending / parsed / failed / quarantined` |
| `parse_error` | 失败原因 |
| `created_at` | 时间戳 |

XML作为结构化数据优先来源，PDF/OFD作为可视原件；同一发票可以保存多个格式。

### 5.3 导入批次 `invoice_import_batches`

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `source` | `email / tax_helper / upload` |
| `period_start/period_end` | 数据覆盖期间 |
| `external_message_id` | 邮件 Message-ID 或同步任务 ID |
| `status` | `running / completed / partial / failed` |
| `total/created/updated/duplicate/failed` | 处理统计 |
| `created_by` | 操作人或系统任务 |
| `created_at/completed_at` | 时间戳 |

批次必须幂等，同一邮件、文件或同步任务重复执行不能生成重复发票。

### 5.4 账单—发票金额分配 `bill_invoice_allocations`

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `bill_type` | `rd / channel` |
| `bill_id` | 真实账单 ID |
| `invoice_id` | 发票 ID |
| `allocated_net_amount` | 分配不含税金额 |
| `allocated_tax_amount` | 分配税额 |
| `allocated_gross_amount` | 分配价税合计 |
| `status` | `suggested / confirmed / reversed` |
| `match_score` | 0～1 |
| `match_reasons` | JSON规则命中说明 |
| `confirmed_by/confirmed_at` | 确认审计 |
| `created_at/updated_at` | 时间戳 |

约束：

- 唯一：`bill_type + bill_id + invoice_id + status(active)`。
- 已确认分配金额不得超过发票当前可分配有效金额。
- 红冲/作废不能直接删除历史分配，改为 `reversed` 并生成异常。

### 5.5 发票—收付款分配

现有 `invoice_payment_links` 后续升级为金额分配模型，至少增加：

- `allocated_amount`
- `status`
- `confirmed_by`
- `confirmed_at`

第一阶段只做账单—发票，不同时重构收付款，避免范围过大。

### 5.6 异常记录 `invoice_exceptions`

异常类型：

- `unmatched_invoice`
- `missing_invoice`
- `duplicate_invoice`
- `amount_mismatch`
- `tax_no_mismatch`
- `red_invoice_linked`
- `void_invoice_linked`
- `internal_only`
- `tax_only`
- `parse_failed`

异常支持待处理、已解决、忽略三种状态，并记录解决人和说明。

## 6. 覆盖率与金额规则

默认按价税合计与账单 `settlement_amount` 比较，同时保留配置项：

```text
effective_invoice_amount
= confirmed normal invoice allocations
- confirmed red invoice allocations
```

```text
coverage_percent = effective_invoice_amount / bill_settlement_amount * 100%
remaining_amount = bill_settlement_amount - effective_invoice_amount
```

状态：

- `none`：有效分配为0。
- `partial`：大于0且小于账单金额。
- `complete`：在允许误差内相等。
- `over`：超过账单金额和允许误差。

默认误差0.01元；是否按价税合计覆盖作为系统设置，避免硬编码到业务逻辑。

## 7. 自动匹配

自动匹配只生成建议，不直接确认。

### 7.1 硬性过滤

- 研发账单只推荐进项发票，渠道账单只推荐销项发票；管理员可人工例外。
- 作废票不参与匹配。
- 已无可分配金额的发票不参与匹配。
- 发票日期与账单月份默认相差不超过90天。

### 7.2 评分

| 规则 | 权重 |
|---|---:|
| 对手方税号完全一致 | 0.40 |
| 剩余金额在误差内一致 | 0.30 |
| 对手方名称/别名一致 | 0.12 |
| 账单月份与开票日期接近 | 0.08 |
| 发票备注包含账单号 | 0.06 |
| 项目/游戏名称命中 | 0.04 |

- `>= 0.90`：高置信度，列表默认置顶。
- `0.70～0.89`：需要财务复核。
- `< 0.70`：不主动推荐，可手工搜索。

每个候选必须展示命中原因，不能只显示一个黑盒分数。

## 8. 专用邮箱收票

### 8.1 架构

```text
邮箱（IMAP）
  -> 定时拉取未处理邮件
  -> 建立导入批次
  -> 附件安全检查
  -> ZIP解压和文件哈希
  -> XML/PDF/OFD解析
  -> 发票去重/更新
  -> 自动匹配
  -> 异常中心
```

### 8.2 邮箱配置

- 使用独立邮箱或别名，例如 `invoice@company-domain`。
- 使用邮箱授权码/OAuth，不保存主账号密码。
- 凭据只放服务端环境变量，前端不可读取。
- 保存 `Message-ID` 并设置唯一约束，避免重复消费。
- 默认只接收白名单附件类型和有限大小。

### 8.3 邮件处理策略

- 一封邮件可以包含多张发票。
- 无附件邮件进入“待人工处理”，不自动丢弃。
- 附件解析失败保留原件和错误原因。
- 邮件正文中的账单号、公司名可作为匹配辅助信息。
- 成功处理后用数据库状态确认，不依赖邮箱已读标志。

## 9. 本地税务同步助手

### 9.1 定位

本地助手是“用户登录后的导出搬运器”，不是税务局机器人。

### 9.2 安全边界

- 用户自行完成税务局登录、实名验证和验证码。
- 助手不持久化登录Cookie，不上传Cookie。
- 助手不调用未公开接口。
- 只读取用户主动选择或官方导出的文件。
- 上传前展示期间、文件数量和目标企业，用户确认后执行。

### 9.3 第一版形态

优先采用本地文件夹监听助手，而不是浏览器DOM自动化：

1. 用户在税务数字账户导出或下载发票。
2. 文件进入配置目录。
3. 助手检测新文件并计算哈希。
4. 用户点击“同步本月”。
5. 助手上传新文件并展示结果。

原因：比浏览器扩展稳定，税务局页面改版时不需要同步维护选择器。

### 9.4 后续增强

若下载操作仍然频繁，可增加浏览器扩展，仅负责定位官方导出按钮和读取下载结果；文件解析和业务逻辑仍在统一后端完成。

## 10. API设计

建议新增：

```text
POST   /api/invoice-imports/files
POST   /api/invoice-imports/email/poll
GET    /api/invoice-imports/{batch_id}
GET    /api/invoices/{invoice_id}/documents
GET    /api/bills/{bill_type}/{bill_id}/invoice-summary
GET    /api/bills/{bill_type}/{bill_id}/invoice-candidates
POST   /api/bill-invoice-allocations
PUT    /api/bill-invoice-allocations/{id}
DELETE /api/bill-invoice-allocations/{id}
GET    /api/invoice-exceptions
PUT    /api/invoice-exceptions/{id}
POST   /api/tax-reconciliation/compare
```

删除分配接口执行逻辑撤销，不物理删除审计记录。

## 11. 页面设计

### 11.1 对账进度页

研发和渠道表格统一增加：

- 发票覆盖：`未关联 / 70% / 已完成 / 超额`。
- 收付状态：复用现有统计。
- 风险数量。
- “发票”按钮。

点击“发票”打开统一抽屉，页面只渲染一次抽屉组件。

### 11.2 账单发票抽屉

顶部：

- 账单金额。
- 已分配金额。
- 剩余金额。
- 覆盖率。
- 对账、税务、收付三个状态。

内容：

- 已关联发票。
- 自动推荐候选及命中原因。
- 手工搜索发票。
- 分配金额输入。
- 原件预览。
- 解除/重新分配。

### 11.3 发票收件箱

四个页签：

- 待确认。
- 已自动识别。
- 解析失败。
- 重复/红冲异常。

### 11.4 税务差异中心

按月份展示：

- 税务局有、系统没有。
- 系统有、税务局没有。
- 金额/税额/状态不同。
- 红冲和作废变化。
- 账单缺票。

## 12. 完成核对与付款规则

- 对账完成不强制要求发票已到，因为业务上通常先核对再开/收票。
- 渠道账单完成核对后进入“待开销项发票”。
- 研发账单完成核对后进入“待收进项发票”。
- 是否阻止研发付款由公司规则配置；推荐默认提示但不硬阻断，稳定运行后再开启强校验。
- 月度关账前，所有高风险税务差异必须处理或由有权限人员明确忽略。

## 13. 权限与审计

角色建议：

- 业务人员：查看账单和发票覆盖率。
- 财务：导入、匹配、确认和解除分配。
- 财务管理员：配置邮箱、处理红冲/作废、忽略异常。
- 审计查看者：只读访问历史和操作日志。

关键事件记录：

- 发票导入、更新、重复合并。
- 分配建议、确认、修改、撤销。
- 红冲/作废触发反向处理。
- 异常处理和忽略。
- 邮箱配置变更和同步任务执行。

## 14. 分阶段实施

### 阶段0：数据模型校准

- 统一发票前后端字段。
- 补充唯一键、红蓝票、税务状态和原件表。
- 迁移现有发票数据并生成身份键。
- 生产数据迁移前先做只读审计和备份。

### 阶段1：账单—发票闭环

- 新增分配表和API。
- 研发/渠道进度页增加发票状态。
- 新增统一发票抽屉。
- 支持手工关联、多票对一账单和一票分配多账单。

### 阶段2：邮箱自动收票

- IMAP连接、批次和文件处理。
- XML优先解析，PDF/OFD原件归档。
- 自动去重、候选匹配、失败隔离。
- 发票收件箱和任务日志。

### 阶段3：本地同步与税务差异

- 本地目录助手。
- 月份差量上传。
- 税务全量数据对比和差异中心。
- 根据实际使用决定是否增加浏览器辅助导出。

### 阶段4：收付款金额分配

- 将现有发票—回款关系升级为金额分配。
- 打通渠道收款和研发付款。
- 增加月度关账规则。

## 15. 验收标准

- 同一XML、邮件或税务导出重复导入不会重复建票。
- 发票完整保存方向、票号、购销方、金额、税额和价税合计。
- 研发和渠道账单都只能用真实数据库ID关联。
- 支持一账单多票、一票多账单和部分分配。
- 作废票不计算覆盖率；红票正确抵减覆盖率。
- 自动匹配展示明确原因，未经财务确认不改变账单覆盖率。
- 邮箱失败不会丢失原始邮件/附件，并可重试。
- 本地助手不保存或上传税务局身份凭据。
- 所有分配变更可追溯到操作人和时间。
- 税务差异报告可以按月重跑且结果幂等。

## 16. 需要业务确认的两个配置

1. 发票覆盖账单金额默认按“价税合计”还是“不含税金额”。本设计默认价税合计。
2. 研发付款是否必须达到100%进项发票覆盖。本设计第一阶段默认提示、不硬阻断。

## 17. 官方能力依据

- 国家税务总局明确单位可通过税务数字账户免费查询、下载、打印、导出已开具或接受的数电发票：
  https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html
- 广东电子税务局支持税务数字账户自动交付、邮箱交付，以及PDF/OFD/XML下载：
  https://gtm-cn-uqm3dbhc20k.guangdong.chinatax.gov.cn/gdsw/zhsw_dzswj_szhdzfpl/2022-12/08/content_9666d41385c445d989590a1481502cac.shtml

