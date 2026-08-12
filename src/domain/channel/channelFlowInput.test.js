import { describe, expect, it } from 'vitest'
import {
  CHANNEL_FLOW_INPUT_STATE,
  applyChannelFlowPaste,
  channelFlowCompletion,
  parseChannelFlowPaste,
  resolveChannelFlowInputState
} from './channelFlowInput.js'

describe('channel flow input state', () => {
  it('keeps blank distinct from explicit zero', () => {
    expect(resolveChannelFlowInputState({ flow: '' })).toBe(CHANNEL_FLOW_INPUT_STATE.MISSING)
    expect(resolveChannelFlowInputState({ flow: '0', flowInputState: 'confirmed_zero' })).toBe(CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO)
    expect(resolveChannelFlowInputState({ flow: '88.5', flowInputState: 'entered' })).toBe(CHANNEL_FLOW_INPUT_STATE.ENTERED)
  })

  it('treats legacy confirmed rows as complete', () => {
    expect(resolveChannelFlowInputState({ flow: 0, flowInputState: 'confirmed' })).toBe(CHANNEL_FLOW_INPUT_STATE.CONFIRMED_ZERO)
    expect(resolveChannelFlowInputState({ flow: 10, flowInputState: 'confirmed' })).toBe(CHANNEL_FLOW_INPUT_STATE.ENTERED)
  })

  it('reports missing games before confirmation', () => {
    const result = channelFlowCompletion({
      items: [
        { gameName: 'A', flow: '', flowInputState: 'missing' },
        { gameName: 'B', flow: '0', flowInputState: 'confirmed_zero' },
        { gameName: 'C', flow: '100', flowInputState: 'entered' }
      ]
    })
    expect(result.total).toBe(3)
    expect(result.missingCount).toBe(1)
    expect(result.missingGames).toEqual(['A'])
    expect(result.complete).toBe(false)
  })
})

describe('channel flow paste', () => {
  it('parses Excel/WPS tabular content with headers', () => {
    const parsed = parseChannelFlowPaste('游戏\t后台流水\t代金券\t退款\n云上征途\t1,234.50\t20\t0\n大灵王\t0\t\t5')
    expect(parsed.hasHeader).toBe(true)
    expect(parsed.rows).toEqual([
      { gameName: '云上征途', flow: '1234.5', voucherCost: '20', refundCost: '0' },
      { gameName: '大灵王', flow: '0', refundCost: '5' }
    ])
  })

  it('applies rows without overwriting blank pasted cells', () => {
    const source = {
      items: [
        { gameName: '云上征途', flow: '', voucherCost: '9', flowInputState: 'missing' }
      ]
    }
    const applied = applyChannelFlowPaste(
      source,
      [{ gameName: '云上征途', flow: '0' }, { gameName: '大灵王', flow: '88', voucherCost: '2' }],
      (gameName) => ({ gameName, flow: '', voucherCost: '', flowInputState: 'missing' })
    )
    expect(applied.matched).toBe(1)
    expect(applied.added).toBe(1)
    expect(applied.record.items[0].voucherCost).toBe('9')
    expect(applied.record.items[0].flowInputState).toBe('confirmed_zero')
    expect(applied.record.items[1].flowInputState).toBe('entered')
  })
})
