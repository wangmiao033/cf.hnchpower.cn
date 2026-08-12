/**
 * Core routes for the rebuilt reconciliation console.
 */

export const VIEWS = {
  DASHBOARD: 'dashboard',
  FINANCE_WORKBENCH: 'finance-workbench',
  SERVER_COSTS: 'server-costs',
  BUSINESS_DASHBOARD: 'business-dashboard',
  PROFIT_ANALYSIS: 'profit-analysis',
  ANOMALIES: 'anomalies',
  BANK_RECONCILIATION: 'bank-reconciliation',
  BANK_TRANSACTIONS_LEDGER: 'bank-transactions-ledger',
  BANK_STATEMENT_IMPORT: 'bank-statement-import',
  RECON_RD: 'recon-rd',
  RECON_PROGRESS: 'recon-progress',
  RECON_CREATE: 'recon-create',
  RECON_EDIT: 'recon-edit',
  RECON_CHANNEL: 'recon-channel',
  CHANNEL_RECON_CREATE: 'channel-recon-create',
  CHANNEL_RECON_EDIT: 'channel-recon-edit',
  CONTRACTS: 'contracts',
  INVOICE_MANAGE: 'invoice-manage',
  INVOICE_INPUT: 'invoice-input',
  INVOICE_CREATE: 'invoice-create',
  INVOICE_EDIT: 'invoice-edit',
  QUICKSDK_LIBRARY: 'quicksdk-library',
  PRODUCT_SOURCES: 'product-sources',
  QUICKSDK_GAMES: 'quicksdk-games',
  QUICKSDK_CHANNELS: 'quicksdk-channels',
  PARTNER_CONTACTS: 'partner-contacts',
  USER_CENTER: 'user-center'
}

/**
 * V4.0 P0 information architecture.
 *
 * Keep all existing views/routes for backwards compatibility, but group them by
 * the operator's real workflow rather than by the implementation history of each
 * module.  This keeps deep links stable while removing the feeling of many
 * independent mini-systems.
 */
export const SIDEBAR_GROUPS = [
  {
    id: 'workbench',
    label: '工作台',
    items: [
      { view: VIEWS.DASHBOARD, label: '总览' },
      { view: VIEWS.FINANCE_WORKBENCH, label: '财务待办' },
      { view: VIEWS.BUSINESS_DASHBOARD, label: '经营驾驶舱' },
      { view: VIEWS.PROFIT_ANALYSIS, label: '利润分析' },
      { view: VIEWS.ANOMALIES, label: '待办与异常' },
      { view: VIEWS.SERVER_COSTS, label: '服务器成本' }
    ]
  },
  {
    id: 'reconciliation',
    label: '对账中心',
    items: [
      { view: VIEWS.RECON_RD, label: '研发账单' },
      { view: VIEWS.RECON_PROGRESS, label: '对账进度' },
      { view: VIEWS.RECON_CHANNEL, label: '渠道账单' },
      { view: VIEWS.CHANNEL_RECON_CREATE, label: '智能录入' }
    ]
  },
  {
    id: 'contracts',
    label: '合同与客户',
    items: [
      { view: VIEWS.CONTRACTS, label: '合同台账' },
      { view: VIEWS.PARTNER_CONTACTS, label: '客户库' }
    ]
  },
  {
    id: 'invoices',
    label: '发票',
    items: [
      { view: VIEWS.INVOICE_MANAGE, label: '销项发票' },
      { view: VIEWS.INVOICE_INPUT, label: '进项发票' }
    ]
  },
  {
    id: 'funds',
    label: '银行资金',
    items: [
      { view: VIEWS.BANK_RECONCILIATION, label: '银行中心' }
    ]
  },
  {
    id: 'data',
    label: '数据',
    items: [
      { view: VIEWS.QUICKSDK_LIBRARY, label: '数据库' },
      { view: VIEWS.PRODUCT_SOURCES, label: '数据源' },
      { view: VIEWS.QUICKSDK_GAMES, label: '游戏数据' },
      { view: VIEWS.QUICKSDK_CHANNELS, label: '渠道数据' }
    ]
  }
]

const VIEW_TITLES = {
  [VIEWS.DASHBOARD]: '核心工作台',
  [VIEWS.FINANCE_WORKBENCH]: '财务待办',
  [VIEWS.SERVER_COSTS]: '服务器成本',
  [VIEWS.BUSINESS_DASHBOARD]: '月度经营驾驶舱',
  [VIEWS.PROFIT_ANALYSIS]: '利润分析',
  [VIEWS.ANOMALIES]: '待办与异常',
  [VIEWS.BANK_RECONCILIATION]: '银行中心',
  [VIEWS.BANK_TRANSACTIONS_LEDGER]: '银行中心 · 全部流水',
  [VIEWS.BANK_STATEMENT_IMPORT]: '银行中心 · 更多导入方式',
  [VIEWS.RECON_RD]: '研发账单',
  [VIEWS.RECON_PROGRESS]: '对账进度',
  [VIEWS.RECON_CREATE]: '新增研发账单',
  [VIEWS.RECON_EDIT]: '编辑研发账单',
  [VIEWS.RECON_CHANNEL]: '渠道账单',
  [VIEWS.CHANNEL_RECON_CREATE]: '新增渠道账单',
  [VIEWS.CHANNEL_RECON_EDIT]: '编辑渠道账单',
  [VIEWS.CONTRACTS]: '合同台账',
  [VIEWS.INVOICE_MANAGE]: '销项发票',
  [VIEWS.INVOICE_INPUT]: '进项发票',
  [VIEWS.INVOICE_CREATE]: '新增发票',
  [VIEWS.INVOICE_EDIT]: '编辑发票',
  [VIEWS.QUICKSDK_LIBRARY]: '数据库',
  [VIEWS.PRODUCT_SOURCES]: '数据源',
  [VIEWS.QUICKSDK_GAMES]: '游戏数据',
  [VIEWS.QUICKSDK_CHANNELS]: '渠道数据',
  [VIEWS.PARTNER_CONTACTS]: '客户库',
  [VIEWS.USER_CENTER]: '用户中心'
}

const VIEW_DESCRIPTIONS = {
  [VIEWS.DASHBOARD]: '围绕待办、对账、合同、发票和资金闭环统一处理日常财务工作。',
  [VIEWS.FINANCE_WORKBENCH]: '集中处理业务提交的开票任务，跟踪领取、驳回、完成与真实发票关联。',
  [VIEWS.SERVER_COSTS]: '独立维护云服务器、CDN、数据库、带宽和域名等成本，并自动进入利润分析。',
  [VIEWS.BUSINESS_DASHBOARD]: '按月区分权责结算与实际现金口径，查看渠道应收、研发应付、现金收支、结算贡献、产品排行与账单完成度。',
  [VIEWS.PROFIT_ANALYSIS]: '按管理口径分析经营利润、费用结构和产品可归属利润，并维护月度经营费用台账。',
  [VIEWS.ANOMALIES]: '把合同、账单、发票、资金和数据异常转成可直接执行的财务待办。',
  [VIEWS.BANK_RECONCILIATION]: '导入银行流水、处理智能匹配和多账单组合核销，一个页面完成资金核对闭环。',
  [VIEWS.BANK_TRANSACTIONS_LEDGER]: '银行中心兼容入口：查看完整银行流水。',
  [VIEWS.BANK_STATEMENT_IMPORT]: '银行中心兼容入口：使用回单文本识别或单条手工录入。',
  [VIEWS.RECON_RD]: '统一查看研发应付、付款进度、异常和账单闭环状态。',
  [VIEWS.RECON_PROGRESS]: '集中查看游戏账单与渠道流水的核对、结算和待处理明细。',
  [VIEWS.RECON_CREATE]: '按合同和结算依据新增研发账单。',
  [VIEWS.RECON_EDIT]: '维护研发账单及其结算依据。',
  [VIEWS.RECON_CHANNEL]: '统一查看渠道应收、收款进度、异常和账单闭环状态。',
  [VIEWS.CHANNEL_RECON_CREATE]: '按合同和平台结算依据新增渠道账单。',
  [VIEWS.CHANNEL_RECON_EDIT]: '维护渠道账单及其结算依据。',
  [VIEWS.CONTRACTS]: '统一维护合同、合作清单、履约状态、到期提醒和客户关联。',
  [VIEWS.INVOICE_MANAGE]: '管理销项发票、账单覆盖与税务状态。',
  [VIEWS.INVOICE_INPUT]: '管理进项发票、账单覆盖与税务状态。',
  [VIEWS.INVOICE_CREATE]: '录入或识别发票信息。',
  [VIEWS.INVOICE_EDIT]: '维护发票信息与税务状态。',
  [VIEWS.QUICKSDK_LIBRARY]: '查看已导入月份、批次、产品、渠道和流水明细。',
  [VIEWS.PRODUCT_SOURCES]: '维护 QuickSDK 游戏名称与 ProductCode 原始数据。',
  [VIEWS.QUICKSDK_GAMES]: '按月份和游戏名称汇总数据库中的流水数据。',
  [VIEWS.QUICKSDK_CHANNELS]: '按月份和渠道名称汇总数据库中的流水数据。',
  [VIEWS.PARTNER_CONTACTS]: '维护合作方/客户资料，供合同、账单、发票和银行匹配统一复用。',
  [VIEWS.USER_CENTER]: '管理当前账号、登录密码和设备会话。'
}

export const VIEW_ICONS = {
  [VIEWS.DASHBOARD]: '总',
  [VIEWS.FINANCE_WORKBENCH]: '财',
  [VIEWS.SERVER_COSTS]: '服',
  [VIEWS.BUSINESS_DASHBOARD]: '营',
  [VIEWS.PROFIT_ANALYSIS]: '利',
  [VIEWS.ANOMALIES]: '待',
  [VIEWS.BANK_RECONCILIATION]: '银',
  [VIEWS.BANK_TRANSACTIONS_LEDGER]: '流',
  [VIEWS.BANK_STATEMENT_IMPORT]: '录',
  [VIEWS.RECON_RD]: '研',
  [VIEWS.RECON_PROGRESS]: '进',
  [VIEWS.RECON_CREATE]: '增',
  [VIEWS.RECON_EDIT]: '编',
  [VIEWS.RECON_CHANNEL]: '渠',
  [VIEWS.CHANNEL_RECON_CREATE]: '增',
  [VIEWS.CHANNEL_RECON_EDIT]: '编',
  [VIEWS.CONTRACTS]: '合',
  [VIEWS.INVOICE_MANAGE]: '销',
  [VIEWS.INVOICE_INPUT]: '进',
  [VIEWS.INVOICE_CREATE]: '增',
  [VIEWS.INVOICE_EDIT]: '编',
  [VIEWS.QUICKSDK_LIBRARY]: '库',
  [VIEWS.PRODUCT_SOURCES]: '源',
  [VIEWS.QUICKSDK_GAMES]: '游',
  [VIEWS.QUICKSDK_CHANNELS]: '渠',
  [VIEWS.PARTNER_CONTACTS]: '客',
  [VIEWS.USER_CENTER]: '户'
}

export function getPageTitle(view) {
  return VIEW_TITLES[view] || '对账管理系统'
}

export function getPageDescription(view) {
  return VIEW_DESCRIPTIONS[view] || '财务对账与流水管理'
}

export function getPageMeta(view) {
  return { title: getPageTitle(view), description: getPageDescription(view) }
}

export function getGroupForView(view) {
  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT || view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) {
    return SIDEBAR_GROUPS.find((group) => group.id === 'reconciliation')
  }
  if (view === VIEWS.INVOICE_CREATE || view === VIEWS.INVOICE_EDIT) {
    return SIDEBAR_GROUPS.find((group) => group.id === 'invoices')
  }
  if (view === VIEWS.BANK_TRANSACTIONS_LEDGER || view === VIEWS.BANK_STATEMENT_IMPORT) {
    return SIDEBAR_GROUPS.find((group) => group.id === 'funds')
  }
  return SIDEBAR_GROUPS.find((group) => group.items.some((item) => item.view === view)) || SIDEBAR_GROUPS[0]
}

export function getTabView(view) {
  if (view === VIEWS.USER_CENTER) return VIEWS.DASHBOARD
  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT) return VIEWS.RECON_RD
  if (view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) return VIEWS.RECON_CHANNEL
  if (view === VIEWS.INVOICE_CREATE || view === VIEWS.INVOICE_EDIT) return VIEWS.INVOICE_MANAGE
  if (view === VIEWS.BANK_TRANSACTIONS_LEDGER || view === VIEWS.BANK_STATEMENT_IMPORT) return VIEWS.BANK_RECONCILIATION
  return view
}

export function getBreadcrumb(view) {
  if (view === VIEWS.DASHBOARD) return [{ label: getPageTitle(view), current: true }]
  if (view === VIEWS.USER_CENTER) return [{ label: '核心工作台', view: VIEWS.DASHBOARD }, { label: getPageTitle(view), current: true }]
  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT) {
    return [{ label: '核心工作台', view: VIEWS.DASHBOARD }, { label: '对账中心' }, { label: getPageTitle(VIEWS.RECON_RD), view: VIEWS.RECON_RD }, { label: getPageTitle(view), current: true }]
  }
  if (view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) {
    return [{ label: '核心工作台', view: VIEWS.DASHBOARD }, { label: '对账中心' }, { label: getPageTitle(VIEWS.RECON_CHANNEL), view: VIEWS.RECON_CHANNEL }, { label: getPageTitle(view), current: true }]
  }
  if (view === VIEWS.INVOICE_CREATE || view === VIEWS.INVOICE_EDIT) {
    return [{ label: '核心工作台', view: VIEWS.DASHBOARD }, { label: '发票' }, { label: getPageTitle(VIEWS.INVOICE_MANAGE), view: VIEWS.INVOICE_MANAGE }, { label: getPageTitle(view), current: true }]
  }
  if (view === VIEWS.BANK_TRANSACTIONS_LEDGER || view === VIEWS.BANK_STATEMENT_IMPORT) {
    return [{ label: '核心工作台', view: VIEWS.DASHBOARD }, { label: '银行资金' }, { label: '银行中心', view: VIEWS.BANK_RECONCILIATION }, { label: getPageTitle(view), current: true }]
  }
  const group = SIDEBAR_GROUPS.find((g) => g.items.some((i) => i.view === view))
  const crumbs = [{ label: '核心工作台', view: VIEWS.DASHBOARD }]
  if (group && group.id !== 'workbench') crumbs.push({ label: group.label })
  crumbs.push({ label: getPageTitle(view), current: true })
  return crumbs
}
