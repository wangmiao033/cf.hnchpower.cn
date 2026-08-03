import { describe, expect, it } from 'vitest'
import {
  getGroupForView,
  getPageDescription,
  getPageTitle,
  getTabView,
  SIDEBAR_GROUPS,
  VIEWS
} from './routes.js'

describe('统一对账进度路由', () => {
  it('作为核心对账中的独立页面展示', () => {
    const group = getGroupForView(VIEWS.RECON_PROGRESS)

    expect(group.id).toBe('reconciliation')
    expect(group.items.map((item) => item.view)).toEqual([
      VIEWS.RECON_RD,
      VIEWS.RECON_PROGRESS,
      VIEWS.RECON_CHANNEL
    ])
    expect(getTabView(VIEWS.RECON_PROGRESS)).toBe(VIEWS.RECON_PROGRESS)
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

describe('QuickSDK 数据源路由', () => {
  it('作为数据中心中的独立原始台账展示', () => {
    const group = getGroupForView(VIEWS.PRODUCT_SOURCES)

    expect(group.id).toBe('data')
    expect(group.items.map((item) => item.view)).toEqual([
      VIEWS.QUICKSDK_LIBRARY,
      VIEWS.PRODUCT_SOURCES,
      VIEWS.QUICKSDK_GAMES,
      VIEWS.QUICKSDK_CHANNELS,
      VIEWS.PARTNER_CONTACTS
    ])
    expect(getPageTitle(VIEWS.PRODUCT_SOURCES)).toBe('数据源')
    expect(getPageDescription(VIEWS.PRODUCT_SOURCES)).toContain('ProductCode')
  })
})

describe('发票中心路由', () => {
  it('销项和进项发票均在发票中心，并让新增/编辑复用销项标签页', () => {
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
