/**
 * Core routes for the rebuilt reconciliation console.
 */

export const VIEWS = {
  DASHBOARD: 'dashboard',
  RECON_RD: 'recon-rd',
  RECON_PROGRESS: 'recon-progress',
  RECON_CREATE: 'recon-create',
  RECON_EDIT: 'recon-edit',
  RECON_CHANNEL: 'recon-channel',
  CHANNEL_RECON_CREATE: 'channel-recon-create',
  CHANNEL_RECON_EDIT: 'channel-recon-edit',
  CONTRACTS: 'contracts',
  QUICKSDK_LIBRARY: 'quicksdk-library',
  QUICKSDK_GAMES: 'quicksdk-games',
  QUICKSDK_CHANNELS: 'quicksdk-channels',
  PARTNER_CONTACTS: 'partner-contacts',
  USER_CENTER: 'user-center'
}

export const SIDEBAR_GROUPS = [
  {
    id: 'workbench',
    label: '工作台',
    items: [{ view: VIEWS.DASHBOARD, label: '总览' }]
  },
  {
    id: 'reconciliation',
    label: '核心对账',
    items: [
      { view: VIEWS.RECON_RD, label: '研发账单' },
      { view: VIEWS.RECON_PROGRESS, label: '对账进度' },
      { view: VIEWS.RECON_CHANNEL, label: '渠道账单' }
    ]
  },
  {
    id: 'contracts',
    label: '合同中心',
    items: [{ view: VIEWS.CONTRACTS, label: '合同台账' }]
  },
  {
    id: 'data',
    label: '数据中心',
    items: [
      { view: VIEWS.QUICKSDK_LIBRARY, label: '数据库' },
      { view: VIEWS.QUICKSDK_GAMES, label: '游戏数据' },
      { view: VIEWS.QUICKSDK_CHANNELS, label: '渠道数据' },
      { view: VIEWS.PARTNER_CONTACTS, label: '客户库' }
    ]
  }
]

const VIEW_TITLES = {
  [VIEWS.DASHBOARD]: '核心工作台',
  [VIEWS.RECON_RD]: '研发账单',
  [VIEWS.RECON_PROGRESS]: '研发对账进度',
  [VIEWS.RECON_CREATE]: '新增研发账单',
  [VIEWS.RECON_EDIT]: '编辑研发账单',
  [VIEWS.RECON_CHANNEL]: '渠道账单',
  [VIEWS.CHANNEL_RECON_CREATE]: '新增渠道账单',
  [VIEWS.CHANNEL_RECON_EDIT]: '编辑渠道账单',
  [VIEWS.CONTRACTS]: '合同台账',
  [VIEWS.QUICKSDK_LIBRARY]: '数据库',
  [VIEWS.QUICKSDK_GAMES]: '游戏数据',
  [VIEWS.QUICKSDK_CHANNELS]: '渠道数据',
  [VIEWS.PARTNER_CONTACTS]: '客户库',
  [VIEWS.USER_CENTER]: '用户中心'
}

const VIEW_DESCRIPTIONS = {
  [VIEWS.DASHBOARD]: '研发对账、渠道对账、合同、数据库和客户资料统一管理。',
  [VIEWS.RECON_RD]: '保留现有研发账单计算、录入、筛选、导入和导出逻辑。',
  [VIEWS.RECON_PROGRESS]: '集中查看研发账单核对、结算、付款覆盖率和待处理明细。',
  [VIEWS.RECON_CREATE]: '使用现有研发账单录入逻辑新增记录。',
  [VIEWS.RECON_EDIT]: '使用现有研发账单编辑逻辑维护记录。',
  [VIEWS.RECON_CHANNEL]: '保留现有渠道账单计算、导入、编辑和导出逻辑。',
  [VIEWS.CHANNEL_RECON_CREATE]: '使用现有渠道账单录入逻辑新增记录。',
  [VIEWS.CHANNEL_RECON_EDIT]: '使用现有渠道账单编辑逻辑维护记录。',
  [VIEWS.CONTRACTS]: '统一维护 WPS 合同台账、履约状态、到期提醒和客户关联。',
  [VIEWS.QUICKSDK_LIBRARY]: '查看已导入月份、批次、产品、渠道和流水明细。',
  [VIEWS.QUICKSDK_GAMES]: '按月份和游戏名称汇总数据库中的流水数据。',
  [VIEWS.QUICKSDK_CHANNELS]: '按月份和渠道名称汇总数据库中的流水数据。',
  [VIEWS.PARTNER_CONTACTS]: '维护合作方/客户资料，供对账单复用。',
  [VIEWS.USER_CENTER]: '管理当前账号、登录密码和设备会话。'
}

export const VIEW_ICONS = {
  [VIEWS.DASHBOARD]: '总',
  [VIEWS.RECON_RD]: '研',
  [VIEWS.RECON_PROGRESS]: '进',
  [VIEWS.RECON_CREATE]: '增',
  [VIEWS.RECON_EDIT]: '编',
  [VIEWS.RECON_CHANNEL]: '渠',
  [VIEWS.CHANNEL_RECON_CREATE]: '增',
  [VIEWS.CHANNEL_RECON_EDIT]: '编',
  [VIEWS.CONTRACTS]: '合',
  [VIEWS.QUICKSDK_LIBRARY]: '流',
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
  return {
    title: getPageTitle(view),
    description: getPageDescription(view)
  }
}

export function getGroupForView(view) {
  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT) {
    return SIDEBAR_GROUPS.find((group) => group.id === 'reconciliation')
  }

  if (view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) {
    return SIDEBAR_GROUPS.find((group) => group.id === 'reconciliation')
  }

  return SIDEBAR_GROUPS.find((group) => group.items.some((item) => item.view === view)) || SIDEBAR_GROUPS[0]
}

export function getTabView(view) {
  if (view === VIEWS.USER_CENTER) {
    return VIEWS.DASHBOARD
  }

  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT) {
    return VIEWS.RECON_RD
  }

  if (view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) {
    return VIEWS.RECON_CHANNEL
  }

  return view
}

export function getBreadcrumb(view) {
  if (view === VIEWS.DASHBOARD) {
    return [{ label: getPageTitle(view), current: true }]
  }

  if (view === VIEWS.USER_CENTER) {
    return [
      { label: '核心工作台', view: VIEWS.DASHBOARD },
      { label: getPageTitle(view), current: true }
    ]
  }

  if (view === VIEWS.RECON_CREATE || view === VIEWS.RECON_EDIT) {
    return [
      { label: '核心工作台', view: VIEWS.DASHBOARD },
      { label: '核心对账' },
      { label: getPageTitle(VIEWS.RECON_RD), view: VIEWS.RECON_RD },
      { label: getPageTitle(view), current: true }
    ]
  }

  if (view === VIEWS.CHANNEL_RECON_CREATE || view === VIEWS.CHANNEL_RECON_EDIT) {
    return [
      { label: '核心工作台', view: VIEWS.DASHBOARD },
      { label: '核心对账' },
      { label: getPageTitle(VIEWS.RECON_CHANNEL), view: VIEWS.RECON_CHANNEL },
      { label: getPageTitle(view), current: true }
    ]
  }

  const group = SIDEBAR_GROUPS.find((g) => g.items.some((i) => i.view === view))
  const crumbs = [{ label: '核心工作台', view: VIEWS.DASHBOARD }]
  if (group && group.id !== 'workbench') {
    crumbs.push({ label: group.label })
  }
  crumbs.push({ label: getPageTitle(view), current: true })
  return crumbs
}
