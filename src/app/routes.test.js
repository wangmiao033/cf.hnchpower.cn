import { describe, expect, it } from 'vitest'
import {
  getGroupForView,
  getPageDescription,
  getPageTitle,
  getTabView,
  SIDEBAR_GROUPS,
  VIEWS
} from './routes.js'

describe('研发对账进度路由', () => {
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
    expect(getPageTitle(VIEWS.RECON_PROGRESS)).toBe('研发对账进度')
    expect(getPageDescription(VIEWS.RECON_PROGRESS)).toContain('付款覆盖率')
    expect(
      SIDEBAR_GROUPS
        .flatMap((group) => group.items)
        .find((item) => item.view === VIEWS.RECON_PROGRESS)?.label
    ).toBe('对账进度')
  })
})
