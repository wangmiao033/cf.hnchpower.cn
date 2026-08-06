import { describe, expect, it } from 'vitest'
import {
  buildQuickSdkBatchParams,
  buildQuickSdkFlowParams,
  getDatabaseViewCounts,
  getPagerRange
} from './workspace.js'

describe('QuickSDK database workspace state', () => {
  it('builds server-side search and paging parameters', () => {
    expect(
      buildQuickSdkFlowParams({
        month: '2026-07',
        keyword: '  一起来修仙  ',
        scope: 'game',
        page: 2,
        pageSize: 50
      })
    ).toEqual({
      settlement_month: '2026-07',
      game_name: '一起来修仙',
      limit: 50,
      offset: 100
    })

    expect(
      buildQuickSdkFlowParams({
        month: '2026-07',
        keyword: 'TapTap',
        scope: 'all',
        page: 0,
        pageSize: 20
      })
    ).toMatchObject({ q: 'TapTap', limit: 20, offset: 0 })
  })

  it('builds import-record paging parameters', () => {
    expect(buildQuickSdkBatchParams({ month: '2026-06', page: 3, pageSize: 20 })).toEqual({
      settlement_month: '2026-06',
      limit: 20,
      offset: 60
    })
  })

  it('uses summary totals before a lazy-loaded table is opened', () => {
    expect(
      getDatabaseViewCounts({
        summary: { game_count: 12, channel_count: 8, row_count: 3560, batch_count: 30 },
        flowTotal: 0,
        batchTotal: 0,
        hasSearch: false
      })
    ).toEqual({ overview: 20, flows: 3560, imports: 30 })
  })

  it('clamps invalid pages to the available range', () => {
    expect(getPagerRange(99, 45, 20)).toEqual({
      totalPages: 3,
      safePage: 2,
      start: 41,
      end: 45
    })
  })
})
