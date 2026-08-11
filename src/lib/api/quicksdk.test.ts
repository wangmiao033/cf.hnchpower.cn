import { afterEach, describe, expect, it, vi } from 'vitest'

import { getQuickSdkGameFlow } from './quicksdk'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getQuickSdkGameFlow', () => {
  it('builds the game total directly from production flow rows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/quicksdk/flows')
  })
})
