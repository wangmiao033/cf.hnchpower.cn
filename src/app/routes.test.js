import { describe, expect, it } from 'vitest'
import {
  getGroupForView,
  getPageDescription,
  getPageTitle,
  getTabView,
  SIDEBAR_GROUPS,
  VIEWS
} from './routes.js'

describe('V4 工作流导航', () => {
  it('收口为六个核心业务域', () => {
    expect(SIDEBAR_GROUPS.map((group) => group.label)).toEqual([
      '工作台',
      '对账中心',
      '合同与客户',
      '发票',
      '银行资金',
      '数据'
    ])
  })

  it('财务待办、经营、利润、异常和服务器成本统一归入工作台', () => {
    expect(getGroupForView(VIEWS.FINANCE_WORKBENCH)?.id).toBe('workbench')
    expect(getGroupForView(VIEWS.BUSINESS_DASHBOARD)?.id).toBe('workbench')
    expect(getGroupForView(VIEWS.PROFIT_ANALYSIS)?.id).toBe('workbench')
    expect(getGroupForView(VIEWS.ANOMALIES)?.id).toBe('workbench')
    expect(getGroupForView(VIEWS.SERVER_COSTS)?.id).toBe('workbench')
  })

  it('客户库与合同台账共享合同与客户域', () => {
    expect(getGroupForView(VIEWS.CONTRACTS)?.id).toBe('contracts')
    expect(getGroupForView(VIEWS.PARTNER_CONTACTS)?.id).toBe('contracts')
  })

  it('银行兼容入口始终回到唯一银行资金域', () => {
    expect(getGroupForView(VIEWS.BANK_RECONCILIATION)?.id).toBe('funds')
    expect(getGroupForView(VIEWS.BANK_TRANSACTIONS_LEDGER)?.id).toBe('funds')
    expect(getGroupForView(VIEWS.BANK_STATEMENT_IMPORT)?.id).toBe('funds')
  })
})

describe('统一对账进度路由', () => {
  it('作为对账中心中的独立页面展示', () => {
    const group = getGroupForView(VIEWS.RECON_PROGRESS)

    expect(group.id).toBe('reconciliation')
    expect(group.items.map((item) => item.view)).toEqual([
      VIEWS.RECON_RD,
      VIEWS.RECON_PROGRESS,
      VIEWS.RECON_CHANNEL,
      VIEWS.CHANNEL_RECON_CREATE
    ])
    expect(getTabView(VIEWS.RECON_PROGRESS)).toBe(VIEWS.RECON_PROGRESS)
  })

  it('渠道智能录入直接复用现有新增渠道账单页面', () => {
    const group = getGroupForView(VIEWS.CHANNEL_RECON_CREATE)
    expect(group.id).toBe('reconciliation')
    expect(group.items.find((item) => item.view === VIEWS.CHANNEL_RECON_CREATE)?.label).toBe('智能录入')
    expect(getTabView(VIEWS.CHANNEL_RECON_CREATE)).toBe(VIEWS.RECON_CHANNEL)
  })

  it('提供独立页面文案', () => {
    expect(getPageTitle(VIEWS.RECON_PROGRESS)).toBe('对账进度')
    expect(getPageDescription(VIEWS.RECON_PROGRESS)).toContain('游戏账单与渠道流水')
    expect(
      SIDEBAR_GROUPS
        .flatMap((group) => group.items)
        .find((item) => item.view === VIEWS.RECON_PROGRESS)?.label
    ).toBe('对账进度')
  })
})

describe('QuickSDK 数据路由', () => {
  it('数据域只保留数据库、数据源和游戏/渠道数据', () => {
    const group = getGroupForView(VIEWS.PRODUCT_SOURCES)

    expect(group.id).toBe('data')
    expect(group.items.map((item) => item.view)).toEqual([
      VIEWS.QUICKSDK_LIBRARY,
      VIEWS.PRODUCT_SOURCES,
      VIEWS.QUICKSDK_GAMES,
      VIEWS.QUICKSDK_CHANNELS
    ])
    expect(getPageTitle(VIEWS.PRODUCT_SOURCES)).toBe('数据源')
    expect(getPageDescription(VIEWS.PRODUCT_SOURCES)).toContain('ProductCode')
  })
})

describe('发票路由', () => {
  it('销项和进项发票均在发票域，并让新增/编辑复用销项标签页', () => {
    const group = getGroupForView(VIEWS.INVOICE_INPUT)

    expect(group.id).toBe('invoices')
    expect(group.items.map((item) => item.view)).toEqual([
      VIEWS.INVOICE_MANAGE,
      VIEWS.INVOICE_INPUT
    ])
    expect(getTabView(VIEWS.INVOICE_CREATE)).toBe(VIEWS.INVOICE_MANAGE)
    expect(getTabView(VIEWS.INVOICE_EDIT)).toBe(VIEWS.INVOICE_MANAGE)
  })
})
