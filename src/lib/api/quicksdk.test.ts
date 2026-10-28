import { afterEach, describe, expect, it, vi } from 'vitest'

import { getQuickSdkGameFlow } from './quicksdk'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getQuickSdkGameFlow', () => {
  it('reads the month aggregate instead of raw daily rows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          game_name: '六界飞仙',
          settlement_month: '2026-06',
          row_count: 12,
          channel_count: 2,
          source_game_count: 2,
          total_flow: 291480,
          top_channel: '3387游戏',
          top_channel_flow: 200000
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await getQuickSdkGameFlow({
      settlement_month: '2026-06',
      game_name: '六界飞仙'
    })
    expect(result.total_flow).toBe(291480)
    expect(result.source_game_count).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/quicksdk/game-flow')
    expect(String(fetchMock.mock.calls[0][0])).toContain('settlement_month=2026-06')
  })

  it('builds the game total from flow rows when the aggregate route is absent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              game_name: '《六界飞仙》0.1折（6月）',
              channel_name: '3387游戏',
              gross_flow: 200000
            },
            {
              game_name: '六界飞仙01折翻服',
              channel_name: '爱趣聚合',
              gross_flow: 91480
            },
            {
              game_name: '云上征途005小混',
              channel_name: '3387游戏',
              gross_flow: 304874
            }
          ],
          total: 3
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const result = await getQuickSdkGameFlow({
      settlement_month: '2026-06',
      game_name: '六界飞仙'
    })

    expect(result.total_flow).toBe(291480)
    expect(result.source_game_count).toBe(2)
    expect(result.channel_count).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/quicksdk/game-flow')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/quicksdk/flows')
  })
})
